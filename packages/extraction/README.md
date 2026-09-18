# `@markdownee/extraction`

The TypeScript adapter between Trafilatura Core's cleaned HTML and Markdownee's format renderers.

Markdownee is built on
[Trafilatura Core](https://www.trafilaturacore.com/) (the `trafilaturacore` npm
package — a pure-TypeScript port of Trafilatura, shipping no native
artifact) and [Crawlee](https://crawlee.dev/) (TypeScript crawler driving
Playwright); this package wraps Trafilatura Core's secured `prepare()` seam plus small pure
helpers, while browser crawling lives in `@markdownee/crawler` and format
rendering in `@markdownee/conversion`.

## Public API

```ts
import {
  ContentExtractor,
  DEFAULT_CONFIG,
  type ExtractionResult,
  type Metadata,
  type OutputFormat,
  type PageExtraction,
  type TrafilaturacoreConfig,
  getDefaultConfig,
  computeContentInfo,
  projectMetadata,
} from '@markdownee/extraction';
import { Mode, SaveFormat } from '@markdownee/schema';

const extractor = new ContentExtractor({ boilerplate: Mode.Precision });

// Clean once, render every requested format (the crawler's call):
const page = await extractor.extractPage(html, {
  url,
  formats: [SaveFormat.Markdown, SaveFormat.MinifiedHtml],
});

// Or a single format / metadata only (all methods are async):
const result = await extractor.extract(html, {
  url,
  format: SaveFormat.Markdown,
});
const metadata = await extractor.extractMetadata(html, url);
const all = await extractor.extractAllFormats(html, { url });

// Content hash and byte length (MD5 over UTF-8)
const info = computeContentInfo(html); // { hash: string, length: number }

// Project raw Metadata to a flat DatasetMetadata shape
const meta = projectMetadata(await extractor.extractMetadata(html, url));
```

`ContentExtractor` exposes asynchronous methods around an in-process extraction engine. Awaiting
these methods does not move CPU work into libuv's threadpool:

- `extractPage(html, opts: { url?: string; formats?: OutputFormat[]; context?: PageOutputContext })` — clean
  once and render every requested format. Returns `PageExtraction`
  (`{ metadata, formats, messages, outputContext, dedupeText }`) — the call a crawler
  should make, since it pays for a single engine pass.
- `cleanPage(html, url?)` / `renderFormats(cleanedHtml, page, formats?, context?)` — the
  split API `extractPage` composes: one engine pass returning a `CleanedPage`,
  then asynchronous layout/conversion/presentation rendering. `cleanedHtml` is a separate parameter so a caller
  (the crawler's save-mode image pipeline) can rewrite `img src` between the
  steps; pass `page.html` unchanged otherwise.
- `extract(html, opts: { url?: string; format?: OutputFormat })` — single
  format. Returns `ExtractionResult | null`.
- `extractMetadata(html, url?)` — metadata-only projection.
- `extractAllFormats(html, opts: { url?: string; formats?: OutputFormat[] })`
  — all four formats keyed by name.
- `getConfig()` — read-only view of the resolved config.

Additional exports provide:

- `computeContentInfo(content)` — stable hash + byte length helper.
- `projectMetadata(meta)` — dataset-oriented metadata projection.
- `getDefaultConfig()` — fresh mutable copy of `DEFAULT_CONFIG`.

## Supported output formats

Select `txt`, `markdown`, `html`, or `minified-html`. The conversion package implements these
representations; XML and XML-TEI are outside this interface.

## `TrafilaturacoreConfig`

| Field           | Type            | Default      | Description                                                                                                   |
| --------------- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| boilerplate     | BoilerplateMode | `'balanced'` | `precision`, `balanced`, `recall`, or `keep` (HTML cleanup only)                                              |
| imageHandling   | ImageHandling   | `'exclude'`  | `exclude`, `alt-text`, `resolved-url`, or crawler-owned `save`                                                |
| linkHandling    | LinkHandling    | `'include'`  | `include` or `exclude`; exclusion keeps anchor text and drops the URL                                         |
| tableHandling   | TableHandling   | `'include'`  | `include` or `exclude`; exclusion drops table subtrees including cell text                                    |
| commentHandling | CommentHandling | `'include'`  | `include` or functional `exclude` for detected user-comment sections, not `<!-- -->` markup                   |
| targetLanguage  | string \| null  | `null`       | Keep only content whose **declared** language matches this subtag                                             |
| outputLayout    | OutputLayout    | `'minimal'`  | `minimal`, `standard`, or `enhanced`; shared by readable and minified HTML and independent of their selection |

## Local prerequisites

- **Node 22+**, **pnpm 10+**. Extraction comes from the `trafilaturacore`
  dependency, which is platform-independent JavaScript — nothing to compile.

## Pitfalls

- **Trafilatura Core's metadata title heuristic differs from Python
  Trafilatura.** Tests asserting metadata should match a regex / substring,
  not exact strings.
- **Every `ContentExtractor` method is async, but nothing runs off the event
  loop.** `clean()` returns an already-settled promise, so a CPU-heavy page
  blocks for its span — `await` the calls and isolate concurrency yourself. The
  only `null`/empty result is a page the declared-language filter rejected.
- **Raw HTML is byte-bounded before language parsing.** The package uses
  Trafilatura Core's exported 10 MiB UTF-8 default so a declared-language
  mismatch cannot bypass the engine boundary.
- **`vitest run` exits 1 on zero tests.** Apps with no tests pass
  `--passWithNoTests` so recursive `pnpm test` does not break.

## XML / XML-TEI

Trafilatura's Python original could emit `xml` / `xmltei`; Markdownee does
not. `@markdownee/conversion` renders `txt`, `markdown`, `html`, and `minified-html`
only, and there is no plan to add the XML formats.
