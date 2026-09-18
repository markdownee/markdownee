"""Native Crawlee orchestration, extraction, conversion, and file export."""

from __future__ import annotations

import asyncio
import codecs
import hashlib
import json
import math
from collections.abc import Sequence
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from email.message import Message
from pathlib import Path
from typing import Unpack
from urllib.parse import urljoin, urlsplit
from uuid import uuid4

from bs4 import BeautifulSoup, UnicodeDammit
from crawlee import ConcurrencySettings, Glob, Request
from crawlee.configuration import Configuration
from crawlee.crawlers import (
    BasicCrawlingContext,
    BeautifulSoupCrawler,
    BeautifulSoupCrawlingContext,
    PlaywrightCrawler,
    PlaywrightCrawlingContext,
)
from crawlee.events import LocalEventManager
from crawlee.http_clients import HttpxHttpClient
from crawlee.proxy_configuration import ProxyConfiguration
from crawlee.storage_clients import MemoryStorageClient
from crawlee.storages import RequestQueue
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright
from trafilaturacore import clean

from ._conversion import render
from ._errors import MarkdowneeError, MissingBrowserError
from ._images import save_images
from ._manifest import CrawlSummary, read_summary
from ._options import (
    CrawlOptions,
    FetchOptions,
    Format,
    Options,
    validate_formats,
    validate_options,
    validate_url,
)
from ._redact import SecretFilter
from ._result import FetchResult

_EXTENSIONS = {
    "txt": ".txt",
    "markdown": ".md",
    "html": ".html",
    "minified_html": ".min.html",
    "original": ".original.html",
}
Context = BeautifulSoupCrawlingContext | PlaywrightCrawlingContext
Origin = tuple[str, str | None, int]


def _origin(url: str) -> Origin:
    """Return the full HTTP origin used to scope caller-supplied headers."""
    parsed = urlsplit(url)
    return (
        parsed.scheme,
        parsed.hostname,
        parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80),
    )


def _scoped_headers(
    target: str,
    allowed_origins: frozenset[Origin],
    headers: dict[str, str],
) -> dict[str, str]:
    """Return caller headers only for an explicitly seeded origin."""
    return headers if _origin(target) in allowed_origins else {}


def _image_headers(
    target: str,
    page: str,
    headers: dict[str, str],
    allowed_origins: frozenset[Origin] | None = None,
) -> dict[str, str]:
    """Send page headers only to an authorized full page origin."""
    page_origin = _origin(page)
    if _origin(target) != page_origin:
        return {}
    if allowed_origins is not None and page_origin not in allowed_origins:
        return {}
    return headers


def _validate_timeout(timeout: float) -> None:
    """Reject unbounded or malformed whole-crawl timeout settings."""
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)):
        raise MarkdowneeError("timeout must be a positive finite number of seconds")
    if not math.isfinite(timeout) or timeout <= 0:
        raise MarkdowneeError("timeout must be a positive finite number of seconds")


async def _browser_document(context: PlaywrightCrawlingContext, options: Options) -> str:
    """Apply bounded browser waits, then capture the document once."""
    page = context.page
    if options.max_scroll_height:
        await page.evaluate(
            """async (maximum) => {
                let previous = -1;
                for (let y = 0; y < maximum; y += 500) {
                    window.scrollTo(0, y);
                    await new Promise(resolve => setTimeout(resolve, 100));
                    if (window.scrollY === previous) break;
                    previous = window.scrollY;
                }
                window.scrollTo(0, 0);
            }""",
            options.max_scroll_height,
        )
    if options.wait_for_dynamic_content:
        with suppress(PlaywrightTimeoutError):
            await page.wait_for_load_state(
                "networkidle",
                timeout=options.wait_for_dynamic_content * 1000,
            )
    if options.wait_for_selector:
        await page.wait_for_selector(
            options.wait_for_selector,
            timeout=options.navigation_timeout * 1000,
            state="attached",
        )
    if options.soft_wait_for_selector:
        with suppress(PlaywrightTimeoutError):
            await page.wait_for_selector(
                options.soft_wait_for_selector,
                timeout=options.navigation_timeout * 1000,
                state="attached",
            )
    return await page.content()


async def _run(
    urls: Sequence[str],
    formats: tuple[Format, ...],
    options: Options,
    *,
    timeout: float,
    directory: Path | None,
) -> tuple[list[dict[str, object]], list[FetchResult]]:
    """Run one isolated in-memory Crawlee queue and collect terminal page records."""
    records: dict[str, dict[str, object]] = {}
    outputs: dict[str, FetchResult] = {}
    active = True
    headers = dict(options.headers or {})
    if options.user_agent:
        headers["User-Agent"] = options.user_agent
    allowed_header_origins = frozenset(_origin(url) for url in urls)
    scoped_header_names = frozenset(name.lower() for name in headers)

    async def scope_http_headers(request) -> None:
        """Remove caller headers whenever HTTPX follows a cross-origin redirect."""
        if _origin(str(request.url)) in allowed_header_origins:
            return
        for name in scoped_header_names:
            request.headers.pop(name, None)

    http_client = HttpxHttpClient(
        verify=not options.ignore_https_errors,
        timeout=options.navigation_timeout,
        follow_redirects=True,
        header_generator=None,
        event_hooks={"request": [scope_http_headers]},
    )
    image_client = HttpxHttpClient(
        verify=not options.ignore_https_errors,
        timeout=options.navigation_timeout,
        follow_redirects=False,
        header_generator=None,
    )
    configuration = Configuration(purge_on_start=False)
    storage = MemoryStorageClient()
    queue = await RequestQueue.open(
        name=f"markdownee-{uuid4().hex}",
        configuration=configuration,
        storage_client=storage,
    )
    common = {
        "configuration": configuration,
        "event_manager": LocalEventManager(),
        "storage_client": storage,
        "request_manager": queue,
        "http_client": http_client,
        "max_request_retries": options.max_retries,
        "max_session_rotations": 0,
        "max_requests_per_crawl": options.max_requests_per_crawl or None,
        "max_crawl_depth": options.max_crawl_depth or None,
        "respect_robots_txt_file": options.respect_robots_txt,
        "request_handler_timeout": timedelta(seconds=timeout),
        "concurrency_settings": ConcurrencySettings(
            desired_concurrency=options.initial_concurrency or min(10, options.max_concurrency),
            max_concurrency=options.max_concurrency,
        ),
        "configure_logging": False,
    }
    if options.proxy:
        common["proxy_configuration"] = ProxyConfiguration(proxy_urls=options.proxy)
    if options.crawler_type == "http":
        crawler = BeautifulSoupCrawler(**common)
    else:
        async with async_playwright() as playwright:
            browser = getattr(playwright, options.crawler_type)
            if not Path(browser.executable_path).is_file():
                raise MissingBrowserError(
                    f"install the browser with: playwright install {options.crawler_type}"
                )
        context_options: dict[str, object] = {
            "ignore_https_errors": options.ignore_https_errors,
        }
        if options.user_agent:
            context_options["user_agent"] = options.user_agent
        crawler = PlaywrightCrawler(
            **common,
            browser_type=options.crawler_type,
            headless=options.headless,
            navigation_timeout=timedelta(seconds=options.navigation_timeout),
            browser_new_context_options=context_options,
            goto_options={"wait_until": options.wait_until},
            fingerprint_generator=None,
        )

        @crawler.pre_navigation_hook
        async def configure_page(context: PlaywrightCrawlingContext) -> None:
            """Scope page headers and optionally block media before navigation."""
            if options.block_media or headers:

                async def route_request(route) -> None:
                    """Apply caller headers only to explicitly seeded full origins."""
                    if options.block_media and route.request.resource_type in {
                        "image",
                        "media",
                        "font",
                    }:
                        await route.abort()
                        return
                    request_headers = dict(route.request.headers)
                    for name in scoped_header_names:
                        request_headers.pop(name, None)
                    request_headers.update(
                        _scoped_headers(
                            route.request.url,
                            allowed_header_origins,
                            headers,
                        )
                    )
                    if _origin(route.request.url) in allowed_header_origins and headers:
                        response = await route.fetch(headers=request_headers, max_redirects=0)
                        await route.fulfill(response=response)
                    else:
                        await route.continue_(headers=request_headers)

                await context.page.route("**/*", route_request)

    @crawler.router.default_handler
    async def handle(context: Context) -> None:
        """Clean once, transform images, then emit all selected formats."""
        if not active:
            raise asyncio.CancelledError
        if isinstance(context, PlaywrightCrawlingContext):
            original = await _browser_document(context, options)
            status_code = context.response.status if context.response else 200
        else:
            raw = await context.http_response.read()
            if len(raw) > options.max_input_bytes:
                raise MarkdowneeError("page exceeds max_input_bytes")
            content_type = Message()
            content_type["content-type"] = context.http_response.headers.get("content-type", "")
            charset = content_type.get_content_charset()
            has_bom = raw.startswith(
                (
                    codecs.BOM_UTF8,
                    codecs.BOM_UTF16_LE,
                    codecs.BOM_UTF16_BE,
                    codecs.BOM_UTF32_LE,
                    codecs.BOM_UTF32_BE,
                )
            )
            decoded = UnicodeDammit(
                raw,
                known_definite_encodings=[charset] if charset and not has_bom else [],
                is_html=True,
            )
            original = decoded.unicode_markup or ""
            status_code = context.http_response.status_code
            if options.wait_for_selector and not context.soup.select_one(options.wait_for_selector):
                raise MarkdowneeError("required selector is absent")
        if len(original.encode("utf-8")) > options.max_input_bytes:
            raise MarkdowneeError("page exceeds max_input_bytes")
        loaded_url = context.request.loaded_url or context.request.url
        validate_url(loaded_url)
        document = BeautifulSoup(original, "html.parser")
        declared = str(document.html.get("lang", "")) if document.html else ""
        if (
            options.language
            and declared
            and declared.split("-")[0].lower() != options.language.split("-")[0].lower()
        ):
            records[context.request.unique_key] = {
                "url": context.request.url,
                "status": "skipped",
                "reason": "language",
            }
            return
        cleaned = await asyncio.to_thread(
            clean,
            original,
            boilerplate=options.mode,
            url=loaded_url,
            image_handling="resolved-url"
            if options.image_handling == "save"
            else options.image_handling,
            link_handling=options.link_handling,
            table_handling=options.table_handling,
            comment_handling=options.comment_handling,
            max_input_bytes=options.max_input_bytes,
        )
        fragment = cleaned.html
        if not active:
            raise asyncio.CancelledError
        images: list[dict[str, str | int]] = []
        warnings: list[str] = []
        if options.image_handling == "save" and directory is not None:

            async def fetch_image(url: str) -> tuple[bytes, str]:
                """Use this crawl's session/proxy channel with an explicit byte cap."""
                current = url
                for _ in range(6):
                    validate_url(current)
                    async with image_client.stream(
                        current,
                        session=context.session,
                        proxy_info=context.proxy_info,
                        headers=_image_headers(
                            current,
                            loaded_url,
                            headers,
                            allowed_header_origins,
                        ),
                        timeout=timedelta(seconds=options.navigation_timeout),
                    ) as response:
                        if response.status_code in {301, 302, 303, 307, 308}:
                            location = response.headers.get("location")
                            if not location:
                                raise MarkdowneeError("image redirect lacks a location")
                            current = urljoin(current, location)
                            continue
                        if response.status_code < 200 or response.status_code >= 300:
                            raise MarkdowneeError("image returned an unsuccessful HTTP status")
                        chunks: list[bytes] = []
                        size = 0
                        async for chunk in response.read_stream():
                            size += len(chunk)
                            if size > options.max_image_bytes:
                                raise MarkdowneeError("image exceeds max_image_bytes")
                            chunks.append(chunk)
                        return b"".join(chunks), response.headers.get("content-type", "")
                raise MarkdowneeError("image exceeded redirect limit")

            fragment, images, warnings = await save_images(
                fragment,
                fetch=fetch_image,
                directory=directory,
                options=options,
                originals="original" in formats,
                is_active=lambda: active,
            )
        crawl_context: dict[str, str | int] = {
            "loaded-url": loaded_url,
            "timestamp": datetime.now(UTC).isoformat(),
            "status-code": status_code,
            "depth": context.request.crawl_depth,
        }
        metadata = dict(cleaned.metadata or {})
        if declared:
            metadata["languageCode"] = declared
        contents = render(
            fragment,
            original,
            formats,
            metadata=metadata,
            layout=options.output_layout,
            crawl=crawl_context,
        )
        if not contents:
            raise MarkdowneeError("page yielded no requested content")
        if not active:
            raise asyncio.CancelledError
        # Enqueue before committing a success: a failed enqueue cannot create both
        # a successful file record and a failed request for the same attempt.
        if options.selector:

            def add_headers(request):
                """Carry request headers only to explicitly seeded full origins."""
                request["headers"] = _scoped_headers(
                    str(request["url"]),
                    allowed_header_origins,
                    headers,
                )
                request["keep_url_fragment"] = options.keep_url_fragment
                return request

            await context.enqueue_links(
                selector=options.selector,
                strategy="same-origin",
                **(
                    {"include": [Glob(pattern) for pattern in options.globs]}
                    if options.globs
                    else {}
                ),
                exclude=[Glob(pattern) for pattern in options.exclude or []],
                transform_request_function=add_headers,
            )
        files: dict[str, str] = {}
        if directory is not None:
            stem = hashlib.sha256(context.request.url.encode()).hexdigest()[:24]
            for selected, content in contents.items():
                filename = stem + _EXTENSIONS[selected]
                (directory / filename).write_text(content, encoding="utf-8", newline="")
                files[selected] = filename
        records[context.request.unique_key] = {
            "url": context.request.url,
            "status": "success",
            "metadata": metadata,
            "crawl": crawl_context,
            "files": files,
            "images": images,
            "warnings": warnings,
        }
        outputs[context.request.unique_key] = contents

    @crawler.failed_request_handler
    async def failed(context: BasicCrawlingContext, error: Exception) -> None:
        """Retain successes from other URLs without echoing request secrets."""
        records[context.request.unique_key] = {
            "url": context.request.url,
            "status": "failed",
            "error": type(error).__name__,
        }

    @crawler.on_skipped_request
    async def skipped(url: str, reason: str) -> None:
        """Account for Crawlee's robots and request-limit skip outcomes."""
        records.setdefault(url, {"url": url, "status": "skipped", "reason": str(reason)})

    requests = [
        Request.from_url(
            url,
            headers=headers if options.crawler_type == "http" else {},
            keep_url_fragment=options.keep_url_fragment,
        )
        for url in urls
    ]
    secret_filter = SecretFilter([*headers.values(), *(options.proxy or [])])
    crawler.log.addFilter(secret_filter)
    await image_client.__aenter__()
    task = asyncio.create_task(crawler.run(requests))
    try:
        done, _ = await asyncio.wait({task}, timeout=timeout)
        if not done:
            active = False
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            raise MarkdowneeError("crawl exceeded timeout")
        await task
    except asyncio.CancelledError:
        active = False
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        raise
    except MarkdowneeError:
        raise
    except Exception:
        raise MarkdowneeError(
            "crawl failed; check network, proxy, and browser configuration"
        ) from None
    finally:
        active = False
        crawler.log.removeFilter(secret_filter)
        await image_client.__aexit__(None, None, None)
        await queue.drop()
    return list(records.values()), list(outputs.values())


async def afetch(
    url: str,
    *,
    formats: Sequence[Format] | None = None,
    timeout: float = 120,
    **options: Unpack[FetchOptions],
) -> FetchResult:
    """Fetch one page and return requested formats, without writing files."""
    validated = validate_options(options, single=True)
    _validate_timeout(timeout)
    records, contents = await _run(
        [validate_url(url)],
        validate_formats(formats),
        validated,
        timeout=timeout,
        directory=None,
    )
    if not contents:
        status = str(records[0].get("status", "failed")) if records else "failed"
        raise MarkdowneeError(f"single-page extraction {status}")
    return contents[0]


def fetch(
    url: str,
    *,
    formats: Sequence[Format] | None = None,
    timeout: float = 120,
    **options: Unpack[FetchOptions],
) -> FetchResult:
    """Synchronous single-page extraction; use afetch inside an event loop."""
    _require_sync()
    return asyncio.run(afetch(url, formats=formats, timeout=timeout, **options))


async def acrawl(
    urls: Sequence[str],
    *,
    formats: Sequence[Format] | None = None,
    output_dir: str | Path = "./out",
    timeout: float = 120,
    **options: Unpack[CrawlOptions],
) -> CrawlSummary:
    """Crawl into an isolated run directory and retain partial page successes."""
    validated = validate_options(options)
    selected = validate_formats(formats)
    _validate_timeout(timeout)
    if isinstance(urls, str) or not isinstance(urls, Sequence) or not urls:
        raise MarkdowneeError("urls must be a nonempty sequence of HTTP(S) URLs")
    seeds = [validate_url(url) for url in urls]
    directory = Path(output_dir).resolve() / f"crawl-{uuid4().hex}"
    directory.mkdir(parents=True)
    records, _ = await _run(seeds, selected, validated, timeout=timeout, directory=directory)
    manifest = directory / "manifest.json"
    manifest.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    return read_summary(manifest, directory)


def crawl(
    urls: Sequence[str],
    *,
    formats: Sequence[Format] | None = None,
    output_dir: str | Path = "./out",
    timeout: float = 120,
    **options: Unpack[CrawlOptions],
) -> CrawlSummary:
    """Synchronous file export; use acrawl inside an event loop."""
    _require_sync()
    return asyncio.run(
        acrawl(urls, formats=formats, output_dir=output_dir, timeout=timeout, **options)
    )


def _require_sync() -> None:
    """Avoid unawaited coroutine warnings when a sync API runs in an event loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    raise MarkdowneeError("use the asynchronous acrawl/afetch API inside an event loop")
