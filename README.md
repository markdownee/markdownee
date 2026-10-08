# Markdownee

<table align="right">
  <tbody>
    <tr>
      <td>
        <img width="220" src="media/logo-opaque.svg" alt="Markdownee" />
        <br />
        <a href="https://www.npmjs.com/package/@markdownee/markdownee"><img src="https://img.shields.io/npm/v/%40markdownee%2Fmarkdownee.svg" alt="npm version" /></a>
        <br />
        <a href="https://www.npmjs.com/package/@markdownee/markdownee"><img src="https://img.shields.io/npm/dm/%40markdownee%2Fmarkdownee.svg" alt="npm downloads" /></a>
        <br />
        <a href="https://github.com/markdownee/markdownee/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/%40markdownee%2Fmarkdownee.svg" alt="license" /></a>
        <h3>Available as:</h3>
        <ul>
          <li>
            <strong><a href="https://www.markdownee.com/">Online playground</a></strong>
          </li>
          <li>
            <strong><a href="https://www.npmjs.com/package/@markdownee/markdownee">npm package CLI &amp; lib</a></strong>
          </li>
          <li>
            <strong><a href="https://pypi.org/project/markdownee/">Python library on PyPI</a></strong>
          </li>
          <li>
            <strong><a href="https://apify.com/markdownee/crawler?fpr=glueo">Apify Actor</a></strong>
          </li>
        </ul>
        <h3>Docs</h3>
        <ul>
          <li><a href="https://www.markdownee.com/help/getting-started/">Getting started</a></li>
          <li><a href="https://www.markdownee.com/help/npm-cli/">CLI help</a></li>
          <li><a href="https://www.markdownee.com/help/npm-library/">Library help</a></li>
          <li><a href="https://www.markdownee.com/help/pypi/">Python library help</a></li>
          <li><a href="https://www.markdownee.com/help/apify/">Actor guide</a></li>
        </ul>
        <h3>Social</h3>
        <ul>
          <li><a href="https://github.com/markdownee/markdownee">Star us on GitHub</a></li>
          <li><a href="https://github.com/markdownee">Follow us on GitHub</a></li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

Markdownee is a web scraper that crawls websites and saves their content as **Markdown**, HTML or plain text for LLMs, retrieval pipelines, and research datasets.

Choose which links to follow, set page and depth limits, and select how much page content to keep. Control tables, links, images, and user comments separately.

- Boilerplate removal uses [Trafilatura Core](https://www.trafilaturacore.com/), our **open-source extraction engine** based on [Trafilatura](https://www.markdownee.com/trafilatura/), available in TypeScript and Python. Markdownee's TypeScript and Python versions each use the matching Core implementation.

  The _Core_ in its name means it is reduced to _one task_: extracting main content by removing boilerplate. Other packages handle output conversion, including Markdown.

  Trafilatura Core's TypeScript extraction core is ported from the original Python [Trafilatura](https://github.com/adbar/trafilatura), with [go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM translation aid. Its native Python library translates that TypeScript implementation.

  [Compared with Mozilla Readability](https://www.trafilaturacore.com/comparison/), Trafilatura and Trafilatura Core use layered structural and content heuristics with fallback and recall escalation, rather than centering extraction on the candidate scoring inherited from Arc90’s original readability.js article extractor; Trafilatura Core also offers configuration options for boilerplate removal.

- [Crawlee](https://crawlee.dev/) handles crawling and uses [Playwright](https://playwright.dev/) for browser rendering.

- Two language versions — **TypeScript** and **Python**: self-host with the [npm CLI](https://www.markdownee.com/help/npm-cli/), [npm library](https://www.markdownee.com/help/npm-library/), or [Python library](https://www.markdownee.com/help/pypi/), or use the [hosted Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo).

- Save image files with the optional **image downloading** mode.

The [playground](https://www.markdownee.com/) previews a page and generates commands
for your settings. Use `fetch` for a single page or `crawl` to collect records with
limits and link filters. Library calls return data to your application; the
[library guide](https://www.markdownee.com/help/npm-library/) explains their options
and storage behavior. Browser installation is needed only for browser crawling.

Fetch one page into memory or a file, or collect a crawl for later export. The CLI
can export stored results or remove its selected storage. Start with a bounded
crawl, inspect the first result, and then expand the collection. Python uses
Crawlee Python and Python Trafilatura Core, with its capability differences
documented separately in [Python library help](https://www.markdownee.com/help/pypi/).

## Quick start

Use Node.js 22.22.2+ on 22.x, 24.15.0+ on 24.x, or 26+:

```bash
npx --package=@markdownee/markdownee markdownee fetch \
  https://en.wikipedia.org/wiki/Web_scraping \
  --crawler-type cheerio --save markdown-file -o page.md
```

Open `page.md` for the extracted article. Cheerio fetches over HTTP and needs no
browser installation; `npx` downloads the package when needed. For JavaScript-rendered
pages, follow [browser setup](https://www.markdownee.com/help/npm-cli/).

Continue with the [CLI](https://www.markdownee.com/help/npm-cli/),
[Node.js library](https://www.markdownee.com/help/npm-library/),
[Python library](https://www.markdownee.com/help/pypi/), or
[Apify guide](https://www.markdownee.com/help/apify/).
The [examples](examples/) contain complete programs.

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

Report reproducible problems through the
[issue tracker](https://github.com/markdownee/markdownee/issues).

## License

[Apache-2.0](LICENSE)
