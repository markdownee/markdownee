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
          </li>
          <li>
            <strong><a href="https://www.npmjs.com/package/@markdownee/markdownee">npm package CLI &amp; lib</a></strong>
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

- Boilerplate removal is powered by [Trafilatura Core](https://www.trafilaturacore.com/), our **open-source fork** of [Trafilatura](https://www.markdownee.com/trafilatura/).

  The _Core_ in its name means it is reduced to _one task_: extracting main content by removing boilerplate. Other packages handle output conversion, including Markdown.

  Trafilatura Core is ported from the original Python [Trafilatura](https://github.com/adbar/trafilatura), with [go-trafilatura](https://github.com/markusmobius/go-trafilatura) as a DOM translation aid.

- [Crawlee](https://crawlee.dev/) handles crawling and uses [Playwright](https://playwright.dev/) for browser rendering.

- Two language versions — **TypeScript** and **Python**: self-host with the [npm CLI](https://www.markdownee.com/help/npm-cli/), [npm library](https://www.markdownee.com/help/npm-library/), or [Python library](https://www.markdownee.com/help/pypi/), or use the [hosted Apify Actor](https://apify.com/markdownee/crawler?fpr=glueo). Source code is on [GitHub](https://github.com/markdownee/markdownee).

- Save image files with the optional **image downloading** mode.

This Actor saves the selected formats in Apify storage.

Select a Dataset route when content should appear in each result record, or a
Key-value store route when you want downloadable files. The Actor can retain both
representations. Start with a bounded run and inspect its outputs before increasing
the crawl limits.

## What Markdownee does

Select HTTP or browser fetching, choose precision/balanced/recall extraction or
whole-document cleanup, and control links, tables, images, and user comments.
Crawl scope uses link selectors, URL patterns, sitemaps, and request/depth limits.
Optional image downloading keeps assets with the extracted content.

The same project offers an [npm CLI](https://www.markdownee.com/help/npm-cli/),
[npm library](https://www.markdownee.com/help/npm-library/), and
[Python library](https://www.markdownee.com/help/pypi/).

## How to run a crawl

Open **Input**, provide starting URLs and settings, then select **Start**. This
HTTP-only example extracts one Wikipedia page and saves Markdown in the key-value store:

```json
{
  "startUrls": [{ "url": "https://en.wikipedia.org/wiki/Web_scraping" }],
  "crawlerType": "cheerio",
  "maxRequestsPerCrawl": 1,
  "save": ["markdown-kvs"]
}
```

Inspect the run's Dataset record and follow its Markdown key in the Key-value store.
To follow links, add a `selector` and limits; globs alone do not discover links.
The [Input tab](https://apify.com/markdownee/crawler/input-schema?fpr=glueo)
contains the full settings reference.

## Results and storage

Dataset records describe outcomes, metadata, crawl information, and selected formats.
A `*-dataset` route stores content inline; a `*-kvs` route keeps a file and its key.
Select both to retain both representations. `markdownSource` identifies an accepted
origin-published Markdown source when discovery is enabled.

See [Output](https://apify.com/markdownee/crawler/output-schema?fpr=glueo) for record
fields and [API](https://apify.com/markdownee/crawler/api?fpr=glueo) for starting runs
and retrieving results. The [Actor guide](https://www.markdownee.com/help/apify/)
covers input examples and interpreting outcomes.

## Pricing

Compute, storage, proxies, rendering, and crawl settings affect pay-per-use costs.
Start with a representative bounded run. Apify offers
[$5 of free usage monthly](https://apify.com/pricing?fpr=glueo); check its pricing
page for current rates.

## Troubleshooting

For missing content, compare extraction modes and the captured original. Use browser
rendering and bounded waits for JavaScript content. Review filters, retries, and
failed records when a crawl stops early; target sites can throttle or block requests.

Follow target-site terms and applicable rules when collecting and using content.

## Support

Report reproducible Actor problems through its **Issues** tab with the settings
and observed outcome.

## License

Licensed under [Apache-2.0](https://github.com/markdownee/markdownee/blob/main/LICENSE).
