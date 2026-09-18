import { imageKvsKey, type KvsLike, originalImageKvsKey } from '../sinks/storage.js';
import { encodeImage, sniffOriginalFormat } from './encode.js';
import type { ImageFetcher } from './image-fetcher.js';
import type { StoredImage } from './stored-image.js';

/**
 * The save image-handling byte pipeline. Runs between the engine pass
 * (`cleanPage`, which already normalized every image to a single `<img>` with
 * an absolute, resolved `src`) and format rendering (`renderFormats`):
 *
 * - collects the unique http(s) `img src` URLs from the cleaned HTML
 * - downloads each (concurrency-bounded; per-image failures are non-fatal)
 * - normalizes bytes via {@link encodeImage} (raster → WebP, SVG → sanitized
 *   PNG or SVG source) and writes them to the key-value store under
 *   `images-{md5(sourceUrl)}.{ext}`
 * - optionally stores the pre-normalization bytes under
 *   `images-{md5(sourceUrl)}-original.{ext}` (when the run's `save` tokens
 *   include an `original-*` route)
 * - rewrites each stored image's `src` to its public URL, or to the
 *   `kvs://{key}` reference when the store has no public URL (local runs)
 * - removes dropped images (tracking pixels / sub-64px noise) entirely
 *
 * The rewritten HTML then flows into `renderFormats`, so markdown/txt/html/minified-html
 * all carry the stored references.
 */

/** Minimal logging surface (satisfied by Crawlee's `Log`). */
export interface ImageLog {
  info(message: string): void;
  warning(message: string): void;
}

export interface SaveImagesOptions {
  /** Destination store for the image bytes. */
  kvs: KvsLike;
  /** Long-edge pixel cap (never upscales); `0` = uncapped. */
  maxImageEdge: number;
  /** Store SVGs rasterized to PNG (`true`, default) or as sanitized SVG source. */
  rasterizeSvg: boolean;
  /** Also store each image's pre-normalization bytes (an `original-*` save token is set). */
  saveOriginal: boolean;
  log?: ImageLog;
}

export interface SaveImagesResult {
  /** The cleaned HTML with stored images' `src` rewritten and dropped images removed. */
  html: string;
  /** One entry per stored image, in document order. */
  images: StoredImage[];
}

/** Concurrent image downloads per page. */
const FETCH_CONCURRENCY = 5;

const IMG_TAG_RE = /<img\b[^>]*\/?>/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/i;

type ImageOutcome =
  | { kind: 'stored'; record: StoredImage }
  | { kind: 'dropped' }
  | { kind: 'kept' };

/** Run the save-mode byte pipeline over one page's cleaned HTML. */
export async function saveImages(
  cleanedHtml: string,
  fetcher: ImageFetcher,
  opts: SaveImagesOptions,
): Promise<SaveImagesResult> {
  const entries = collectImageEntries(cleanedHtml);
  if (entries.size === 0) return { html: cleanedHtml, images: [] };

  const urls = [...entries.keys()];
  const outcomes = new Map<string, ImageOutcome>();
  await mapWithConcurrency(urls, FETCH_CONCURRENCY, async (url) => {
    outcomes.set(url, await processOne(url, entries.get(url)?.alt, fetcher, opts));
  });

  const html = cleanedHtml.replace(IMG_TAG_RE, (tag) => {
    const src = attrValue(tag, 'src');
    if (src === undefined) return tag;
    const outcome = outcomes.get(src);
    if (outcome === undefined || outcome.kind === 'kept') return tag;
    if (outcome.kind === 'dropped') return '';
    const ref = outcome.record.publicUrl ?? `kvs://${outcome.record.key}`;
    return tag.replace(SRC_ATTR_RE, `src="${escapeAttr(ref)}"`);
  });

  const images: StoredImage[] = [];
  for (const url of urls) {
    const outcome = outcomes.get(url);
    if (outcome?.kind === 'stored') images.push(outcome.record);
  }
  return { html, images };
}

async function processOne(
  url: string,
  alt: string | undefined,
  fetcher: ImageFetcher,
  opts: SaveImagesOptions,
): Promise<ImageOutcome> {
  try {
    const fetched = await fetcher(url);
    if (fetched === null) {
      opts.log?.warning(`Image download failed, keeping URL reference: ${url}`);
      return { kind: 'kept' };
    }

    const encoded = await encodeImage(fetched.body, fetched.contentType, {
      maxImageEdge: opts.maxImageEdge,
      rasterizeSvg: opts.rasterizeSvg,
    });
    if (encoded.kind === 'skipped') {
      opts.log?.warning(`Image not stored (${encoded.reason}), keeping URL reference: ${url}`);
      return { kind: 'kept' };
    }
    if (encoded.kind === 'dropped') {
      opts.log?.info(`Image dropped (${encoded.reason}): ${url}`);
      return { kind: 'dropped' };
    }

    const key = imageKvsKey(url, encoded.ext);
    await opts.kvs.setValue(key, encoded.data, { contentType: encoded.contentType });

    if (opts.saveOriginal) {
      const original = sniffOriginalFormat(fetched.body, fetched.contentType);
      await opts.kvs.setValue(originalImageKvsKey(url, original.ext), fetched.body, {
        contentType: original.contentType,
      });
    }

    const record: StoredImage = { key, sourceUrl: url, format: encoded.format };
    if (opts.kvs.getPublicUrl) {
      const publicUrl = await opts.kvs.getPublicUrl(key);
      if (publicUrl) record.publicUrl = publicUrl;
    }
    if (alt !== undefined && alt !== '') record.alt = alt;
    if (encoded.width !== undefined) record.width = encoded.width;
    if (encoded.height !== undefined) record.height = encoded.height;
    return { kind: 'stored', record };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.log?.warning(`Image save failed (${message}), keeping URL reference: ${url}`);
    return { kind: 'kept' };
  }
}

/**
 * Unique http(s) image URLs in document order, with the first occurrence's alt
 * text. Post-engine `resolved-url`, every `img src` is already absolute and
 * normalized; anything else (`data:`, residual relative paths) is left alone.
 */
function collectImageEntries(html: string): Map<string, { alt?: string }> {
  const entries = new Map<string, { alt?: string }>();
  for (const match of html.matchAll(IMG_TAG_RE)) {
    const tag = match[0];
    const src = attrValue(tag, 'src');
    if (src === undefined || !/^https?:\/\//i.test(src)) continue;
    if (!entries.has(src)) {
      const alt = attrValue(tag, 'alt');
      entries.set(src, alt !== undefined && alt !== '' ? { alt } : {});
    }
  }
  return entries;
}

/** Extract + entity-decode one attribute value from a serialized `<img>` tag. */
function attrValue(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = tag.match(re);
  if (!match) return undefined;
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    const named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    };
    return named[lower] ?? whole;
  });
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}
