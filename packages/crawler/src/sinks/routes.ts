import type { OutputFormat } from '@markdownee/extraction';
import { SaveFormat } from '@markdownee/schema';
import { log } from 'crawlee';

/**
 * The five savable kinds: the four extracted output formats plus the raw
 * `original` page HTML. Structurally equal to `ContentKind` in `storage.ts`,
 * but defined here so the route helpers stay free of a circular import.
 */
export { SaveFormat };

export const SAVE_FORMATS = [
  SaveFormat.Txt,
  SaveFormat.Markdown,
  SaveFormat.Html,
  SaveFormat.MinifiedHtml,
  SaveFormat.Original,
] as const;

/** Whether one format targets the key-value store, the dataset, or both. */
export interface FormatRoute {
  toKvs: boolean;
  toDataset: boolean;
}

/** Per-format destination lookup derived from the `save` token array. */
export type RouteMap = Record<SaveFormat, FormatRoute>;

function isSaveFormat(value: string): value is SaveFormat {
  return (SAVE_FORMATS as readonly string[]).includes(value);
}

/**
 * Parse the `save` token array (`format-destination`, e.g. `markdown-dataset`,
 * `original-kvs`) into a per-format destination map. A format listed against both
 * destinations (`markdown-dataset markdown-kvs`) yields `{ toKvs: true, toDataset:
 * true }`. Throws on an unknown token. Pure — no I/O.
 */
export function buildRouteMap(tokens: readonly string[]): RouteMap {
  const map: RouteMap = {
    txt: { toKvs: false, toDataset: false },
    markdown: { toKvs: false, toDataset: false },
    html: { toKvs: false, toDataset: false },
    'minified-html': { toKvs: false, toDataset: false },
    original: { toKvs: false, toDataset: false },
  };
  for (const token of tokens) {
    // Split on the final hyphen so hyphenated format names remain intact.
    const idx = token.lastIndexOf('-');
    const fmt = idx === -1 ? token : token.slice(0, idx);
    const dest = idx === -1 ? '' : token.slice(idx + 1);
    if (!isSaveFormat(fmt) || (dest !== 'kvs' && dest !== 'dataset')) {
      throw new Error(
        `Invalid save token: '${token}'. Expected <format>-<destination> where format is one ` +
          `of ${SAVE_FORMATS.join(', ')} and destination is dataset or kvs.`,
      );
    }
    if (dest === 'kvs') map[fmt].toKvs = true;
    else map[fmt].toDataset = true;
  }
  return map;
}

/**
 * The extracted formats to run for a route map — every format with at least one
 * destination, excluding `original` (raw HTML, not an extraction). May be empty
 * (e.g. `save: ['original-kvs']`), which the extraction engine accepts.
 */
export function extractedFormats(map: RouteMap): OutputFormat[] {
  const out: OutputFormat[] = [];
  for (const fmt of ['txt', 'markdown', 'html', 'minified-html'] as const) {
    if (map[fmt].toKvs || map[fmt].toDataset) out.push(fmt);
  }
  return out;
}

/** Whether any `original-*` token is present (the raw HTML should be saved). */
export function savesOriginal(map: RouteMap): boolean {
  return map.original.toKvs || map.original.toDataset;
}

/**
 * Emit a single warning when large HTML content is routed to
 * the dataset, where it is inlined into each record and can cause out-of-memory
 * on large pages. Call once at sink construction (per run), not per page.
 */
export function warnDangerousRoutes(map: RouteMap): void {
  const danger = (['original', 'html', 'minified-html'] as const).filter(
    (format) => map[format].toDataset,
  );
  if (danger.length === 0) return;
  const kvsSuggestion = danger.map((f) => `${f}-kvs`).join(', ');
  log.warning(
    `Saving ${danger.join(' and ')} to the dataset can cause out-of-memory on large pages. ` +
      `Prefer the key-value store (${kvsSuggestion}) for large content.`,
  );
}
