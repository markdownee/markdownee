<table align="right">
  <tbody>
    <tr>
      <td>
        <img width="220" src="https://www.markdownee.com/media/cover-mini.svg" alt="Markdownee" />
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

Boilerplate removal is powered by [Trafilatura Core](https://www.trafilaturacore.com/),
**our open-source fork of [Trafilatura](https://www.markdownee.com/trafilatura/)**.
The **Core** in its name means it is reduced to one task: main-content extraction and
boilerplate removal. Other packages handle output conversion, including Markdown.
Trafilatura Core is ported from the original Python
[Trafilatura](https://github.com/adbar/trafilatura), with
[go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM translation
aid. [Crawlee](https://crawlee.dev/) handles crawling and uses
[Playwright](https://playwright.dev/) for browser rendering.

## What Markdownee does

- **Controls crawl scope:** follow selected links, include or exclude URL patterns,
  read sitemaps, and enforce page and depth limits.
- **Fetches browser-rendered or server HTML:** use adaptive Playwright, an explicit
  browser crawler, or HTTP-only Cheerio according to the target.
- **Selects useful content:** choose precision, balanced, recall, or keep mode and
  configure waits, scrolling, consent handling, and deduplication.
- **Produces practical formats:** save Markdown, readable or minified HTML, plain text,
  and the captured original to Apify Dataset, Key-value store, or both.
- **Handles content details independently:** include or exclude tables, links, images,
  and detected user-comment sections; images can also be downloaded.

The same project is available as an
[npm CLI](https://www.markdownee.com/help/npm/),
[npm library](https://www.markdownee.com/help/npm-lib/), and
[Python library](https://www.markdownee.com/help/pypi/).

## How to run a crawl

1. Add one or more starting URLs in the Actor's **Input** tab.
2. Choose the output formats and storage destinations under **Save**. Add a link
   selector and limits when the Actor should follow links.
3. Select **Start**, then inspect the run's Dataset and Key-value store.

This example collects a bounded set of Wikipedia pages and stores Markdown files:

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

See the [Input tab](https://apify.com/markdownee/crawler/input-schema?fpr=glueo) for
all settings, types, defaults, and crawler-specific options.

## Results and storage

Each processed URL produces a record with its status, available page metadata, crawl
details, requested formats, errors, and storage references. When Markdown discovery
is enabled, `markdownSource` identifies how the representation was found and whether
saved Markdown retained the served Markdown representation.

Dataset destinations keep content inline for combined JSON, CSV, or Excel exports.
Key-value store destinations save each format as a separate file, which avoids adding
large page bodies to Dataset records. You can select either or both per format.

The [Output tab](https://apify.com/markdownee/crawler/output-schema?fpr=glueo)
documents the record shape. Use the
[API tab](https://apify.com/markdownee/crawler/api?fpr=glueo) to start runs and read
results from code. Apify schedules and integrations can connect recurring runs to
the rest of your workflow.

## Pricing

This Actor uses Apify's pay-per-use model. Compute time, storage, proxy traffic,
browser rendering, page size, concurrency, waits, and crawl limits can all affect the
final cost. Start with a representative, bounded run before scaling up. Apify offers
[$5 of free usage monthly](https://apify.com/pricing?fpr=glueo); check its pricing
page for current rates.

## Troubleshooting and support

### Expected content is missing

Compare the precision, balanced, and recall extraction modes. For content added by
JavaScript, use a browser crawler and review selector waits, dynamic-content waits,
and scroll limits. Saving the original helps distinguish fetching problems from
extraction choices.

### Page furniture remains in the output

Try precision mode, then adjust table, link, image, and user-comment handling. A
targeted exclusion selector can remove a stable site-specific element.

### The crawl stops early or pages fail

Check page and depth limits, URL filters, retries, proxy settings, and failed records.
Following links requires a selector such as `a[href]`; globs alone do not discover
links. Target sites can still throttle or block requests.

You are responsible for following target-site terms and applicable rules and for how
you use the collected content. To report a reproducible Actor problem, open the
Actor's **Issues** tab and include the relevant settings and outcome.
