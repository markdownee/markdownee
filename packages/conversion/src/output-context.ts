import { OutputLayout } from '@markdownee/schema';

export { OutputLayout };

/** Output-envelope layouts owned by Markdownee. */
export const OUTPUT_LAYOUTS = [
  OutputLayout.Minimal,
  OutputLayout.Standard,
  OutputLayout.Enhanced,
] as const;

export interface StandardMetadata {
  title?: string;
  author?: string;
  date?: string;
  description?: string;
  siteName?: string;
  languageCode?: string;
}

export interface EnhancedMetadata extends StandardMetadata {
  pageUrl?: string;
  imageUrl?: string;
  hostname?: string;
  categories?: string[];
  tags?: string[];
  license?: string;
  declaredPageType?: string;
}

export interface CrawlContext {
  loadedUrl?: string;
  scrapedAt?: string;
  httpStatusCode?: number;
  depth?: number;
  referrerUrl?: string;
}

/** One allowlisted logical model shared by every output serializer and destination. */
export interface OutputContext {
  metadata: EnhancedMetadata;
  url?: string;
  crawl?: CrawlContext;
}

/** Keep only HTTP(S) output URLs and remove credential-bearing userinfo. */
export function normalizeOutputUrl(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    parsed.username = '';
    parsed.password = '';
    return parsed.href;
  } catch {
    return undefined;
  }
}

function nonEmpty(values: string[] | undefined): string[] | undefined {
  return values !== undefined && values.length > 0 ? values : undefined;
}

/** Normalize allowlisted fields, URL values, omission, and deterministic order. */
export function normalizeContextForLayout(
  context: OutputContext,
  layout: Exclude<OutputLayout, 'minimal'>,
): OutputContext {
  const metadata: EnhancedMetadata = omitUndefined({
    title: context.metadata.title,
    author: context.metadata.author,
    date: context.metadata.date,
    description: context.metadata.description,
    siteName: context.metadata.siteName,
    languageCode: context.metadata.languageCode,
    ...(layout === 'enhanced'
      ? {
          pageUrl: normalizeOutputUrl(context.metadata.pageUrl),
          imageUrl: normalizeOutputUrl(context.metadata.imageUrl),
          hostname: context.metadata.hostname,
          categories: nonEmpty(context.metadata.categories),
          tags: nonEmpty(context.metadata.tags),
          license: context.metadata.license,
          declaredPageType: context.metadata.declaredPageType,
        }
      : {}),
  });
  if (layout === 'standard') return { metadata };

  const crawl =
    context.crawl === undefined
      ? undefined
      : omitEmpty(
          omitUndefined({
            loadedUrl: normalizeOutputUrl(context.crawl.loadedUrl),
            scrapedAt: context.crawl.scrapedAt,
            httpStatusCode: context.crawl.httpStatusCode,
            depth: context.crawl.depth,
            referrerUrl: normalizeOutputUrl(context.crawl.referrerUrl),
          }),
        );
  return {
    metadata,
    ...(normalizeOutputUrl(context.url) === undefined
      ? {}
      : { url: normalizeOutputUrl(context.url) }),
    ...(crawl === undefined ? {} : { crawl }),
  };
}

/** Build the flat, kebab-case context used only by TXT/Markdown front matter. */
export function frontMatterForLayout(
  context: OutputContext,
  layout: Exclude<OutputLayout, 'minimal'>,
): Record<string, unknown> {
  const normalized = normalizeContextForLayout(context, layout);
  const metadata = normalized.metadata;
  return omitUndefined({
    title: metadata.title,
    author: metadata.author,
    date: metadata.date,
    description: metadata.description,
    'language-code': metadata.languageCode,
    ...(layout === 'enhanced'
      ? {
          'site-name': metadata.siteName,
          'page-url': metadata.pageUrl,
          'image-url': metadata.imageUrl,
          hostname: metadata.hostname,
          categories: metadata.categories,
          tags: metadata.tags,
          license: metadata.license,
          'declared-page-type': metadata.declaredPageType,
          'request-url': normalized.url,
          'crawl-loaded-url': normalized.crawl?.loadedUrl,
          'crawl-scraped-at': normalized.crawl?.scrapedAt,
          'crawl-http-status-code': normalized.crawl?.httpStatusCode,
          'crawl-depth': normalized.crawl?.depth,
          'crawl-referrer-url': normalized.crawl?.referrerUrl,
        }
      : {}),
  });
}

function omitUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as Partial<T>;
}

function omitEmpty(value: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(value).length === 0 ? undefined : value;
}
