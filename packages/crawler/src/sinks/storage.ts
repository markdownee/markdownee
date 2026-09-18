import { createHash } from 'node:crypto';
import {
  CONVERSION_FORMAT_RESULT_KEYS,
  computeContentInfo,
  type OutputFormat,
} from '@markdownee/extraction';
import { type FormatRoute, type RouteMap, savesOriginal } from './routes.js';
import type { ExtractionResult } from './types.js';

/** A content kind written to the key-value store: an output format, or the raw original HTML. */
export type ContentKind = OutputFormat | 'original';

interface KvsSpec {
  ext: string;
  contentType: string;
  keyPrefix: string;
}

/**
 * Per-kind key-value-store metadata. The `keyPrefix` values MUST match the
 * `KvsCollections` keyPrefixes in `@markdownee/schema`; a test asserts this.
 */
const KVS_SPECS: Record<ContentKind, KvsSpec> = {
  txt: { ext: 'txt', contentType: 'text/plain; charset=utf-8', keyPrefix: 'txt-' },
  markdown: { ext: 'md', contentType: 'text/markdown; charset=utf-8', keyPrefix: 'markdown-' },
  html: { ext: 'html', contentType: 'text/html; charset=utf-8', keyPrefix: 'html-' },
  'minified-html': {
    ext: 'html',
    contentType: 'text/html; charset=utf-8',
    keyPrefix: 'minified-html-',
  },
  original: { ext: 'html', contentType: 'text/html; charset=utf-8', keyPrefix: 'original-' },
};

/** Output formats written from `result.formats` (everything except the raw original HTML). */
const CONTENT_FORMATS: readonly OutputFormat[] = ['txt', 'markdown', 'html', 'minified-html'];

/**
 * A piece of content (an extracted format or the raw original HTML). `hash` +
 * `bytes` are always present; `content` carries the inline string (dataset
 * destination), while `key` + `url` reference the stored blob (key-value-store
 * destination).
 */
export interface ContentNode {
  hash: string;
  bytes: number;
  content?: string;
  key?: string;
  url?: string;
}

/** Minimal key-value-store surface shared by the Apify SDK and Crawlee stores. */
export interface KvsLike {
  setValue(key: string, value: string | Buffer, options?: { contentType?: string }): Promise<void>;
  getPublicUrl?(key: string): string | Promise<string>;
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

/** Deterministic KVS key for a content blob: `{keyPrefix}{md5(url)}.{ext}`. */
export function kvsKey(kind: ContentKind, url: string): string {
  const spec = KVS_SPECS[kind];
  return `${spec.keyPrefix}${md5(url)}.${spec.ext}`;
}

/**
 * Key prefix grouping the save-image-mode artifacts. MUST match the `images`
 * `KvsCollections` keyPrefix in `@markdownee/schema`; a test asserts this.
 *
 * Hyphen-separated (`images-`), NOT `images/`: the KVS key charset
 * (`KEY_VALUE_STORE_KEY_REGEX = /^([a-zA-Z0-9!\-_.'()]{1,256})$/` in
 * `@apify/consts`, enforced by both Crawlee's local storage and the Apify
 * platform) has an ESCAPED hyphen — a literal, not a range — so `/` is
 * rejected. `images-` follows the house `{prefix}-{md5}.{ext}` convention.
 */
const IMAGES_KEY_PREFIX = 'images-';

/**
 * Deterministic KVS key for an image stored by the save image-handling mode:
 * `images-{md5(sourceUrl)}.{ext}`. URL-derived (never content-hash, never
 * timestamped) so same-URL re-runs overwrite idempotently. `ext` states the
 * ACTUAL stored format (`webp` re-encoded raster, `png` rasterized SVG, `svg`
 * sanitized source) — image extensions vary per stored artifact, so images get
 * their own helper instead of a fixed-ext `ContentKind`.
 */
export function imageKvsKey(sourceUrl: string, ext: string): string {
  return `${IMAGES_KEY_PREFIX}${md5(sourceUrl)}.${ext}`;
}

/**
 * Deterministic KVS key for the pre-normalization (original) bytes of a saved
 * image: `images-{md5(sourceUrl)}-original.{ext}`, where `ext` is the ORIGINAL
 * format's extension (sniffed from magic bytes / content type — never
 * extensionless). Written only when the run's `save` tokens include an
 * `original-*` route.
 */
export function originalImageKvsKey(sourceUrl: string, ext: string): string {
  return `${IMAGES_KEY_PREFIX}${md5(sourceUrl)}-original.${ext}`;
}

/** Blob extension for a content kind (`txt`, `md`, or `html`). */
export function extForKind(kind: ContentKind): string {
  return KVS_SPECS[kind].ext;
}

/** Structured record field for a content kind. */
export function fieldForKind(kind: ContentKind): string {
  return kind === 'original' ? 'original' : CONVERSION_FORMAT_RESULT_KEYS[kind];
}

/** User-facing file suffix, including multi-dot HTML variants. */
export function fileSuffixForKind(kind: ContentKind): string {
  switch (kind) {
    case 'markdown':
      return '.md';
    case 'minified-html':
      return '.min.html';
    case 'original':
      return '.original.html';
    default:
      return `.${extForKind(kind)}`;
  }
}

/** Current time as an ISO 8601 timestamp truncated to whole seconds. */
function isoSecond(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

/**
 * Build a `ContentNode` for one piece of content, driven by its per-format
 * route. A format may target both destinations at once: when `toDataset`, the
 * string is inlined as `content`; when `toKvs`, the blob is written to the
 * key-value store and referenced by `key` (+ `url` when the store exposes a
 * public URL — the Apify platform; local Crawlee storage has none). Both `content`
 * and `key`/`url` are set when the format routes to both.
 */
async function buildContentNode(
  kvs: KvsLike,
  kind: ContentKind,
  url: string,
  content: string,
  info: { hash: string; bytes: number },
  r: FormatRoute,
): Promise<ContentNode> {
  const node: ContentNode = { hash: info.hash, bytes: info.bytes };
  if (r.toDataset) {
    node.content = content;
  }
  if (r.toKvs) {
    const key = kvsKey(kind, url);
    await kvs.setValue(key, content, { contentType: KVS_SPECS[kind].contentType });
    node.key = key;
    if (kvs.getPublicUrl) {
      const publicUrl = await kvs.getPublicUrl(key);
      if (publicUrl) node.url = publicUrl;
    }
  }
  return node;
}

export interface BuildSuccessRecordOpts {
  kvs: KvsLike;
  /** Per-format destination map parsed from the `save` token array. */
  routes: RouteMap;
}

/**
 * Assemble the `status: 'success'` dataset record for one extracted page, shared
 * by the Apify Actor and the standalone CLI/lib so their records are identical.
 * Each generated content field and `original` is written
 * as a `ContentNode` only when its `route` selects a destination: inlined as
 * `content` for the dataset, referenced by `key`/`url` for the key-value store,
 * or both when the format targets both. `original` is always present (at least
 * `{ hash, bytes }`); its raw HTML is included only when an `original-*` token
 * is in save.
 */
export async function buildSuccessRecord(
  result: ExtractionResult,
  opts: BuildSuccessRecordOpts,
): Promise<Record<string, unknown>> {
  const { kvs, routes } = opts;

  const data: Record<string, unknown> = {
    url: result.url,
    status: 'success',
    metadata: result.metadata,
  };
  if (result.crawl !== undefined) data.crawl = result.crawl;

  const originalInfo = { hash: result.rawHtmlHash, bytes: result.rawHtmlLength };
  data.original = savesOriginal(routes)
    ? await buildContentNode(
        kvs,
        'original',
        result.url,
        result.html,
        originalInfo,
        routes.original,
      )
    : { ...originalInfo };

  for (const fmt of CONTENT_FORMATS) {
    const r = routes[fmt];
    if (!r.toKvs && !r.toDataset) continue;
    const resultKey = CONVERSION_FORMAT_RESULT_KEYS[fmt];
    const content = result.formats[resultKey];
    if (content === undefined) continue;
    const info = computeContentInfo(content);
    data[resultKey] = await buildContentNode(
      kvs,
      fmt,
      result.url,
      content,
      { hash: info.hash, bytes: info.length },
      r,
    );
  }

  // Save-image-mode references: the handler's byte pipeline already wrote the
  // blobs to the key-value store; the record carries only the references.
  if (result.images !== undefined) data.images = result.images;

  // Provenance for a Markdown-sourced page. Absent means extracted from HTML,
  // which is every page unless `markdownDiscovery` was turned on. It discloses
  // that `original` above is derived from the served bytes rather than received
  // from the origin, so it must not be inferable only from the content.
  if (result.markdownSource !== undefined) data.markdownSource = result.markdownSource;

  return data;
}

export interface FailedRequestInfo {
  url: string;
  loadedUrl: string | null;
  errorMessages: string[];
  retryCount: number;
}

/** Assemble the `status: 'failed'` dataset record. Shared across surfaces. */
export function buildFailedRecord(info: FailedRequestInfo): Record<string, unknown> {
  return {
    url: info.url,
    status: 'failed',
    crawl: {
      ...(info.loadedUrl !== null ? { loadedUrl: info.loadedUrl } : {}),
      scrapedAt: isoSecond(),
    },
    errors: info.errorMessages,
    retryCount: info.retryCount,
  };
}

/** Assemble the `status: 'skipped'` dataset record. Shared across surfaces. */
export function buildSkippedRecord(url: string, skipReason: string): Record<string, unknown> {
  return { url, status: 'skipped', skipReason };
}
