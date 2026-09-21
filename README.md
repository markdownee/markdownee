# Markdownee

<table align="right">
  <tbody>
    <tr>
      <td>
        <img width="220" src="media/logo.svg" alt="Markdownee" />
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
            <br />
            <sub><a href="https://www.markdownee.com/">playground</a>, <a href="https://www.markdownee.com/help/web/">help</a></sub>
          </li>
          <li>
            <strong><a href="https://apify.com/markdownee/crawler?fpr=glueo">Apify Actor</a></strong>
            <br />
            <sub><a href="https://apify.com/markdownee/crawler?fpr=glueo">actor</a>, <a href="https://www.markdownee.com/help/apify/">help</a></sub>
          </li>
          <li>
            <strong><a href="https://www.npmjs.com/package/@markdownee/markdownee">npm package CLI &amp; lib</a></strong>
            <br />
            <sub><a href="https://www.npmjs.com/package/@markdownee/markdownee">package</a>, <a href="https://www.markdownee.com/help/npm/">CLI help</a>, <a href="https://www.markdownee.com/help/npm-lib/">lib help</a></sub>
          </li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

Markdownee is a web scraper that crawls websites and saves their content as
**Markdown**, HTML or plain text for LLMs, retrieval pipelines, and research datasets.

Choose which links to follow, set page and depth limits, and select how much page
content to keep. Control tables, links, images, and user comments separately.

Boilerplate removal is powered by [Trafilatura Core](https://www.trafilaturacore.com/), **our open-source fork of [Trafilatura](https://www.markdownee.com/trafilatura/)**. The **Core** in its name means it is reduced to one task: main-content extraction and boilerplate removal. Other packages handle output conversion, including Markdown. Trafilatura Core is ported from the original Python [Trafilatura](https://github.com/adbar/trafilatura), with [go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM translation aid. [Crawlee](https://crawlee.dev/) handles crawling and uses [Playwright](https://playwright.dev/) for browser rendering.

Two language versions — **TypeScript** and **Python**: use the **npm CLI or library**, the hosted
[Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo), or the
[native Python library](https://pypi.org/project/markdownee/). The npm CLI,
library, and Actor use TypeScript. Python uses Crawlee Python and Python
Trafilatura Core without a bundled Node product engine or product CLI. Their
supported controls and result shapes are documented separately.

Start with a sample, then bound collection with link selectors, URL globs,
sitemaps, and depth or page limits. Adjust content selection with `precision`,
`balanced`, or `recall`; choose `keep` to clean the whole document. Tables,
links, images, and comments have separate controls. Proxy rotation, session
pools, and consent handling help manage requests; some pages remain inaccessible.
Canonical URLs or content hashes can deduplicate results. Try one page in the
[playground](https://www.markdownee.com/), then run your collection through the
interface that suits your application.

**Website & docs:** [markdownee.com](https://www.markdownee.com) · **Try it:**
[Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo) · **Install:**
[npm](https://www.npmjs.com/package/@markdownee/markdownee) ·
[PyPI](https://pypi.org/project/markdownee/)

## Contents

- [Quick start](#quick-start)
- [Why Markdownee](#why-markdownee)
- [Features](#features)
- [CLI usage](#cli-usage)
- [Library usage](#library-usage)
- [Input schema](#input-schema)
- [Credits](#credits)
- [License](#license)

## Quick start

```bash
npm install @markdownee/markdownee
npx markdownee fetch https://en.wikipedia.org/wiki/Web_scraping \
  --crawler-type cheerio
```

This command uses HTTP-only fetching and needs no browser installation. It
writes extracted Markdown to stdout and diagnostics to stderr.

For content populated by JavaScript, provision Chromium and use the default
adaptive crawler. Choose the Firefox installation instead when using the
`firefox` crawler:

```bash
npx playwright install chromium
npx markdownee fetch https://en.wikipedia.org/wiki/Web_scraping
```

The native Python library has its own installation and defaults to HTTP fetching:

```bash
pip install markdownee
# Only for browser crawling:
playwright install chromium
```

```python
from markdownee import fetch

result = fetch("https://en.wikipedia.org/wiki/Web_scraping", formats=["markdown", "txt"])
print(result.get("markdown"))
```

Python supports HTTP, Chromium, and Firefox crawling, file exports, and image
processing. Adaptive fetching, consent automation, Markdown discovery, persistent
TypeScript storage, and Actor controls remain TypeScript-specific. See the
[Python API](./packages/standalone-python/README.md) for the complete supported scope.

The [Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo) needs no local
installation. Continue with the guide for your interface:
[npm CLI/library](./packages/standalone/README.md) ·
[Python](./packages/standalone-python/README.md) ·
[Apify Actor](./packages/apify-actor/README.md). The
[examples directory](./examples/) contains complete sample applications.

## Why Markdownee

<!-- @generated:start name="why-markdownee" -->

<!-- This block is auto-generated by @markdownee/gen-md-regions. Do not edit. -->

Choose what to fetch, what content to retain, and where to save it.
[Markdown output](https://www.markdownee.com/about/#token-efficient-output-for-llms)
removes HTML syntax; token savings depend on the page and extraction settings.

Boilerplate removal is powered by [Trafilatura Core](https://www.trafilaturacore.com/).
Trafilatura Core is ported from the original Python
[Trafilatura](https://github.com/adbar/trafilatura), with
[go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM
translation aid. [Crawlee](https://crawlee.dev/) handles crawling and uses
[Playwright](https://playwright.dev/) for browser rendering.

Two language versions — **TypeScript** and **Python**: self-host with the
[npm CLI](https://www.markdownee.com/help/npm/),
[npm library](https://www.markdownee.com/help/npm-lib/), or
[native Python library](https://www.markdownee.com/help/pypi/), or use the
[hosted Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo). The npm
surfaces use Crawlee and TypeScript Trafilatura Core; Python uses Crawlee Python
and Python Trafilatura Core. Neither extraction path requires a GPU. Source is on
[GitHub](https://github.com/markdownee/markdownee).

Optional image downloading keeps local images with extracted content.

<!-- @generated:end name="why-markdownee" -->

## Features

- **Content selection:** Trafilatura Core applies heuristics to separate main
  content from navigation, headers, footers, and other page furniture.
- **Fetching choices:** adaptive Playwright, explicit Chromium or Firefox, and
  HTTP-only Cheerio.
- **Output selection:** `txt`, `markdown`, `html`, `minified-html`, and raw
  `original` HTML, routed independently to supported destinations.
- **Crawl limits:** CSS link selectors, URL include/exclude globs, sitemaps,
  maximum depth, and page/result limits.
- **Request controls:** proxies, persistent session pools, and session rotation
  following detected blocks.
- **Record information:** title, author, date, description, site name, and
  language when available, plus canonical-URL or content-hash deduplication.
- **Optional Markdown discovery:** use a validated Markdown representation
  published by the origin as the page's content source.

## CLI usage

Use `crawl` to store a crawl, `fetch` for immediate output, `export`
to turn stored results into files, and `purge` to remove local storage:

```bash
markdownee crawl https://en.wikipedia.org/wiki/Web_scraping # crawl into storage
markdownee fetch https://en.wikipedia.org/wiki/Web_scraping # one page to stdout
markdownee export --output-dir ./out         # storage → files
markdownee purge                             # clear the storage
```

To follow links, supply `--selector`; an empty selector adds no linked URLs.
This example limits the crawl and chooses a destination for each format:

```bash
markdownee crawl https://en.wikipedia.org/wiki/Web_scraping \
  --selector 'a[href]' \
  --globs 'https://en.wikipedia.org/wiki/**' \
  --max-requests-per-crawl 10 \
  --max-crawl-depth 2 \
  --save markdown-kvs --save minified-html-dataset
```

Select readable HTML and Minified HTML separately. `--output-layout` chooses
body-only text and HTML fragments (`minimal`), ordinary metadata and complete
HTML documents (`standard`), or additional allowlisted metadata and crawl
information (`enhanced`). JSON, library, and Actor calls use `outputLayout`;
the Python keyword is `output_layout`.

For all flags and JSON configuration examples, see:
[npm package README](./packages/standalone/README.md) ·
[markdownee.com/help/npm](https://www.markdownee.com/help/npm/).

## Library usage

In Node.js, call `fetch` for one URL or create a crawler and pass a URL
list to `run`. This example uses in-memory results:

```typescript
import { createCrawler, fetch } from '@markdownee/markdownee';

// One page, nothing persisted
const { markdown } = await fetch('https://en.wikipedia.org/wiki/Web_scraping');

// A crawl, results returned in memory
const crawler = createCrawler({ maxRequestsPerCrawl: 10 });
const { dataset, statistics } = await crawler.run([
  'https://en.wikipedia.org/wiki/Web_scraping',
]);
console.log(statistics.requestsFinished, 'pages');
```

Use `resolved-url` for images in the return-only `fetch()` API;
`imageHandling: 'save'` is rejected there. For downloaded images, CLI
`fetch` can write derived files with a sibling `<stem>.assets/`
directory, without opening a Dataset or KVS.

Library details: [npm package README](./packages/standalone/README.md) ·
[markdownee.com/help/npm-lib](https://www.markdownee.com/help/npm-lib/).

## Input schema

[`@markdownee/schema`](./packages/schema/README.md) defines the shared Zod 4
input contract and its projections. Consult the interface-specific reference
for the accepted subset. The generated Actor schema describes Apify controls;
the interface below shows the shared field vocabulary.

Here, `save` selects dataset or KVS destinations for `crawl` and the Actor.
Single-page CLI output instead uses file or stdout tokens, such as
`--save txt-stdout`.

<details>
<summary>Full <code>MarkdowneeInputType</code> interface</summary>

<!-- @generated:start name="input-type" -->

<!-- This block is auto-generated by @markdownee/gen-md-regions. Do not edit. -->

```ts
interface MarkdowneeInputType {
  startUrls: Array<{ url: string }>;
  crawlerType:
    | 'playwright-adaptive'
    | 'playwright-firefox'
    | 'playwright-chromium'
    | 'cheerio';
  renderingTypeDetectionRatio: number;
  markdownDiscovery: 'off' | 'alternate' | 'negotiate' | 'probe';
  globs: Array<{ glob: string }>;
  exclude: Array<{ glob: string }>;
  selector: string;
  keepUrlFragment: boolean;
  useSitemaps: boolean;
  deduplication: 'minimal' | 'standard' | 'aggressive';
  respectRobotsTxtFile: boolean;
  initialCookies?: Array<unknown>;
  customHttpHeaders?: Record<string, string>;
  maxRequestsPerCrawl?: number;
  maxResultsPerCrawl?: number;
  maxCrawlDepth?: number;
  initialConcurrency?: number;
  maxConcurrency: number;
  maxRequestRetries: number;
  mode: 'precision' | 'balanced' | 'recall' | 'keep';
  imageHandling: 'exclude' | 'alt-text' | 'resolved-url' | 'save';
  maxImageEdge: number;
  rasterizeSvg: boolean;
  linkHandling: 'include' | 'exclude';
  tableHandling: 'include' | 'exclude';
  commentHandling: 'include' | 'exclude';
  languageCode: string;
  outputLayout: 'minimal' | 'standard' | 'enhanced';
  save: Array<
    | 'txt-dataset'
    | 'txt-kvs'
    | 'markdown-dataset'
    | 'markdown-kvs'
    | 'html-dataset'
    | 'html-kvs'
    | 'minified-html-dataset'
    | 'minified-html-kvs'
    | 'original-dataset'
    | 'original-kvs'
  >;
  datasetName?: string;
  keyValueStoreName?: string;
  requestQueueName?: string;
  storeSkippedUrls: boolean;
  proxyConfiguration?: Record<string, unknown>;
  proxyRotation: 'recommended' | 'per-request' | 'until-failure';
  sessionPoolName?: string;
  maxSessionRotations: number;
  navigationTimeoutSecs: number;
  blockMedia: boolean;
  waitForSelector: string;
  softWaitForSelector: string;
  waitForDynamicContentSecs: number;
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  headless: boolean;
  ignoreCorsAndCsp: boolean;
  closeCookieModals: boolean;
  maxScrollHeight: number;
  userAgent: string;
  ignoreHttpsErrors: boolean;
}
```

<!-- @generated:end name="input-type" -->

</details>

## Credits

- [Trafilatura](https://github.com/adbar/trafilatura) by Adrien Barbaresi — the
  original extraction algorithm and its heuristics
  ([ACL 2021 paper](https://aclanthology.org/2021.acl-demo.15/)).
- [Trafilatura Core](https://www.trafilaturacore.com/) — the `trafilaturacore`
  engine Markdownee ships: an open-source pure-TypeScript port of
  Trafilatura. Its extraction core ports original Python
  [Trafilatura](https://github.com/adbar/trafilatura),
  with
  [go-trafilatura](https://github.com/markusmobius/go-trafilatura) used only as
  a DOM translation aid.
- [Crawlee](https://crawlee.dev/) by Apify — the crawling layer (Playwright +
  Cheerio, session pools, proxy rotation).

Report problems through the [issue tracker](https://github.com/markdownee/markdownee/issues).

## License

[Apache-2.0](./LICENSE)
