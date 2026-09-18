# markdownee — Python (PyPI) library example

These examples call the alpha [`markdownee`](https://pypi.org/project/markdownee/)
native Python library to collect pages as `txt`, `markdown`, readable `html`, compact
`minified-html`, or crawler-captured `original` HTML.

TypeScript remains the primary implementation. Python uses
[Crawlee Python](https://crawlee.dev/python/) for crawling and
[Python Trafilatura Core](https://www.trafilaturacore.com/) for extraction.
The default HTTP crawler needs no browser setup. The library bundles no Node
product engine and provides no product CLI.

## Example programs

- `main.py` uses synchronous `crawl()` to export Markdown, compact HTML, and
  original HTML into a fresh run directory. It prints the summary, reads the
  manifest, lists exported files, then requests a Markdown
  result map with `fetch()`.
- `async_example.py` awaits `acrawl()` for several URLs and `afetch()`
  for one page with a dictionary of requested formats.

## Install the native version

Install the matching native release when it is available:

```bash
pip install markdownee==0.5.0a1
python main.py
python async_example.py
```

For `crawler_type="chromium"`, install that browser through the dependency:

```bash
python -m playwright install chromium
```

## Run from this repository

`run.sh` builds a Python wheel and source archive, installs the wheel into a
fresh virtual environment, and runs both examples. For unreleased changes,
first build the matching Trafilatura Core wheel with its Python example runner,
then pass that wheel to this runner:

```bash
./run.sh /path/to/trafilaturacore-0.1.0a5-py3-none-any.whl
```

The build requires `uv`, Python 3.12 or newer, and this checkout. Omitting the
wheel argument resolves the exact Trafilatura Core dependency from PyPI. The
runner prints its temporary artifact and output directory; it downloads Python
dependencies and fetches the example URLs. It needs no Node.js build.

Both programs also accept URL arguments for testing against your own pages:

```bash
python main.py https://example.com
python async_example.py https://example.com https://www.iana.org/domains/reserved
```

## Options

Pass crawl options as snake_case keywords, including
`formats=["markdown", "original"]`,
`max_requests_per_crawl=10`, `max_crawl_depth=2`,
`mode="precision"`, `proxy=["http://user:pass@host:3128"]`.

For `fetch()` and `afetch()`, select `formats=` from `txt`,
`markdown`, `html`, `minified-html`, and `original`; Markdown is the default.
These calls accept `FetchOptions`, excluding crawl-frontier and file-export
controls. Both return a `FetchResult` dictionary for one or
several formats, with `minified_html` as the key for `minified-html`.
Formats without content are omitted; failed extraction raises an error.

The [package README](../../packages/standalone-python/README.md) documents the
remaining options and the `CrawlSummary` result.
