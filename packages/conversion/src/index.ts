/**
 * `@markdownee/conversion` — cleaned HTML in, output formats out.
 *
 * The extraction engine (`trafilaturacore`) returns exactly one artifact: a
 * cleaned-HTML string. This package turns that string into Markdownee's
 * remaining formats, parsing it **once** and reusing the node:
 *
 * - `markdown` — Turndown + the GFM plugin (tables, strikethrough, task lists)
 * - `txt` — a whitespace-collapsing DOM walk (no library)
 * - `html` — readable, formatted cleaned HTML
 * - `minified-html` — compact cleaned HTML exposed as `minifiedHtml`
 *
 * XML and XML-TEI are deliberately absent: Markdownee exposes neither.
 *
 * It also owns the inbound direction — reading a Markdown body an origin served
 * for a page, so `txt` and `html` can be rendered from it (`served-markdown.ts`).
 * That HTML is UNSANITIZED and its caller must route it through Trafilatura Core
 * Core's security floor; this package still fetches nothing.
 *
 * It is also the repo's single owner of `@mixmark-io/domino` and of the
 * structural DOM types above it, which `@markdownee/extraction` reuses for
 * its declared-language filter.
 */

export {
  CONVERSION_FORMAT_RESULT_KEYS,
  CONVERSION_FORMATS,
  type ConversionFormat,
  type ConversionResult,
  type ConversionResultKey,
  isConversionFormat,
} from './conversion-format.js';
export { type ConvertOptions, convert } from './convert.js';
export {
  type DomDocument,
  type DomElement,
  type DomNode,
  type DomNodeList,
  elementsOf,
} from './dom-node.js';
export { toMarkdown } from './markdown.js';
export type { Message, MessageType } from './message.js';
export {
  type CrawlContext,
  type EnhancedMetadata,
  normalizeOutputUrl,
  OUTPUT_LAYOUTS,
  type OutputContext,
  OutputLayout,
  type StandardMetadata,
} from './output-context.js';
export { addFrontMatter, buildLayoutHtml } from './output-layout.js';
export { parseCleanedHtml, parseDocument } from './parse.js';
export { toPlainText } from './plain-text.js';
export { formatReadableHtml, type ReadableHtmlResult } from './presentation.js';
export {
  containsUnsafeMarkup,
  looksLikeMarkdown,
  markdownToHtml,
  type ServedFrontMatter,
  type ServedMarkdown,
  stripFrontMatter,
} from './served-markdown.js';
