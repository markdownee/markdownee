# Markdownee

<table align="right">
  <tbody>
    <tr>
      <td>
        <img width="220" src="https://www.markdownee.com/media/logo.svg" alt="Markdownee" />
        <br />
        <a href="https://www.npmjs.com/package/@markdownee/markdownee"><img src="https://img.shields.io/npm/v/%40markdownee%2Fmarkdownee.svg" alt="npm version" /></a>
        <br />
        <a href="https://www.npmjs.com/package/@markdownee/markdownee"><img src="https://img.shields.io/npm/dm/%40markdownee%2Fmarkdownee.svg" alt="npm downloads" /></a>
        <br />
        <a href="https://github.com/markdownee/markdownee/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/%40markdownee%2Fmarkdownee.svg" alt="license" /></a>
        <h3>Also available as:</h3>
        <ul>
          <li>
            <strong><a href="https://www.markdownee.com/">Online playground</a></strong>
          </li>
          <li>
            <strong><a href="https://apify.com/markdownee/crawler?fpr=glueo">Apify Actor</a></strong>
          </li>
          <li>
            <strong><a href="https://pypi.org/project/markdownee/">Python library on PyPI</a></strong>
          </li>
          <li>
            <strong><a href="https://github.com/markdownee/markdownee">Source code on GitHub</a></strong>
          </li>
        </ul>
        <h3>Docs</h3>
        <ul>
          <li><a href="https://www.markdownee.com/help/getting-started/">Getting started</a></li>
          <li><a href="https://www.markdownee.com/help/npm-cli/">CLI help</a></li>
          <li><a href="https://www.markdownee.com/help/npm-library/">Library help</a></li>
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

- Boilerplate removal is powered by [Trafilatura Core](https://www.trafilaturacore.com/), our **open-source fork** of [Trafilatura](https://www.markdownee.com/trafilatura/).

  The _Core_ in its name means it is reduced to _one task_: extracting main content by removing boilerplate. Other packages handle output conversion, including Markdown.

  Trafilatura Core is ported from the original Python [Trafilatura](https://github.com/adbar/trafilatura), with [go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM translation aid.

- [Crawlee](https://crawlee.dev/) handles crawling and uses [Playwright](https://playwright.dev/) for browser rendering.

- Two language versions — **TypeScript** and **Python**: self-host with the [npm CLI](https://www.markdownee.com/help/npm-cli/), [npm library](https://www.markdownee.com/help/npm-library/), or [Python library](https://www.markdownee.com/help/pypi/), or use the [hosted Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo). Source code is on [GitHub](https://github.com/markdownee/markdownee).

- Save image files with the optional **image downloading** mode.

This package provides the TypeScript library and CLI.

Use `fetch` to return one page directly without opening a dataset or key-value
store. Use `crawl` to collect records and `export` to write stored results to an
output directory. `purge` removes the selected local storage. Inspect the first
result before expanding a collection; the
[CLI guide](https://www.markdownee.com/help/npm-cli/) explains each command's input
and output.

## Contents

- [Install](#install)
- [Usage: library](#usage-library)
- [Usage: CLI](#usage-cli)
- [Why Markdownee](#why-markdownee)
- [Support](#support)
- [License](#license)

## Install

Use Node.js 22.22.2+ on 22.x, 24.15.0+ on 24.x, or 26+. In a new project directory:

```bash
npm init -y
npm install @markdownee/markdownee
```

The HTTP examples below need no browser. For adaptive or Chromium crawling, also
install Chromium; install Firefox instead when selecting the Firefox crawler:

```bash
npx playwright install chromium
```

## Usage: library

Save this as `extract.mjs`:

```javascript
import { fetch } from '@markdownee/markdownee';

const { markdown } = await fetch(
  'https://en.wikipedia.org/wiki/Web_scraping',
  { crawlerType: 'cheerio' },
);
console.log(markdown);
```

```bash
node extract.mjs
```

The program prints extracted Markdown. `fetch()` follows no links, returns selected
formats, and throws on request failure. It rejects image saving; use a file-producing
CLI fetch or a crawl for downloaded images. The
[library guide](https://www.markdownee.com/help/npm-library/) covers `createCrawler`,
options, output layouts, storage, and export APIs.

## Usage: CLI

After the local installation above:

```bash
npx markdownee fetch https://en.wikipedia.org/wiki/Web_scraping \
  --crawler-type cheerio --save markdown-file -o page.md
```

This writes `page.md`; diagnostics go to stderr. Omit the file route to print
Markdown to stdout. The other commands are `crawl` for stored collection, `export`
for files and a manifest, and `purge` for permanent removal of selected local buckets.
See the [CLI guide](https://www.markdownee.com/help/npm-cli/) for configuration,
limits, image files, and the full flag reference.

## Why Markdownee

<!-- @generated:start name="why-markdownee" -->

<!-- This block is auto-generated by @markdownee/gen-md-regions. Do not edit. -->

Choose what to fetch, _which content to retain_, and where to save it. Page limits,
link filters, and separate controls for images, tables, links, and user comments
keep those choices explicit. Optional image downloading keeps local assets with
extracted content.

[Trafilatura Core](https://www.trafilaturacore.com/) ports original Python
[Trafilatura](https://github.com/adbar/trafilatura), with
[go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM translation
aid. [Crawlee](https://crawlee.dev/) drives [Playwright](https://playwright.dev/)
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
