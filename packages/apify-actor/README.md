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
            <br />
            <a href="https://www.markdownee.com/">playground</a>, <a href="https://www.markdownee.com/help/web/">help</a>
          </li>
          <li>
            <strong><a href="https://www.npmjs.com/package/@markdownee/markdownee">npm package CLI &amp; lib</a></strong>
            <br />
            <a href="https://www.npmjs.com/package/@markdownee/markdownee">package</a>, <a href="https://www.markdownee.com/help/npm/">CLI help</a>, <a href="https://www.markdownee.com/help/npm-lib/">lib help</a>
          </li>
          <li>
            <strong><a href="https://github.com/markdownee/markdownee">Source code on GitHub</a></strong>
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

- Two language versions — **TypeScript** and **Python**: use this Actor, the
  [npm CLI](https://www.markdownee.com/help/npm/) and
  [npm library](https://www.markdownee.com/help/npm-lib/), or the
  [Python library](https://www.markdownee.com/help/pypi/). Source is on
  [GitHub](https://github.com/markdownee/markdownee).
- **Optional image downloading:** keep local images with stored content.

## Configure a run in Console

Add starting URLs and choose **Save** destinations. Each token combines a format
with `dataset` or `kvs`; choose both to store the same format in both places.
Use a link selector, include/exclude patterns, sitemaps, and page/depth limits to
define the crawl. Then select **Start** and inspect its records and content.

Dataset downloads support JSON, CSV, and Excel. KVS content can be downloaded
separately or fetched through the Apify API.

## Input recipes

Starting URLs are required. The
[Input tab](https://apify.com/markdownee/crawler/input-schema?fpr=glueo) lists the
complete contract and defaults.

Collect a bounded set of Wikipedia articles with Markdown storage:

```json
{
  "startUrls": [{ "url": "https://en.wikipedia.org/wiki/Web_scraping" }],
  "selector": "a[href]",
  "globs": [{ "glob": "https://en.wikipedia.org/wiki/**" }],
  "maxCrawlDepth": 2,
  "maxRequestsPerCrawl": 10,
  "save": ["markdown-kvs"]
}
```

Request several formats for one starting page:

```json
{
  "startUrls": [{ "url": "https://en.wikipedia.org/wiki/Web_scraping" }],
  "maxRequestsPerCrawl": 1,
  "save": ["markdown-kvs", "minified-html-dataset", "original-kvs"]
}
```

Store readable and compact HTML independently:

```json
{
  "startUrls": [{ "url": "https://en.wikipedia.org/wiki/Web_scraping" }],
  "save": ["html-kvs", "minified-html-dataset", "markdown-kvs"]
}
```

`outputLayout` defaults to `minimal` for body text and HTML fragments.
`standard` adds ordinary metadata and complete HTML documents; `enhanced`
includes additional allowlisted metadata and crawl information. Layout neither
adds destinations nor modifies the captured original.

Look for Markdown published by a documentation site:

```json
{
  "startUrls": [{ "url": "https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/" }],
  "globs": [{ "glob": "https://developers.cloudflare.com/fundamentals/**" }],
  "markdownDiscovery": "alternate",
  "save": ["markdown-kvs"]
}
```

`markdownDiscovery` affects the source of all output formats. `off` leaves
HTML fetching unchanged. `alternate` follows advertised same-origin links;
`negotiate` also requests Markdown through Accept; `probe` also tries a .md
sibling. Up to three alternates, one refetch, and one sibling may be attempted;
robots.txt can add an origin-level request. Crawler-path capabilities and
per-origin budgets restrict attempts. Rejected representations fall back to HTML.

Configure proxies and a persistent session pool:

```json
{
  "startUrls": [{ "url": "https://en.wikipedia.org/wiki/Web_scraping" }],
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  },
  "proxyRotation": "recommended",
  "sessionPoolName": "wikipedia",
  "waitUntil": "networkidle"
}
```

These controls affect requests and session reuse; they do not assure access to
a site. URL filtering also needs a `selector` to enable link following, unless
the full URL list or sitemap supplies the crawl frontier.

## Choose fetching and extraction settings

- **Crawler type:** adaptive Playwright renders by default. A positive
  `renderingTypeDetectionRatio` enables sampling to decide when HTTP can be used.
  Explicit Firefox, Chromium, and HTTP-only Cheerio are also available.
- **Extraction mode:** `precision` favors less noise, `recall` retains more
  borderline content, `balanced` is the default, and `keep` cleans the document
  without main-content selection.
- **Content handling:** images accept `exclude`, `alt-text`, `resolved-url`,
  or `save`. Links, tables, and detected user-comment sections accept `include`
  or `exclude`.
- **Waits and consent:** selectors, dynamic-content waits, scrolling, cookies,
  and headers help control capture. Enabled consent handling attempts recovery
  and removes residual consent containers before extraction.
- **Deduplication:** `minimal` uses Crawlee URL deduplication; `standard` also
  checks canonical URLs; `aggressive` also checks extracted-content hashes.

`startUrls`, `globs`, and `exclude` use arrays of objects containing `url` or
`glob`, respectively. `save` uses strings such as `markdown-kvs` or
`txt-dataset`. Supported formats are `txt`, `markdown`, `html`,
`minified-html`, and `original`.

## Interpret results

Successful pages produce `success` records. Requests that exhaust retries
produce `failed` records; skips are recorded when `storeSkippedUrls` is enabled.

| Field                                     | Meaning                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `url`                                     | Requested page address                                                                 |
| `status`                                  | `success`, `failed`, or `skipped`                                                      |
| `metadata`                                | Available title, author, date, description, site, language, and extended fields        |
| `crawl`                                   | Available final `loadedUrl`, `scrapedAt`, `httpStatusCode`, `depth`, and `referrerUrl` |
| `original`                                | Crawler-captured HTML's hash and byte count, with stored content when requested        |
| `txt`, `markdown`, `html`, `minifiedHtml` | Selected format nodes containing hashes, byte counts, and content or KVS references    |
| `markdownSource`                          | Discovery mechanism, source URL, and whether served Markdown supplied the output body  |
| `errors`, `retryCount`, `crawledTime`     | Failed-request details                                                                 |
| `skipReason`                              | `robotsTxt`, `limit`, `enqueueLimit`, `filters`, `redirect`, or `depth`                |

This illustrative record uses sample metadata, hashes, and byte counts:

```json
{
  "url": "https://en.wikipedia.org/wiki/Web_scraping",
  "status": "success",
  "metadata": {
    "title": "Web scraping",
    "siteName": "Wikipedia",
    "languageCode": "en"
  },
  "crawl": {
    "loadedUrl": "https://en.wikipedia.org/wiki/Web_scraping",
    "scrapedAt": "2026-05-31T10:00:00.000Z",
    "httpStatusCode": 200,
    "depth": 1,
    "referrerUrl": "https://en.wikipedia.org/"
  },
  "original": {
    "hash": "f8e6bd335e04d03e1be6798c2c72349c",
    "bytes": 89898
  },
  "markdown": {
    "hash": "43f204bfbee5dbe6862cb38620f257b5",
    "bytes": 5234,
    "key": "markdown-c485356090a92c6a45e8c1155c14d8ee.md",
    "url": "https://api.apify.com/v2/key-value-stores/<storeId>/records/<key>"
  }
}
```

`markdownSource` appears when enabled discovery supplied an origin-published
representation. Its mechanism is `response`, `alternate`, `negotiated`, or
`sibling`. `verbatim` is true for a served Markdown body after source front-matter
handling and the selected layout; it is false for a cleaned HTML round trip or
when no Markdown output was saved. These records derive `original` from the
served representation.

Ordinary original HTML is a capture before extraction. It can already reflect
browser rendering, serialization, and consent handling, and is not a complete
web archive.

## Select storage destinations

**KVS routes**, the default, put each format in a separate file keyed by
`{format}-{md5(url)}.{ext}`. The record includes its key and public URL when
available. **Dataset routes** place content inline for a combined export.
Large inline HTML increases record size and memory use; KVS is an alternative.

Choose one or both destinations for each format. Markdown is convenient for
text-based document structure, TXT for text-only consumers, readable HTML for
inspection, and Minified HTML for compact markup storage. Keep original HTML
when the crawler capture is useful for later diagnosis or reprocessing.

## Estimate run costs

Apify charges depend on compute, storage, proxy traffic, and the selected plan.
Browser work, page size, concurrency, waits, and crawl limits affect resource
use. Start with a representative sample to estimate a larger collection.
Apify offers [$5 of free usage monthly](https://apify.com/pricing?fpr=glueo);
consult that page for current rates.

## Integrations and recurring collection

The [API tab](https://apify.com/markdownee/crawler/api?fpr=glueo) provides
JavaScript/Python client examples, OpenAPI information, and MCP setup.
Use Apify scheduling for recurring runs and its integrations for destinations
such as Make, Zapier, n8n, Google Drive, or Slack.

Your application can use the returned content for summarization, translation,
classification, search, or training-data preparation. Frameworks such as
LangChain and LlamaIndex, and stores such as Pinecone, Qdrant, Weaviate, or Chroma,
consume the records through your ingestion code.

## FAQ

### Is it legal to scrape website content?

Scraping publicly available, non-personal data is generally legal in most
jurisdictions. Markdownee can honor each site's `robots.txt` (enable **Respect
robots.txt**), and you remain responsible for complying with each site's Terms of
Service and for how you use extracted content — especially copyrighted material you
intend to republish.

### Why is content missing or mixed with page furniture?

Compare `precision`, `balanced`, and `recall` on the affected pages. If content
appears after JavaScript execution, use a browser crawler and review selector
waits, dynamic-content waits, and scroll limits. Examine the captured original
to distinguish fetching problems from extraction decisions.

### How do I configure a larger crawl?

Supply `selector`, for example `a[href]`, and bound matching links with globs,
depth, and request limits. Enable sitemaps when appropriate. Review proxy,
session-pool, and rotation settings for the target site; failures remain
possible and are recorded.

### How do I start a run from code?

Use the [API tab](https://apify.com/markdownee/crawler/api?fpr=glueo) for client
examples or MCP configuration. The Console also supports scheduling and run
monitoring.

### Where can I report a problem?

Open the Actor's **Issues** tab with the settings and outcome needed to
understand the problem.
