# `@markdownee/crawler`

This package connects Markdownee's extraction pipeline to Crawlee's fetching and request lifecycle.

Built on [Trafilatura Core](https://www.trafilaturacore.com/) (extraction) and
[Crawlee](https://crawlee.dev/) (TypeScript crawler driving Playwright).

Its entry points and shared helpers cover:

- `createMarkdowneeCrawler()` and `buildRequests()`
- Cookie defenses via Ghostery, plus pre-extraction stripping of known consent/CMP containers
- Built-in scrolling via Crawlee `infiniteScroll()`
- Markdown discovery (`src/markdown/`): finding a Markdown representation the site
  publishes for a page and using it as the content source instead of the page HTML
- Shared sink core: `memorySink()`, `Sink<T>`, the save-route helpers
  (`buildRouteMap`, `extractedFormats`, `savesOriginal`, `warnDangerousRoutes`)
  that parse the `save` token array into per-format destinations, and the
  storage helpers (`kvsKey`, `buildSuccessRecord` / `buildFailedRecord` /
  `buildSkippedRecord`, `ContentNode` / `KvsLike`) that assemble dataset
  records and derive KVS keys

The Actor and standalone interfaces supply adapters around the same storage helpers:

- `packages/apify-actor/src/` wires the Apify dataset / key-value store to the core
- `packages/standalone/src/` wires the Crawlee dataset / key-value store to the core

The handler cleans a page once, then rewrites saved-image references before rendering the
requested formats. Destinations share the rendered bytes. Content hashes and UTF-8 byte counts
describe each final representation; aggressive deduplication uses the stable body text.

Each success record holds request `url`, `metadata`, and optional `crawl` information:
`loadedUrl`, `scrapedAt`, `httpStatusCode`, `depth`, and `referrerUrl`. Individual content nodes
reference the record's context rather than repeating it.

`markdownDiscovery` defaults to `off`, leaving ordinary fetching unchanged. The `alternate`,
`negotiate`, and `probe` strategies can accept a representation published by the origin as the
content source for all formats. Rejected or unavailable representations fall back to HTML.
Successful discovery adds `markdownSource` to the record. Link following uses available page HTML;
a page response containing only Markdown provides no HTML links to enqueue.

Derived HTML passes through the engine's security floor. Served Markdown can supply the output
body only when its parsed checks permit it; otherwise output is rendered from cleaned HTML.
`SPEC.md` defines channel availability, response acceptance, and deduplication consequences.
