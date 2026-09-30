# `@markdownee/conversion`

Renders Markdownee's cleaned HTML as plain text, Markdown, readable HTML, or compact
HTML. It does not fetch pages or extract their main content.

`convert()` receives semantic HTML, its readable/compact presentations, selected
formats, and output context. Results use `txt`, `markdown`, `html`, and `minifiedHtml`.
TXT preserves text structure and table cells; Markdown uses Turndown with GFM support.

`layout` selects body/fragment output (`minimal`), ordinary metadata and complete
HTML (`standard`), or extended metadata and crawl context (`enhanced`). Captured
`original` HTML belongs to the crawler, not this renderer.

`formatReadableHtml()` formats previously cleaned HTML with Prettier. Compact
formatting belongs to Trafilatura Core's `formatSecuredHtml()`. Formatting does not
repeat extraction or cleaning; failures return the supplied HTML with a warning.

The served-Markdown helpers read front matter, identify Markdown, and parse it to
HTML. **Parsed Markdown HTML is untrusted:** callers must pass it through Trafilatura
Core's cleaning stage before rendering; `formatSecuredHtml()` is not a substitute.

For application usage, see the
[npm library guide](https://www.markdownee.com/help/npm-library/)
and [output formats](https://www.markdownee.com/formats/).
