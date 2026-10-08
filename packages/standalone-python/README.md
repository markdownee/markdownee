# Markdownee

<table>
  <tbody>
    <tr>
      <td>
        <img class="align-right" align="right" width="220" src="https://www.markdownee.com/media/logo-opaque.svg" alt="Markdownee" />
        <a href="https://pypi.org/project/markdownee/"><img src="https://img.shields.io/pypi/v/markdownee.svg" alt="PyPI version" /></a>
        <a href="https://pypi.org/project/markdownee/"><img src="https://img.shields.io/pypi/dm/markdownee.svg" alt="PyPI downloads" /></a>
        <a href="https://github.com/markdownee/markdownee/blob/main/LICENSE"><img src="https://img.shields.io/pypi/l/markdownee.svg" alt="license" /></a>
        <h3>Also available as:</h3>
        <strong><a href="https://www.markdownee.com/">Online playground</a></strong> | <strong><a href="https://www.npmjs.com/package/@markdownee/markdownee">npm package CLI &amp; lib</a></strong> | <strong><a href="https://github.com/markdownee/markdownee">Source code on GitHub</a></strong> | <strong><a href="https://apify.com/markdownee/crawler?fpr=glueo">Apify Actor</a></strong>
        <h3>Docs</h3>
        <strong><a href="https://www.markdownee.com/help/getting-started/">Getting started</a></strong> | <strong><a href="https://www.markdownee.com/help/pypi/">Python library help</a></strong>
        <h3>Social</h3>
        <strong><a href="https://github.com/markdownee/markdownee">Star us on GitHub</a></strong> | <strong><a href="https://github.com/markdownee">Follow us on GitHub</a></strong>
      </td>
    </tr>
  </tbody>
</table>

Markdownee is a web scraper that crawls websites and saves their content as **Markdown**, HTML or plain text for LLMs, retrieval pipelines, and research datasets.

Choose which links to follow, set page and depth limits, and select how much page content to keep. Control tables, links, images, and user comments separately.

- Boilerplate removal uses the native Python implementation of [Trafilatura Core](https://www.trafilaturacore.com/), our **open-source extraction engine** based on [Trafilatura](https://www.markdownee.com/trafilatura/).

  The _Core_ in its name means it is reduced to _one task_: extracting main content by removing boilerplate. Other packages handle output conversion, including Markdown.

  Trafilatura Core's TypeScript extraction core is ported from the original Python [Trafilatura](https://github.com/adbar/trafilatura), with [go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM translation aid. Its native Python library translates that TypeScript implementation.

  [Compared with Mozilla Readability](https://www.trafilaturacore.com/comparison/), Trafilatura and Trafilatura Core use layered structural and content heuristics with fallback and recall escalation, rather than centering extraction on the candidate scoring inherited from Arc90’s original readability.js article extractor; Trafilatura Core also offers configuration options for boilerplate removal.

- [Crawlee](https://crawlee.dev/) handles crawling and uses [Playwright](https://playwright.dev/) for browser rendering.

- Two language versions — **TypeScript** and **Python**: self-host with the [npm CLI](https://www.markdownee.com/help/npm-cli/), [npm library](https://www.markdownee.com/help/npm-library/), or [Python library](https://www.markdownee.com/help/pypi/), or use the [hosted Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo). Source code is on [GitHub](https://github.com/markdownee/markdownee).

- Save image files with the optional **image downloading** mode.

This package provides the native Python library, using Crawlee Python and Python Trafilatura Core. Python exposes library APIs only; see the [language differences](https://www.markdownee.com/help/pypi/) for its supported crawl controls.

## Install

Use Python 3.12 or newer:

```bash
python -m pip install markdownee
```

Tested PyPI platforms are macOS and Linux on x64/ARM64, and Windows x64.
Native Windows ARM64 support is planned but currently blocked by `impit` packaging;
32-bit Windows (x86) is unsupported.

HTTP crawling needs no browser download. For Chromium crawling, install the
Playwright browser:

```bash
python -m playwright install chromium
```

Firefox has its own setup in [Python Help](https://www.markdownee.com/help/pypi/).
The package installs its dependencies, including `pyvips[binary]`; platforms without
its binary support need a compatible libvips installation.

## Extract a page

Save as `extract.py`, then run `python extract.py`:

```python
from markdownee import fetch

contents = fetch(
    "https://docs.python.org/3/tutorial/introduction.html",
    crawler_type="http",
    formats=["markdown"],
)
print(contents["markdown"])
```

The program prints the extracted article. `fetch()` follows no links; unavailable
formats are omitted and request failure raises `MarkdowneeError`. Format selectors
are `txt`, `markdown`, `html`, `minified-html`, and `original`; compact HTML uses the
result key `minified_html`. Original is _captured input_, not cleaned output.

Use `afetch()` in async applications. `crawl()` and `acrawl()` write a fresh run
directory and return a `CrawlSummary` with output and manifest paths. Image saving
belongs to these file-producing calls; `fetch()` rejects it.

See [Python Help](https://www.markdownee.com/help/pypi/) for complete examples,
options, browser controls, limits, cancellation, and language differences.

## Why Markdownee

<!-- @generated:start name="why-markdownee" -->

<!-- This block is auto-generated by @markdownee/gen-md-regions. Do not edit. -->

Choose what to fetch, _which content to retain_, and where to save it. Page limits,
link filters, and separate controls for images, tables, links, and user comments
keep those choices explicit. Optional image downloading keeps local assets with
extracted content.

[Trafilatura Core](https://www.trafilaturacore.com/) removes boilerplate. Markdownee's
TypeScript and Python versions each use the matching Core implementation.
Core's TypeScript extraction core ports original Python
[Trafilatura](https://github.com/adbar/trafilatura), with
[go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM translation
aid. Its native Python library translates that TypeScript implementation.
[Crawlee](https://crawlee.dev/) drives [Playwright](https://playwright.dev/)
for browser rendering.

Use the [npm CLI](https://www.markdownee.com/help/npm-cli/),
[npm library](https://www.markdownee.com/help/npm-library/),
[native Python library](https://www.markdownee.com/help/pypi/), or
[hosted Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo).

<!-- @generated:end name="why-markdownee" -->

## Support

Report problems through the [issue tracker](https://github.com/markdownee/markdownee/issues).

## License

Licensed under [Apache-2.0](https://github.com/markdownee/markdownee/blob/main/LICENSE).
