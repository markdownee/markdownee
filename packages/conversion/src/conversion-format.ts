/** Raw selectors accepted at public and wire boundaries, in canonical order. */
export type ConversionFormat = 'txt' | 'markdown' | 'html' | 'minified-html';
export const CONVERSION_FORMATS = [
  'txt',
  'markdown',
  'html',
  'minified-html',
] as const satisfies readonly ConversionFormat[];

/** Structured result keys used by JavaScript, schemas, and stored records. */
export const CONVERSION_FORMAT_RESULT_KEYS = {
  txt: 'txt',
  markdown: 'markdown',
  html: 'html',
  'minified-html': 'minifiedHtml',
} as const satisfies Record<ConversionFormat, string>;

export type ConversionResultKey = (typeof CONVERSION_FORMAT_RESULT_KEYS)[ConversionFormat];
export type ConversionResult = Partial<Record<ConversionResultKey, string>>;

const CONVERSION_FORMAT_SET = new Set<string>(CONVERSION_FORMATS);

/** Runtime guard: is `value` a {@link ConversionFormat}? */
export function isConversionFormat(value: string): value is ConversionFormat {
  return CONVERSION_FORMAT_SET.has(value);
}
