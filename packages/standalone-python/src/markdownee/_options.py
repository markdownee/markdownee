"""Validated native Python options; no CLI argument translation."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Literal, TypedDict, get_args, get_type_hints
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, ValidationError

from ._errors import MarkdowneeError, ProxySchemeError

Format = Literal["txt", "markdown", "html", "minified-html", "original"]
CrawlerType = Literal["http", "chromium", "firefox"]
Mode = Literal["precision", "balanced", "recall", "keep"]
Handling = Literal["include", "exclude"]
ImageHandling = Literal["exclude", "alt-text", "resolved-url", "save"]
Layout = Literal["minimal", "standard", "enhanced"]
WaitUntil = Literal["load", "domcontentloaded", "networkidle", "commit"]


class FetchOptions(TypedDict, total=False):
    """Single-page controls. Durations are seconds; byte/pixel limits are integers."""

    crawler_type: CrawlerType
    mode: Mode
    output_layout: Layout
    image_handling: ImageHandling
    link_handling: Handling
    table_handling: Handling
    comment_handling: Handling
    language: str
    max_retries: int
    navigation_timeout: float
    max_input_bytes: int
    max_image_bytes: int
    max_image_pixels: int
    max_image_edge: int
    rasterize_svg: bool
    respect_robots_txt: bool
    proxy: list[str]
    headers: dict[str, str]
    user_agent: str
    headless: bool
    block_media: bool
    ignore_https_errors: bool
    wait_until: WaitUntil
    wait_for_selector: str
    soft_wait_for_selector: str
    wait_for_dynamic_content: float
    max_scroll_height: int


class CrawlOptions(FetchOptions, total=False):
    """Crawl controls in addition to single-page extraction settings."""

    selector: str
    globs: list[str]
    exclude: list[str]
    max_requests_per_crawl: int
    max_crawl_depth: int
    initial_concurrency: int
    max_concurrency: int
    keep_url_fragment: bool


class Options(BaseModel):
    """Fully validated settings consumed by the Python implementation."""

    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    crawler_type: CrawlerType = "http"
    mode: Mode = "balanced"
    output_layout: Layout = "minimal"
    image_handling: ImageHandling = "alt-text"
    link_handling: Handling = "include"
    table_handling: Handling = "include"
    comment_handling: Handling = "exclude"
    language: str = ""
    max_retries: int = 2
    navigation_timeout: float = 30
    max_input_bytes: int = 10 * 1024 * 1024
    max_image_bytes: int = 10 * 1024 * 1024
    max_image_pixels: int = 0x3FFF * 0x3FFF
    max_image_edge: int = 2048
    rasterize_svg: bool = True
    respect_robots_txt: bool = True
    proxy: list[str] | None = None
    headers: dict[str, str] | None = None
    user_agent: str = ""
    headless: bool = True
    block_media: bool = True
    ignore_https_errors: bool = False
    wait_until: WaitUntil = "domcontentloaded"
    wait_for_selector: str = ""
    soft_wait_for_selector: str = ""
    wait_for_dynamic_content: float = 0
    max_scroll_height: int = 0
    selector: str = ""
    globs: list[str] | None = None
    exclude: list[str] | None = None
    max_requests_per_crawl: int = 100
    max_crawl_depth: int = 3
    initial_concurrency: int = 1
    max_concurrency: int = 5
    keep_url_fragment: bool = False


def validate_url(url: str) -> str:
    """Require an absolute HTTP(S) URL without revealing credentials on failure."""
    try:
        parsed = urlsplit(url)
        valid = parsed.scheme in {"http", "https"} and bool(parsed.hostname)
        valid = valid and parsed.username is None and parsed.password is None
        _ = parsed.port
    except (ValueError, TypeError, AttributeError):
        valid = False
    if not valid:
        raise MarkdowneeError("URLs must be absolute HTTP(S) URLs without userinfo")
    return url


def validate_proxies(proxies: Sequence[str]) -> None:
    """Validate the HTTP(S) proxy protocols supported by the native HTTP client."""
    for raw in proxies:
        try:
            parsed = urlsplit(raw)
            valid = parsed.scheme in {"http", "https"} and bool(parsed.hostname)
            _ = parsed.port
        except (ValueError, TypeError):
            valid = False
        if not valid:
            raise ProxySchemeError("proxy must be an absolute HTTP or HTTPS URL")


def validate_formats(formats: Sequence[Format] | None) -> tuple[Format, ...]:
    """Validate selected outputs before any crawl starts."""
    if isinstance(formats, str) or (formats is not None and not isinstance(formats, Sequence)):
        raise MarkdowneeError("formats must be a sequence of format selectors")
    selected = ("markdown",) if formats is None else tuple(formats)
    if not selected or any(item not in get_args(Format) for item in selected):
        raise MarkdowneeError("formats must select txt, markdown, html, minified-html, or original")
    return tuple(dict.fromkeys(selected))


def validate_options(values: Mapping[str, object], *, single: bool = False) -> Options:
    """Reject unknown or invalid controls rather than silently dropping options."""
    allowed = get_type_hints(FetchOptions if single else CrawlOptions)
    unknown = values.keys() - allowed.keys()
    if unknown:
        raise MarkdowneeError(f"unknown Python option: {sorted(unknown)[0]}")
    try:
        options = Options(**values)
    except ValidationError as error:
        key = error.errors(include_input=False)[0]["loc"][0]
        raise MarkdowneeError(f"invalid Python option: {key}") from None
    positive = {
        "navigation_timeout",
        "max_input_bytes",
        "max_image_bytes",
        "max_image_pixels",
        "max_concurrency",
    }
    nonnegative = {
        "max_requests_per_crawl",
        "max_crawl_depth",
        "max_image_edge",
        "max_scroll_height",
        "wait_for_dynamic_content",
        "max_retries",
        "initial_concurrency",
    }
    for key in positive | nonnegative:
        value = getattr(options, key)
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise MarkdowneeError(f"{key} must be finite")
        if value < 0 or (key in positive and value == 0):
            raise MarkdowneeError(f"{key} is outside its allowed range")
    if options.initial_concurrency > options.max_concurrency:
        raise MarkdowneeError("initial_concurrency must not exceed max_concurrency")
    validate_proxies(options.proxy or [])
    if single and options.image_handling == "save":
        raise MarkdowneeError("image_handling='save' requires crawl(output_dir=...)")
    if options.crawler_type == "http" and (
        options.soft_wait_for_selector
        or options.wait_for_dynamic_content
        or options.max_scroll_height
    ):
        raise MarkdowneeError("dynamic waits and scrolling require chromium or firefox")
    return options
