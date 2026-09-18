import {
  CONVERSION_FORMAT_RESULT_KEYS,
  type ConversionFormat,
  type ConversionResult,
} from './conversion-format.js';
import { toMarkdown } from './markdown.js';
import type { OutputContext, OutputLayout } from './output-context.js';
import { addFrontMatter } from './output-layout.js';
import { parseCleanedHtml } from './parse.js';
import { toPlainText } from './plain-text.js';

export interface ConvertOptions {
  /** Input used when every requested representation has the same bytes. */
  html?: string;
  /** Stable layout-selected HTML used only as the TXT/Markdown semantic input. */
  semanticHtml?: string;
  /** Readable, formatted generated HTML. */
  readableHtml?: string;
  /** Compact generated HTML. */
  minifiedHtml?: string;
  formats: readonly ConversionFormat[];
  layout?: OutputLayout;
  context?: OutputContext;
}

/** Render selected formats from one stable semantic representation. */
export function convert(options: ConvertOptions): ConversionResult {
  const semanticHtml = options.semanticHtml ?? options.html ?? '';
  const readableHtml = options.readableHtml ?? options.html ?? semanticHtml;
  const minifiedHtml = options.minifiedHtml ?? options.html ?? semanticHtml;
  const layout = options.layout ?? 'minimal';
  const context = options.context ?? { metadata: {} };
  const wanted = new Set(options.formats);
  const out: ConversionResult = {};
  if (wanted.has('html')) out[CONVERSION_FORMAT_RESULT_KEYS.html] = readableHtml;
  if (wanted.has('minified-html')) {
    out[CONVERSION_FORMAT_RESULT_KEYS['minified-html']] = minifiedHtml;
  }
  if (!wanted.has('txt') && !wanted.has('markdown')) return out;

  const body = parseCleanedHtml(semanticHtml);
  const bodyText = wanted.has('txt') ? toPlainText(body) : '';
  const bodyMarkdown = wanted.has('markdown') ? toMarkdown(body) : '';

  if (wanted.has('txt')) {
    out.txt = layout === 'minimal' ? bodyText : addFrontMatter(bodyText, layout, context);
  }
  if (wanted.has('markdown')) {
    out.markdown =
      layout === 'minimal' ? bodyMarkdown : addFrontMatter(bodyMarkdown, layout, context);
  }
  return out;
}
