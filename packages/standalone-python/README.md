# markdownee

<table>
  <tbody>
    <tr>
      <td>
        <img align="right" width="220" src="https://www.markdownee.com/media/cover-mini.svg" alt="Markdownee" />
        <a href="https://pypi.org/project/markdownee/"><img src="https://img.shields.io/pypi/v/markdownee.svg" alt="PyPI version" /></a>
        <a href="https://pypi.org/project/markdownee/"><img src="https://img.shields.io/pypi/dm/markdownee.svg" alt="PyPI downloads" /></a>
        <a href="https://github.com/markdownee/markdownee/blob/main/LICENSE"><img src="https://img.shields.io/pypi/l/markdownee.svg" alt="license" /></a>
        <h3>Also available as:</h3>
        <strong><a href="https://www.markdownee.com/">Online playground</a></strong> <sub><a href="https://www.markdownee.com/">playground</a>, <a href="https://www.markdownee.com/help/web/">help</a></sub> | <strong><a href="https://apify.com/markdownee/crawler?fpr=glueo">Apify Actor</a></strong> <sub><a href="https://apify.com/markdownee/crawler?fpr=glueo">actor</a>, <a href="https://www.markdownee.com/help/apify/">help</a></sub> | <strong><a href="https://www.npmjs.com/package/markdownee">npm package CLI &amp; lib</a></strong> <sub><a href="https://www.npmjs.com/package/markdownee">package</a>, <a href="https://www.markdownee.com/help/npm/">CLI help</a>, <a href="https://www.markdownee.com/help/npm-lib/">lib help</a></sub> | <strong><a href="https://github.com/markdownee/markdownee">Source code on GitHub</a></strong>
      </td>
    </tr>
  </tbody>
</table>

Crawl pages and extract content with native Python Crawlee and Trafilatura Core.

> **Alpha / experimental.** This maintained Python library is not fully tested
> or officially supported. TypeScript remains Markdownee's primary implementation.

Python performs crawling, extraction, conversion, and image processing without
a bundled Markdownee or Trafilatura Core Node engine. Both languages live in
the same [source repository](https://github.com/markdownee/markdownee).
Their supported controls differ; see [Python coverage](#python-coverage).

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Crawling multiple pages](#crawling-multiple-pages)
- [Options](#options)
- [Python coverage](#python-coverage)
- [Images](#images)

## Install

Use Python 3.12 or later. The native alpha requires matching native
Trafilatura Core `0.1.0a2`. For a source checkout, install both local Python
packages, or install their built wheels together. For published native
prereleases, select the native version explicitly:

```bash
pip install --pre "markdownee==0.5.0a1"
```

HTTP crawling needs no browser. Chromium or Firefox crawling requires the
corresponding Playwright browser:

```bash
playwright install chromium
# For crawler_type="firefox":
playwright install firefox
```

These are dependency setup commands. Markdownee exposes **Python library APIs
only**, with no console script or `python -m markdownee` interface. Playwright
manages its own browser driver; it does not run either product's Node engine.

Markdownee builds a platform-independent Python wheel and a source
distribution. Crawlee, Trafilatura Core, lxml, Playwright, and
`pyvips[binary]` are installed as dependencies. The pyvips binary extra
provides libvips on supported platforms; other platforms need a compatible
libvips installation and the dependencies' own installation requirements.

## Quick start

`fetch` follows no links and returns requested content:

```python
from markdownee import fetch

contents = fetch(
    "https://www.iana.org/help/example-domains",
    crawler_type="http",
    formats=["markdown", "minified-html", "original"],
)
print(contents["markdown"])
```

Format selectors are `txt`, `markdown`, `html`, `minified-html`, and
`original`. Result keys use `minified_html`; the other names are unchanged.
Markdown is the default. Original is the captured HTML, before cleaning.
Missing cleaned content is omitted; a failed single-page request raises
`MarkdowneeError`.

Use `afetch` in an asynchronous application:

```python
import asyncio
from markdownee import afetch


async def main():
    contents = await afetch(
        "https://www.iana.org/help/example-domains",
        crawler_type="http",
    )
    print(contents["markdown"])


asyncio.run(main())
```

## Crawling multiple pages

`crawl` writes files and a JSON manifest into an isolated directory beneath
`output_dir`. Its `CrawlSummary` exposes `total`, `succeeded`, `failed`,
`skipped`, `output_dir`, and `manifest_path`. Partial page failures retain
successful output. `acrawl` has the same arguments asynchronously.

```python
from markdownee import crawl

summary = crawl(
    ["https://www.iana.org/help/example-domains"],
    output_dir="./out",
    formats=["markdown", "html"],
    selector="main a",
    max_requests_per_crawl=5,
    max_crawl_depth=1,
)
print(summary.succeeded, summary.failed, summary.manifest_path)
```

Link following requires a nonempty `selector` and remains on the seed page's
origin. `globs` and `exclude` filter discovered links. Crawlee deduplicates
request URLs; Python does not offer TypeScript's content-deduplication modes.
Request and depth limits accept zero for unlimited; `timeout` still bounds
the whole call. Concurrent requests can slightly exceed the request limit.

## Options

Both APIs validate snake_case keywords before fetching. Unknown options raise
`MarkdowneeError`; options are not translated into CLI arguments.

| Option                                      | Values / default                                             |
| ------------------------------------------- | ------------------------------------------------------------ |
| `crawler_type`                              | `http` (default), `chromium`, `firefox`                      |
| `mode`                                      | `precision`, `balanced` (default), `recall`, `keep`          |
| `output_layout`                             | `minimal` (default), `standard`, `enhanced`                  |
| `image_handling`                            | `exclude`, `alt-text` (default), `resolved-url`, `save`      |
| `link_handling`, `table_handling`           | `include` (default), `exclude`                               |
| `comment_handling`                          | `include`, `exclude` (default)                               |
| `language`                                  | Filter conflicting declared page languages; unset by default |
| `timeout`, `navigation_timeout`             | Whole-call 120 seconds; request 30 seconds                   |
| `max_retries`                               | 2                                                            |
| `max_requests_per_crawl`, `max_crawl_depth` | 100 and 3; crawl only                                        |
| `initial_concurrency`, `max_concurrency`    | 1 and 5; crawl only                                          |
| `respect_robots_txt`                        | `True`; checks allow/disallow, not crawl-delay               |
| `headers`, `user_agent`                     | Optional HTTP headers and user agent                         |
| `proxy`                                     | List of HTTP(S) proxy URLs; no SOCKS or Apify proxy controls |
| `max_input_bytes`                           | 10 MiB at the captured-HTML boundary                         |

`minimal` returns body text and HTML fragments. `standard` adds ordinary
metadata as flat YAML front matter and a complete HTML document.
`enhanced` adds allowlisted page and crawl fields. TXT preserves
preformatted content and table cells; Markdown includes headings, links,
tables, and image references.

Browser controls include `headless=True`, `block_media=True`,
`ignore_https_errors=False`, and `wait_until="domcontentloaded"`.
`max_scroll_height` bounds scrolling; `wait_for_dynamic_content` bounds a
network-idle wait. `wait_for_selector` is required and
`soft_wait_for_selector` is optional. Durations are **seconds**. HTTP
supports the required selector as a presence check and rejects dynamic
waits or scrolling.

## Python coverage

The native API implements HTTP and explicit Chromium/Firefox crawling,
retries, proxies, headers, request/depth limits, link selectors and filters,
declared-language filtering, all five product formats, three layouts, and
image saving. It calls Python Trafilatura Core once per page and renders the
selected formats from that result.

TypeScript additionally provides adaptive crawler selection, consent-wall
recovery, served-Markdown discovery, sitemap seeding, configurable content
deduplication, persistent session stores, custom cookies, and Apify storage
routes. These controls are not accepted by the Python API. `cheerio` is a
TypeScript crawler name; select `http` in Python. Python does not promise
byte-identical HTML/Markdown serialization or performance parity.

Cancellation stops awaiting the crawl. CPU work already running in an
extraction/image worker may finish; byte and pixel limits bound its input.
HTTP responses and browser documents are captured before the HTML size
check; `max_input_bytes` is not a network download limit.

## Images

Use `image_handling="save"` with `crawl` or `acrawl`; return-only calls
reject it. Images download through the crawl's session/proxy channel with
a 10 MiB per-image stream limit. Failures retain the resolved URL and add a
manifest warning.

JPEG, PNG, WebP, GIF, TIFF, and AVIF images become metadata-stripped WebP
(first frame for animation). Other raster formats retain their source URL.
`max_image_edge=2048` limits the long edge without upscaling; zero keeps
raster dimensions. Images smaller than 64 pixels on both edges are dropped.
SVG geometry passes a static allowlist before it is rasterized to PNG,
with a 1568-pixel edge ceiling. `rasterize_svg=False` stores the cleaned
SVG instead. External SVG resources, scripts, events, and style attributes
are removed. `max_image_bytes` and `max_image_pixels` customize resource
caps.

Selecting `original` also retains downloaded source image bytes as
`*-original.bin`; these files are unprocessed originals. Output HTML and
Markdown reference the transformed local files.

## Why Markdownee

<!-- @generated:start name="why-markdownee" -->

<!-- This block is auto-generated by @markdownee/gen-md-regions. Do not edit. -->

Choose a fetching method, select the content to retain, and export the result for your
application. Markdownee supports **research corpora, retrieval pipelines, and training-data
preparation**. Its [Markdown output](https://www.markdownee.com/about/#token-efficient-output-for-llms)
removes HTML syntax; the token saving depends on the page and extraction settings.

- Boilerplate removal is powered by **[Trafilatura Core](https://www.trafilaturacore.com/)**, our
  **open-source pure-TypeScript port** of
  [Trafilatura](https://www.markdownee.com/trafilatura/). Its **extraction core** is a
  direct port of Python Trafilatura — with
  [go-trafilatura](https://github.com/markusmobius/go-trafilatura) used only as a DOM translation
  aid — and applies **Trafilatura's own heuristics** to strip navigation, sidebars, footers, and
  similar clutter
- Fetch JavaScript-rendered pages with **[Playwright](https://playwright.dev/)** before
  extracting their HTML, or choose HTTP-only fetching
- Use the primary **TypeScript** implementation on Node.js or the maintained alpha
  [native Python library](https://www.markdownee.com/help/pypi/) with Crawlee Python
  and Python Trafilatura Core; neither extraction path requires a GPU
- Choose self-hosted execution through the
  [npm CLI](https://www.markdownee.com/help/npm/) or
  [npm library](https://www.markdownee.com/help/npm-lib/), run the
  [hosted Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo); the open-source code is on
  [GitHub](https://github.com/markdownee/markdownee)
- Enable **image downloading** when your output needs local image files

|                    | Markdownee                                                             | Firecrawl                              | Jina Reader                                  | Crawl4AI                                          |
| ------------------ | ---------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Content processing | Trafilatura Core heuristics                                            | Scraping and optional model extraction | Readability and Markdown conversion profiles | Markdown generation and optional filters          |
| Runtime            | Node (primary TypeScript) · native Python (alpha)                      | hosted API / self-host                 | hosted API                                   | Python                                            |
| Surfaces           | Online playground · Apify Actor · npm CLI · npm library · PyPI (alpha) | API · SDKs · self-hosted · MCP         | API                                          | Python library · crwl CLI · Docker REST API · MCP |
| Output formats     | txt · markdown · html · minified-html · original                       | markdown · html · etc.                 | markdown · html · text · screenshot · etc.   | markdown · etc.                                   |
| Crawling           | Crawlee + Playwright (adaptive / browser / HTTP)                       | built-in                               | none (single URL)                            | built-in                                          |

The comparison describes available interfaces, not measured quality or speed. See the
[Firecrawl documentation](https://docs.firecrawl.dev/introduction),
[Jina Reader architecture](https://github.com/jina-ai/reader/blob/main/architecture.md), and
[Crawl4AI Markdown documentation](https://docs.crawl4ai.com/core/markdown-generation/)
for each project's options. Jina Reader's ReaderLM profile is optional; the API and the
ReaderLM model are distinct products.

<!-- @generated:end name="why-markdownee" -->

## Contributing

Use the [issue tracker](https://github.com/markdownee/markdownee/issues)
for reports and the [source repository](https://github.com/markdownee/markdownee)
for proposed changes.

## License

[Apache-2.0](https://github.com/markdownee/markdownee/blob/main/LICENSE)
