/**
 * `@markdownee/extraction` — TypeScript content-extraction package.
 *
 * Built on **Trafilatura Core** (`trafilaturacore`, https://www.trafilaturacore.com/),
 * a pure-TypeScript extraction engine: HTML in, cleaned HTML out. Its
 * secured post-clean/pre-presentation seam is called **once** per page;
 * `@markdownee/conversion` renders every requested output format from that
 * stable semantic representation.
 *
 * Consumed by the `@markdownee/apify` Actor and the standalone CLI, which
 * both also use Crawlee (TypeScript) for crawling.
 */

import {
  buildLayoutHtml,
  CONVERSION_FORMAT_RESULT_KEYS,
  type ConversionFormat,
  type ConversionResult,
  type ConversionResultKey,
  type CrawlContext,
  convert,
  formatReadableHtml,
  normalizeOutputUrl,
  type OutputContext,
  parseCleanedHtml,
  toPlainText,
} from '@markdownee/conversion';
import {
  CommentHandling,
  ImageHandling,
  LinkHandling,
  OutputLayout,
  TableHandling,
} from '@markdownee/schema';
import {
  type BoilerplateMode,
  type CleanOptions,
  DEFAULT_BOILERPLATE_MODE,
  DEFAULT_MAX_INPUT_BYTES,
  type Metadata as EngineMetadata,
  formatSecuredHtml,
  type Message,
  prepare,
} from 'trafilaturacore';
import { applyLanguageFilter } from './language.js';

export type {
  CrawlContext,
  EnhancedMetadata,
  OutputContext,
  ServedFrontMatter,
  ServedMarkdown,
  StandardMetadata,
} from '@markdownee/conversion';
/**
 * The served-Markdown readers, re-exported so `@markdownee/crawler` reaches
 * them through this package rather than taking its own edge on the conversion
 * package. `markdownToHtml` returns UNSANITIZED HTML; {@link ContentExtractor}
 * is what routes it through Trafilatura Core's security floor.
 */
export {
  addFrontMatter,
  containsUnsafeMarkup,
  looksLikeMarkdown,
  markdownToHtml,
  stripFrontMatter,
} from '@markdownee/conversion';
export type { BoilerplateMode } from 'trafilaturacore';
export type { ConversionFormat, ConversionResult, ConversionResultKey };
export {
  CONVERSION_FORMAT_RESULT_KEYS,
  CommentHandling,
  ImageHandling,
  LinkHandling,
  OutputLayout,
  TableHandling,
};

/** Supported raw output selectors. */
export type OutputFormat = ConversionFormat;

const DEFAULT_FORMATS: readonly OutputFormat[] = ['txt', 'markdown', 'html', 'minified-html'];

/**
 * Markdownee's image-handling modes. `exclude`/`alt-text`/`resolved-url` map
 * 1:1 onto the engine's modes; the `save` MODE (download image bytes into the
 * key-value store — distinct from the `save` format-destination TOKENS) is
 * crawler-layer and maps to the engine's `resolved-url` at the `clean()`
 * boundary. Runtime validation lives in the `@markdownee/schema` Zod
 * source of truth; these unions mirror it.
 */
/**
 * Extraction config, mapped onto the engine's `CleanOptions`.
 *
 * `boilerplate` is the engine's boilerplate-removal mode, passed straight
 * through (Markdownee's mode vocabulary IS the engine's `BoilerplateMode`).
 * The four `*Handling` content enums are Markdownee's vocabulary;
 * {@link ContentExtractor.cleanPage} translates the markdownee-only
 * `imageHandling: 'save'` member at the engine boundary.
 */
export interface TrafilaturacoreConfig {
  /**
   * Boilerplate-removal mode: `precision` (drops the most), `balanced` (default),
   * `recall` (keeps more content), or `keep` (skips main-content
   * extraction — returns clean HTML for the whole document, keeping boilerplate).
   */
  boilerplate: BoilerplateMode;
  /** User-comment sections are included or structurally excluded. */
  commentHandling: CommentHandling;
  /** `exclude` discards table subtrees (including cell text). Default `include`. */
  tableHandling: TableHandling;
  /**
   * Default `exclude` (Markdownee removes images unless asked otherwise; the
   * engine's own default is `include`). `save` maps to the engine's `resolved-url`
   * — the byte download is the crawler's job.
   */
  imageHandling: ImageHandling;
  /** Default `include`. `exclude` unwraps `<a>` (anchor text kept, URL dropped). */
  linkHandling: LinkHandling;
  /**
   * Keep only content whose **declared** language matches this primary subtag.
   * Never statistical detection — see `language.ts`.
   */
  targetLanguage: string | null;
  /** Generated output envelope. */
  outputLayout: OutputLayout;
}

/** Defaults matching the input-schema defaults (images excluded, the rest included). */
export const DEFAULT_CONFIG: Readonly<TrafilaturacoreConfig> = Object.freeze({
  boilerplate: DEFAULT_BOILERPLATE_MODE,
  commentHandling: CommentHandling.Include,
  tableHandling: TableHandling.Include,
  imageHandling: ImageHandling.Exclude,
  linkHandling: LinkHandling.Include,
  targetLanguage: null,
  outputLayout: OutputLayout.Minimal,
});

/** Single-format extraction result. */
export interface ExtractionResult {
  content: string;
  format: OutputFormat;
}

/**
 * Page metadata. Core fields: `title`, `author`, `date`, `description`,
 * `sitename`, `language`. Extended: `categories`, `tags`, `license`, `image`,
 * `declaredPageType`, `hostname`, `url`.
 */
export interface Metadata {
  title: string | null;
  author: string | null;
  /** ISO 8601 string. */
  date: string | null;
  description: string | null;
  sitename: string | null;
  language: string | null;
  hostname: string | null;
  url: string | null;
  categories: string[] | null;
  tags: string[] | null;
  license: string | null;
  image: string | null;
  /** Raw OpenGraph `og:type`, or an upstream-recognized lowercased JSON-LD `@type`. */
  declaredPageType: string | null;
}

const EMPTY_METADATA: Readonly<Metadata> = Object.freeze({
  title: null,
  author: null,
  date: null,
  description: null,
  sitename: null,
  language: null,
  hostname: null,
  url: null,
  categories: null,
  tags: null,
  license: null,
  image: null,
  declaredPageType: null,
});

/**
 * Everything one `clean()` call produced, before it is rendered to formats —
 * the seam between {@link ContentExtractor.cleanPage} and
 * {@link ContentExtractor.renderFormats}. The crawler's save-mode image
 * pipeline rewrites `img src` on `html` between the two steps.
 */
export interface CleanedPage {
  /** Secured post-cleaning HTML before presentation formatting. */
  html: string;
  metadata: Metadata;
  messages: Message[];
  /** `true` when the declared-language filter rejected the whole page. */
  rejected: boolean;
}

/**
 * One page, cleaned once and rendered into every requested format.
 *
 * This is what a crawler wants: the previous engine forced N+1 native parses per
 * page (one per format, plus one for metadata), whereas one `clean()` call now
 * yields the metadata and the single cleaned-HTML string that every format is
 * rendered from.
 */
export interface PageExtraction {
  metadata: Metadata;
  /** Only the formats that produced content. A rejected page yields none. */
  formats: ConversionResult;
  messages: Message[];
  outputContext: OutputContext;
  /** Stable body text used for route-independent aggressive deduplication. */
  dedupeText: string;
}

export interface PageOutputContext {
  url?: string;
  crawl?: CrawlContext;
}

/**
 * Trafilatura Core wrapper with configurable extraction.
 *
 * Every method is **async**, but the engine is pure TypeScript and extracts
 * synchronously in process: `clean()` returns an already-settled promise, so the
 * work is not offloaded to the libuv threadpool and a CPU-heavy page blocks the
 * event loop for its span. A caller that needs concurrency isolates it itself.
 *
 * An ordinary extraction failure degrades to whole-document cleaning
 * and records a warning in `messages`. Validation and deterministic resource-limit
 * failures still reject and propagate through these methods. Errors are never
 * swallowed into `null`; the only `null`/empty result is a page the declared-
 * language filter rejected.
 */
export class ContentExtractor {
  private readonly config: TrafilaturacoreConfig;

  constructor(config?: Partial<TrafilaturacoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  }

  /** Read-only view of the resolved config (defaults merged with overrides). */
  getConfig(): Readonly<TrafilaturacoreConfig> {
    return this.config;
  }

  /**
   * Clean `html` **once** and render the requested formats, returning them
   * alongside the metadata and the engine's diagnostics. The call every crawler
   * handler should make: it is the only one that pays for a single engine pass.
   * A thin composition of {@link cleanPage} + {@link renderFormats}.
   */
  async extractPage(
    html: string,
    opts: { url?: string; formats?: readonly OutputFormat[]; context?: PageOutputContext } = {},
  ): Promise<PageExtraction> {
    const page = await this.cleanPage(html, opts.url);
    return this.renderFormats(page.html, page, opts.formats, {
      ...opts.context,
      ...(opts.url === undefined ? {} : { url: opts.url }),
    });
  }

  /**
   * Step two of the split API: render `cleanedHtml` into the requested formats.
   * `cleanedHtml` is passed separately from `page` so a caller may rewrite it
   * between {@link cleanPage} and this call (the crawler's save-mode image
   * pipeline rewrites `img src` to key-value-store URLs there); pass `page.html`
   * unchanged otherwise.
   */
  async renderFormats(
    cleanedHtml: string,
    page: CleanedPage,
    formats: readonly OutputFormat[] = DEFAULT_FORMATS,
    context?: PageOutputContext,
  ): Promise<PageExtraction> {
    const outputContext = toOutputContext(page, context);
    if (page.rejected) {
      return {
        metadata: page.metadata,
        formats: {},
        messages: page.messages,
        outputContext,
        dedupeText: '',
      };
    }

    const dedupeText = toPlainText(parseCleanedHtml(cleanedHtml));
    if (formats.length === 0) {
      return {
        metadata: page.metadata,
        formats: {},
        messages: page.messages,
        outputContext,
        dedupeText,
      };
    }

    const layoutHtml = buildLayoutHtml(cleanedHtml, this.config.outputLayout, outputContext);
    const needsCompact = formats.some(
      (format) => format === 'txt' || format === 'markdown' || format === 'minified-html',
    );
    const compact = needsCompact ? await formatSecuredHtml(layoutHtml) : undefined;
    const readable = formats.includes('html') ? await formatReadableHtml(layoutHtml) : undefined;
    const rendered = convert({
      semanticHtml: compact?.html ?? layoutHtml,
      readableHtml: readable?.html,
      minifiedHtml: compact?.html,
      formats,
      layout: this.config.outputLayout,
      context: outputContext,
    });

    const nonEmpty: ConversionResult = {};
    for (const format of formats) {
      const resultKey = CONVERSION_FORMAT_RESULT_KEYS[format];
      const content = rendered[resultKey];
      if (content !== undefined && content !== '') nonEmpty[resultKey] = content;
    }
    return {
      metadata: page.metadata,
      formats: nonEmpty,
      messages: [...page.messages, ...(compact?.messages ?? []), ...(readable?.messages ?? [])],
      outputContext,
      dedupeText,
    };
  }

  /** Extract a single output format from `html`. `null` when nothing survived. */
  async extract(
    html: string,
    opts: { url?: string; format?: OutputFormat } = {},
  ): Promise<ExtractionResult | null> {
    const format = opts.format ?? 'txt';
    const page = await this.cleanPage(html, opts.url);
    if (page.rejected) return null;
    const rendered = await this.renderFormats(page.html, page, [format], { url: opts.url });
    const content = rendered.formats[CONVERSION_FORMAT_RESULT_KEYS[format]];
    return content === undefined ? null : { content, format };
  }

  /** Extract metadata from `html`. Returns an all-`null` `Metadata` on failure. */
  async extractMetadata(html: string, url?: string): Promise<Metadata> {
    const page = await this.cleanPage(html, url);
    return page.metadata;
  }

  /** Clean `html` once and return every requested format keyed by format name. */
  async extractAllFormats(
    html: string,
    opts: { url?: string; formats?: OutputFormat[] } = {},
  ): Promise<Record<OutputFormat, ExtractionResult>> {
    const formats = opts.formats ?? DEFAULT_FORMATS;
    const out = createEmptyResultMap();

    const page = await this.cleanPage(html, opts.url);
    if (page.rejected) return out;

    const converted = (await this.renderFormats(page.html, page, formats, { url: opts.url }))
      .formats;
    for (const format of formats) {
      const content = converted[CONVERSION_FORMAT_RESULT_KEYS[format]];
      if (content !== undefined) out[format] = { content, format };
    }
    return out;
  }

  /**
   * Step one of the split API — the single engine call. Applies the
   * declared-language filter to the raw HTML first, then hands the survivors to
   * `clean()`. Render the result with {@link renderFormats} (optionally
   * rewriting the cleaned HTML in between).
   */
  async cleanPage(html: string, url?: string): Promise<CleanedPage> {
    // The declared-language pass parses the raw document before Trafilatura Core.
    // Enforce Core's exported public ceiling here as well so a language mismatch
    // cannot bypass the limit or make Domino parse an input Core would reject.
    const inputBytes = Buffer.byteLength(html, 'utf8');
    if (inputBytes > DEFAULT_MAX_INPUT_BYTES) {
      throw new RangeError(
        `Input HTML exceeds the ${DEFAULT_MAX_INPUT_BYTES}-byte limit: received ${inputBytes} bytes`,
      );
    }

    const filtered = applyLanguageFilter(html, this.config.targetLanguage);
    if (filtered.rejected) {
      return {
        html: '',
        metadata: { ...EMPTY_METADATA, language: filtered.language, url: url ?? null },
        messages: [
          {
            type: 'info',
            text: `declared language ${filtered.language ?? 'unknown'} does not match the requested ${this.config.targetLanguage ?? ''}`,
          },
        ],
        rejected: true,
      };
    }

    const result = await prepare(filtered.html, this.toCleanOptions(url));
    return {
      html: result.html,
      metadata: toMetadata(result.metadata, filtered.language, url),
      messages: result.messages,
      rejected: false,
    };
  }

  private toCleanOptions(url: string | undefined): CleanOptions {
    const options: CleanOptions = {
      boilerplate: this.config.boilerplate,
      commentHandling: this.config.commentHandling,
      tableHandling: this.config.tableHandling,
      // The markdownee-only `save` member needs the same resolved-URL
      // normalization; the byte download is the crawler's job.
      imageHandling:
        this.config.imageHandling === ImageHandling.Save
          ? ImageHandling.ResolvedUrl
          : this.config.imageHandling,
      linkHandling: this.config.linkHandling,
    };
    if (url !== undefined) options.url = url;
    return options;
  }
}

/** Returns a fresh copy of `DEFAULT_CONFIG`. */
export function getDefaultConfig(): TrafilaturacoreConfig {
  return { ...DEFAULT_CONFIG };
}

function createEmptyResultMap(): Record<OutputFormat, ExtractionResult> {
  return {
    txt: { content: '', format: 'txt' },
    markdown: { content: '', format: 'markdown' },
    html: { content: '', format: 'html' },
    'minified-html': { content: '', format: 'minified-html' },
  };
}

function defined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

function stripUrlUserinfoFromHostLabel(
  value: string | null | undefined,
  safeUrl: string | undefined,
): string | undefined {
  const label = defined(value);
  if (label === undefined || safeUrl === undefined || !label.includes('@')) return label;
  const hostname = new URL(safeUrl).hostname;
  return label.endsWith(`@${hostname}`) ? hostname : label;
}

function toOutputContext(page: CleanedPage, supplied?: PageOutputContext): OutputContext {
  const metadata = page.metadata;
  const metadataUrl = normalizeOutputUrl(metadata.url);
  const outputUrl = normalizeOutputUrl(supplied?.url) ?? metadataUrl;
  const outputMetadata: OutputContext['metadata'] = {};
  // Every allowlisted metadata key must be listed, with its declared value type.
  const metadataEntries: {
    [K in keyof Required<OutputContext['metadata']>]: OutputContext['metadata'][K];
  } = {
    title: defined(metadata.title),
    author: defined(metadata.author),
    date: defined(metadata.date),
    description: defined(metadata.description),
    siteName: stripUrlUserinfoFromHostLabel(metadata.sitename, outputUrl),
    languageCode: defined(metadata.language),
    pageUrl: metadataUrl,
    imageUrl: normalizeOutputUrl(metadata.image),
    hostname: stripUrlUserinfoFromHostLabel(metadata.hostname, outputUrl),
    categories: defined(metadata.categories),
    tags: defined(metadata.tags),
    license: defined(metadata.license),
    declaredPageType: defined(metadata.declaredPageType),
  };
  for (const [key, value] of Object.entries(metadataEntries)) {
    if (value !== undefined) (outputMetadata as Record<string, unknown>)[key] = value;
  }
  const crawl = supplied?.crawl;
  return {
    metadata: outputMetadata,
    ...(outputUrl === undefined ? {} : { url: outputUrl }),
    ...(crawl === undefined
      ? {}
      : {
          crawl: {
            ...(normalizeOutputUrl(crawl.loadedUrl) !== undefined
              ? { loadedUrl: normalizeOutputUrl(crawl.loadedUrl) }
              : {}),
            ...(crawl.scrapedAt !== undefined ? { scrapedAt: crawl.scrapedAt } : {}),
            ...(crawl.httpStatusCode !== undefined ? { httpStatusCode: crawl.httpStatusCode } : {}),
            ...(crawl.depth !== undefined ? { depth: crawl.depth } : {}),
            ...(normalizeOutputUrl(crawl.referrerUrl) !== undefined
              ? { referrerUrl: normalizeOutputUrl(crawl.referrerUrl) }
              : {}),
          },
        }),
  };
}

/**
 * Project the engine's optional metadata sidecar onto Markdownee's all-nullable
 * `Metadata`. `language` is not an engine field — it comes from the declared-lang
 * reader.
 */
function toMetadata(
  meta: EngineMetadata | undefined,
  language: string | null,
  url: string | undefined,
): Metadata {
  return {
    title: meta?.title ?? null,
    author: meta?.author ?? null,
    date: meta?.date ?? null,
    description: meta?.description ?? null,
    sitename: meta?.sitename ?? null,
    language,
    hostname: meta?.hostname ?? null,
    url: meta?.url ?? url ?? null,
    categories: meta?.categories ?? null,
    tags: meta?.tags ?? null,
    license: meta?.license ?? null,
    image: meta?.image ?? null,
    declaredPageType: meta?.declaredPageType ?? null,
  };
}

export * from './contentInfo.js';
export { applyLanguageFilter, declaredLanguage, normalizeLanguage } from './language.js';
export * from './metadata.js';
