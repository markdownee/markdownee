# Markdownee

<table align="right">
  <tbody>
    <tr>
      <td>
        <img width="220" src="media/cover-mini.svg" alt="Markdownee" />
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

Markdownee collects web pages and exports their content for text analysis,
retrieval systems, and dataset preparation. Choose Markdown, plain text,
readable HTML, compact HTML, or the original page HTML. The fetching layer uses
[Crawlee](https://crawlee.dev/) with [Playwright](https://playwright.dev/) for
browser rendering and Cheerio for HTTP-only requests. Extraction then runs in
[Trafilatura Core](https://www.trafilaturacore.com/), which processes supplied HTML
offline.

Run a single-page command, integrate the npm library into a Node.js application,
or configure a hosted [Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo)
run. TypeScript remains the primary implementation. The maintained alpha
[native Python library](https://pypi.org/project/markdownee/) uses Crawlee Python
and Python Trafilatura Core, without a bundled Node product engine or product CLI.
Both languages live in this repository; their supported controls and result
shapes are documented separately.

Start with a small sample and adjust the crawl to the pages you need. Link
selectors, URL globs, sitemaps, and depth limits bound collection. The adaptive
crawler uses browser rendering by default; a positive
`renderingTypeDetectionRatio` enables detection of pages that can use HTTP.
Proxy rotation and session pools provide request controls when sites restrict
access. Cookie handling attempts to remove or resolve consent interruptions
before extraction; some pages remain inaccessible. Choose `precision`,
`balanced`, or `recall` to adjust content selection, or `keep` to clean the
whole document without selecting its main content. Tables, links, images, and
comments have separate controls; canonical URLs or content hashes can be used
to deduplicate results.

**Website & docs:** [markdownee.com](https://www.markdownee.com) · **Try it:**
[Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo) · **Install:**
[npm](https://www.npmjs.com/package/@markdownee/markdownee) ·
[PyPI (alpha)](https://pypi.org/project/markdownee/)

## Contents

- [Packages](#packages)
- [Quick start](#quick-start)
- [Why Markdownee](#why-markdownee)
- [Features](#features)
- [CLI usage](#cli-usage)
- [Library usage](#library-usage)
- [How it works](#how-it-works)
- [Input schema](#input-schema)
- [Credits](#credits)
- [Contributing](#contributing)
- [License](#license)

## Packages

```text
packages/
├── apify-actor/            # Apify Actor
├── standalone/             # TypeScript CLI + library
├── extraction/             # Pure extraction package (Trafilatura Core clean())
├── conversion/             # Renders cleaned HTML → the output formats
├── crawler/                # Shared Crawlee + Playwright crawler
├── schema/                 # Shared Zod input + output schema
└── standalone-python/      # Native Python library (no product CLI)
```

## Quick start

```bash
npm install @markdownee/markdownee
npx markdownee fetch https://www.iana.org/help/example-domains \
  --crawler-type cheerio
```

This command uses HTTP-only fetching and needs no browser installation. It
writes Markdown to stdout and diagnostics to stderr. Example output, trimmed:

```markdown
# Example Domains

As described in [RFC 2606](https://www.iana.org/go/rfc2606) and
[RFC 6761](https://www.iana.org/go/rfc6761), a number of domains such
as example.com and example.org are maintained for documentation
purposes. These domains may be used as illustrative examples in
documents without prior coordination with us. They are not available
for registration or transfer.
```

For content populated by JavaScript, provision Chromium and use the default
adaptive crawler. Choose the Firefox installation instead when using the
`firefox` crawler:

```bash
npx playwright install chromium
npx markdownee fetch https://example.com/
```

The native Python library has its own installation and defaults to HTTP fetching:

```bash
pip install --pre markdownee
# Only for browser crawling:
playwright install chromium
```

```python
from markdownee import fetch

result = fetch("https://example.com/", formats=["markdown", "txt"])
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
markdownee crawl https://example.com       # crawl into storage
markdownee fetch https://example.com/  # one page to stdout
markdownee export --output-dir ./out         # storage → files
markdownee purge                             # clear the storage
```

To follow links, supply `--selector`; an empty selector adds no linked URLs.
This example limits the crawl and chooses a destination for each format:

```bash
markdownee crawl https://blog.example.com/ \
  --selector 'a[href]' \
  --globs 'https://blog.example.com/**' \
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
const { markdown } = await fetch('https://example.com/');

// A crawl, results returned in memory
const crawler = createCrawler({ maxRequestsPerCrawl: 10 });
const { dataset, statistics } = await crawler.run([
  'https://example.com/',
]);
console.log(statistics.requestsFinished, 'pages');
```

Use `resolved-url` for images in the return-only `fetch()` API;
`imageHandling: 'save'` is rejected there. For downloaded images, CLI
`fetch` can write derived files with a sibling `<stem>.assets/`
directory, without opening a Dataset or KVS.

Library details: [npm package README](./packages/standalone/README.md) ·
[markdownee.com/help/npm-lib](https://www.markdownee.com/help/npm-lib/).

## How it works

Fetching, extraction, and output have separate responsibilities:

- **Crawl** — Crawlee obtains the document through the selected browser or
  HTTP path. Adaptive rendering is the default; a positive
  `renderingTypeDetectionRatio` enables detection for HTTP-only fetching.
  Configured Ghostery filters, residual-container removal, and targeted
  consent recovery run before extraction.
- **Extract** — the rendered HTML is cleaned once by
  [Trafilatura Core](https://www.trafilaturacore.com/), the `trafilaturacore` npm
  dependency. Its extraction core is a direct port of Python
  Trafilatura v2.2.0 and applies Trafilatura's own heuristics to strip
  navigation, sidebars, footers, and similar clutter. It is pure TypeScript, so
  there is no Python extraction runtime and nothing to compile on install.
  `@markdownee/conversion` renders the selected formats from that cleaned
  representation.
- **Output** — save the requested `txt`, `markdown`, `html`, `minified-html`,
  or `original` content to dataset/KVS destinations. Per-format hashes and
  UTF-8 byte counts describe the stored content.

`markdownDiscovery` can substitute an origin-published representation for HTML
extraction. Its `alternate`, `negotiate`, and `probe` modes add advertised-link
fetches, Accept-based negotiation, and sibling probing where the crawler path
supports them. The default `off` leaves fetching unchanged. Budgets and
validation bound discovery; unavailable or rejected representations fall back
to HTML. Accepted Markdown supplies all formats and adds `markdownSource` to
the record. Links still come from available page HTML; a page response that is
itself Markdown contributes no HTML link frontier.

The schema package supplies shared validation and generates interface-specific
schemas and flag tables. The CLI, library, and Actor expose the subsets their
respective execution and storage models support.

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
  maxRequestsPerCrawl: number;
  maxResultsPerCrawl: number;
  maxCrawlDepth: number;
  initialConcurrency: number;
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
  Trafilatura. Its extraction core is a direct port of Python Trafilatura,
  with
  [go-trafilatura](https://github.com/markusmobius/go-trafilatura) used only as
  a DOM translation aid.
- [Crawlee](https://crawlee.dev/) by Apify — the crawling layer (Playwright +
  Cheerio, session pools, proxy rotation).

## Contributing

Bug reports and feature requests are welcome at the
[issue tracker](https://github.com/markdownee/markdownee/issues);
[pull requests](https://github.com/markdownee/markdownee/pulls) are welcome
too. The sections below are for working on the monorepo itself; end users do not
need any of this — see [Quick start](#quick-start) instead.

### Local prerequisites

- **Apify CLI ≥ 1.4** (older versions reject the modern `actor.json` format
  with "Actor is of an unknown format").
- **Node 22.22.2+ on the 22 line, 24.15.0+ on the 24 line, or 26+**, **pnpm 10+**.

### Workspace commands

```bash
pnpm -w turbo run build --filter='./solutions/markdownee/engine/**'
pnpm -w turbo run test --filter='./solutions/markdownee/engine/**'
pnpm -w run lint  # tools-source root-owned Biome check
apify run         # run the Actor locally (packages/apify-actor/)
```

### Architecture

See [Packages](#packages) for the component map and [How it works](#how-it-works)
for the data flow.

## License

[Apache-2.0](./LICENSE)
