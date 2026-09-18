/**
 * The format an image is actually stored in by the save image-handling mode:
 * `webp` for re-encoded rasters, `png` for a rasterized SVG (`rasterizeSvg`
 * on), `svg` for sanitized SVG source (`rasterizeSvg` off). The KVS key's
 * extension states this stored format, never the source's.
 */
export type StoredImageFormat = 'webp' | 'png' | 'svg';

/**
 * One image stored by the save image-handling mode — the dataset record's
 * `images[]` entry. Bytes live in the key-value store; this is the reference.
 */
export interface StoredImage {
  /** Key-value-store key of the stored artifact (`images-{md5(sourceUrl)}.{ext}`). */
  key: string;
  /** Public URL of the stored artifact, when the store exposes public URLs (the Apify platform). */
  publicUrl?: string;
  /** Resolved absolute URL the image bytes were downloaded from. */
  sourceUrl: string;
  /** Alt text carried by the `<img>` (first occurrence in the cleaned HTML), when present. */
  alt?: string;
  /** Stored pixel width (after any resize). Unknown for an un-rasterized SVG without intrinsic size. */
  width?: number;
  /** Stored pixel height (after any resize). Unknown for an un-rasterized SVG without intrinsic size. */
  height?: number;
  /** The ACTUAL stored format — also the KVS key's extension. */
  format: StoredImageFormat;
}
