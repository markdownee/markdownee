# `@markdownee/crawler`

Connects Crawlee's request lifecycle to Markdownee's extraction pipeline.
`createMarkdowneeCrawler()` selects adaptive Playwright, Chromium, Firefox, or
HTTP-only Cheerio; `buildRequests()` prepares starting URLs.

Handlers manage navigation, waits, link discovery, filters, limits, retries,
proxies, sessions, and consent handling. Each page is cleaned once; saved-image
references are rewritten before the requested formats are rendered.

Callback, memory, and storage sinks share route parsing, deterministic content/image
keys, and success/failed/skipped record assembly. The npm package and Actor provide
their own storage adapters. A record holds its request URL, metadata, and crawl
context once; content nodes carry final-format hashes, byte counts, and destinations.

Optional `markdownDiscovery` uses an accepted origin-published representation as
the source for all formats. Rejected representations fall back to HTML. Derived
HTML passes through Trafilatura Core's cleaning stage; served Markdown is retained
only when its parsed checks permit it. `markdownSource` records that choice.
Links come from available page HTML, so a Markdown-only response has no HTML links
to enqueue.

See the [npm library guide](https://www.markdownee.com/help/npm-library/)
and [CLI reference](https://www.markdownee.com/help/npm-cli/) for application usage.
