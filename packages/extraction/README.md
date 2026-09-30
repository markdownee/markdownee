# `@markdownee/extraction`

Connects Trafilatura Core's HTML extraction and cleanup to Markdownee's output
renderers. Crawling belongs to `@markdownee/crawler`; format conversion belongs to
`@markdownee/conversion`.

`ContentExtractor.extractPage(html, options)` cleans a page once and returns
`metadata`, `formats`, `messages`, `outputContext`, and `dedupeText`. The split
`cleanPage()` / `renderFormats()` API lets the crawler rewrite downloaded-image
references between cleaning and rendering without a second extraction pass.

The asynchronous methods also include `extract()`, `extractAllFormats()`, and
`extractMetadata()`. Awaiting them does not move CPU work off the event loop.
Helpers expose defaults, metadata projection, and content hashes/UTF-8 byte counts.

Controls cover boilerplate mode, images, links, tables, user-comment sections,
declared language, and output layout. Crawler-owned image `save` maps to resolved
URLs before extraction. Language filtering uses declarations, not statistical
detection; conflicting declarations can produce no formats.

Output selectors are `txt`, `markdown`, `html`, and `minified-html`; structured
results use `minifiedHtml`. Captured `original` HTML is a sink concern. Input limits
and validation errors propagate; ordinary extraction fallback is reported in messages.

Served-Markdown parsers are re-exported here, but their HTML still requires the
`cleanPage()` boundary before conversion. For the supported application API and
options, use the [npm library guide](https://www.markdownee.com/help/npm-library/).
