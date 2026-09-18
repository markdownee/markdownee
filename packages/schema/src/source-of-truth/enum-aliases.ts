/** Public aliases for Markdownee's user-authored string vocabularies. */
export const Save = {
  TxtDataset: 'txt-dataset',
  TxtKvs: 'txt-kvs',
  MarkdownDataset: 'markdown-dataset',
  MarkdownKvs: 'markdown-kvs',
  HtmlDataset: 'html-dataset',
  HtmlKvs: 'html-kvs',
  MinifiedHtmlDataset: 'minified-html-dataset',
  MinifiedHtmlKvs: 'minified-html-kvs',
  OriginalDataset: 'original-dataset',
  OriginalKvs: 'original-kvs',
} as const;
export type Save = (typeof Save)[keyof typeof Save];

export const SaveFormat = {
  Txt: 'txt',
  Markdown: 'markdown',
  Html: 'html',
  MinifiedHtml: 'minified-html',
  Original: 'original',
} as const;
export type SaveFormat = (typeof SaveFormat)[keyof typeof SaveFormat];

/** Raw save-format selector to structured output-record field. */
export const SaveFormatResultKey = {
  [SaveFormat.Txt]: 'txt',
  [SaveFormat.Markdown]: 'markdown',
  [SaveFormat.Html]: 'html',
  [SaveFormat.MinifiedHtml]: 'minifiedHtml',
  [SaveFormat.Original]: 'original',
} as const satisfies Record<SaveFormat, string>;

export const CrawlerType = {
  PlaywrightAdaptive: 'playwright-adaptive',
  PlaywrightFirefox: 'playwright-firefox',
  PlaywrightChromium: 'playwright-chromium',
  Cheerio: 'cheerio',
} as const;
export type CrawlerType = (typeof CrawlerType)[keyof typeof CrawlerType];

/**
 * How hard the crawler looks for a Markdown representation the site publishes
 * itself. Graded by request cost, cheapest first; each rung includes the ones
 * above it. `Off` is the default — the values are a fetch-side discovery
 * strategy, not an output format, and `markdown` remains a `SaveFormat`.
 */
export const MarkdownDiscovery = {
  Off: 'off',
  Alternate: 'alternate',
  Negotiate: 'negotiate',
  Probe: 'probe',
} as const;
export type MarkdownDiscovery = (typeof MarkdownDiscovery)[keyof typeof MarkdownDiscovery];

/**
 * How a Markdown-sourced page's bytes were reached. Output vocabulary, recorded
 * on the success record — distinct from
 * {@link MarkdownDiscovery:variable | MarkdownDiscovery}, which is the input
 * setting deciding how hard to look.
 */
export const MarkdownMechanism = {
  /** The page fetch itself returned Markdown, because it carried the Accept. */
  Response: 'response',
  /** A same-origin link the page advertised, in its head or its Link header. */
  Alternate: 'alternate',
  /** A second fetch of the same URL that asked for Markdown. */
  Negotiated: 'negotiated',
  /** A speculative `.md` sibling of the page URL. */
  Sibling: 'sibling',
} as const;
export type MarkdownMechanism = (typeof MarkdownMechanism)[keyof typeof MarkdownMechanism];

export const Deduplication = {
  Minimal: 'minimal',
  Standard: 'standard',
  Aggressive: 'aggressive',
} as const;
export type Deduplication = (typeof Deduplication)[keyof typeof Deduplication];

export const Mode = {
  Precision: 'precision',
  Balanced: 'balanced',
  Recall: 'recall',
  Keep: 'keep',
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export const ImageHandling = {
  Exclude: 'exclude',
  AltText: 'alt-text',
  ResolvedUrl: 'resolved-url',
  Save: 'save',
} as const;
export type ImageHandling = (typeof ImageHandling)[keyof typeof ImageHandling];

export const LinkHandling = {
  Include: 'include',
  Exclude: 'exclude',
} as const;
export type LinkHandling = (typeof LinkHandling)[keyof typeof LinkHandling];

export const TableHandling = {
  Include: 'include',
  Exclude: 'exclude',
} as const;
export type TableHandling = (typeof TableHandling)[keyof typeof TableHandling];

export const CommentHandling = {
  Include: 'include',
  Exclude: 'exclude',
} as const;
export type CommentHandling = (typeof CommentHandling)[keyof typeof CommentHandling];

export const OutputLayout = {
  Minimal: 'minimal',
  Standard: 'standard',
  Enhanced: 'enhanced',
} as const;
export type OutputLayout = (typeof OutputLayout)[keyof typeof OutputLayout];

export const ProxyRotation = {
  Recommended: 'recommended',
  PerRequest: 'per-request',
  UntilFailure: 'until-failure',
} as const;
export type ProxyRotation = (typeof ProxyRotation)[keyof typeof ProxyRotation];

export const WaitUntil = {
  Load: 'load',
  DomContentLoaded: 'domcontentloaded',
  NetworkIdle: 'networkidle',
  Commit: 'commit',
} as const;
export type WaitUntil = (typeof WaitUntil)[keyof typeof WaitUntil];

export const LogLevel = {
  Off: 'off',
  Error: 'error',
  Warning: 'warning',
  Info: 'info',
  Debug: 'debug',
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];
