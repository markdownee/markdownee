import type { StoredImageFormat } from './stored-image.js';

/**
 * Byte → stored-artifact encoding for the save image-handling mode.
 *
 * Rasters re-encode to metadata-stripped WebP via sharp (long edge capped at
 * `maxImageEdge`, never upscaled; animated inputs keep their first frame —
 * every major vision API reads only the first frame anyway). SVGs are
 * DOMPurify-sanitized FIRST (the security boundary), then SVGO-optimized, then
 * either rasterized to PNG (`rasterizeSvg`, default) or stored as the sanitized
 * source — exactly ONE artifact per SVG, never both.
 *
 * sharp / isomorphic-dompurify / svgo load lazily so runs outside save mode
 * never pay their startup cost.
 */

/** Images whose downloaded bytes exceed this are skipped (kept as URL references). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Images smaller than this on BOTH edges are dropped entirely (tracking pixels, icon noise). */
const MIN_IMAGE_EDGE = 64;

/**
 * Rasterized SVGs target a long edge of `min(maxImageEdge, 1568)` (1568 is the
 * vision-model downscale ceiling — storing more is wasted bytes), without ever
 * upscaling a smaller intrinsic size.
 */
const SVG_RASTER_LONG_EDGE_CAP = 1568;

/** Explicit sharp decode bomb guard (sharp's own default, passed explicitly). */
const SHARP_LIMIT_INPUT_PIXELS = 0x3fff * 0x3fff;

const WEBP_QUALITY = 80;

/** SVG rasterization density baseline: sharp renders SVG at 72 DPI = 1 px per intrinsic px. */
const SVG_BASE_DENSITY = 72;

export type EncodedImage =
  /** Store this artifact under `images-{md5(sourceUrl)}.{ext}`. */
  | {
      kind: 'stored';
      data: Buffer | string;
      ext: StoredImageFormat;
      contentType: string;
      format: StoredImageFormat;
      width?: number;
      height?: number;
    }
  /** Remove the `<img>` from the output entirely (tracking pixel / sub-64px noise). */
  | { kind: 'dropped'; reason: string }
  /** Leave the `<img>`'s resolved URL in place (too large, undecodable, unsafe SVG). */
  | { kind: 'skipped'; reason: string };

type SharpModule = typeof import('sharp');

let sharpPromise: Promise<SharpModule['default']> | undefined;
async function loadSharp(): Promise<SharpModule['default']> {
  sharpPromise ??= import('sharp').then((m) => m.default);
  return sharpPromise;
}

let dompurifyPromise: Promise<typeof import('isomorphic-dompurify')['default']> | undefined;
async function loadDompurify(): Promise<typeof import('isomorphic-dompurify')['default']> {
  dompurifyPromise ??= import('isomorphic-dompurify').then((m) => m.default);
  return dompurifyPromise;
}

let svgoPromise: Promise<typeof import('svgo')['optimize']> | undefined;
async function loadSvgoOptimize(): Promise<typeof import('svgo')['optimize']> {
  svgoPromise ??= import('svgo').then((m) => m.optimize);
  return svgoPromise;
}

/** Whether the downloaded bytes are an SVG document (content type or source sniff). */
function isSvgImage(body: Buffer, contentType: string | undefined): boolean {
  if (contentType?.toLowerCase().includes('svg') === true) return true;
  const head = body.subarray(0, 1024).toString('utf8');
  return /<svg[\s>]/i.test(head);
}

const MAGIC_SNIFFS: ReadonlyArray<{ ext: string; mime: string; match: (b: Buffer) => boolean }> = [
  { ext: 'png', mime: 'image/png', match: (b) => b.subarray(0, 4).equals(PNG_MAGIC) },
  { ext: 'jpg', mime: 'image/jpeg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', match: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  {
    ext: 'webp',
    mime: 'image/webp',
    match: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  {
    ext: 'avif',
    mime: 'image/avif',
    match: (b) => b.subarray(4, 12).toString('latin1') === 'ftypavif',
  },
  { ext: 'bmp', mime: 'image/bmp', match: (b) => b.subarray(0, 2).toString('latin1') === 'BM' },
  {
    ext: 'tiff',
    mime: 'image/tiff',
    match: (b) =>
      (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a),
  },
  {
    ext: 'ico',
    mime: 'image/x-icon',
    match: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0,
  },
];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const CONTENT_TYPE_EXTS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/svg+xml': 'svg',
};

/**
 * Extension + content type for the pre-normalization (original) bytes: magic
 * bytes first (more reliable than headers), then the reported content type,
 * then a `bin` / octet-stream fallback — never extensionless.
 */
export function sniffOriginalFormat(
  body: Buffer,
  contentType: string | undefined,
): { ext: string; contentType: string } {
  if (isSvgImage(body, contentType)) return { ext: 'svg', contentType: 'image/svg+xml' };
  for (const sniff of MAGIC_SNIFFS) {
    if (body.length >= 12 && sniff.match(body)) return { ext: sniff.ext, contentType: sniff.mime };
  }
  const declared = contentType?.split(';')[0]?.trim().toLowerCase();
  const ext = declared !== undefined ? CONTENT_TYPE_EXTS[declared] : undefined;
  if (declared !== undefined && ext !== undefined) return { ext, contentType: declared };
  return { ext: 'bin', contentType: 'application/octet-stream' };
}

export interface EncodeImageOptions {
  /** Long-edge pixel cap for stored rasters; `0` = uncapped. Never upscales. */
  maxImageEdge: number;
  /** `true` (default): store SVGs rasterized to PNG; `false`: store the sanitized SVG source. */
  rasterizeSvg: boolean;
}

/** Normalize one downloaded image into its stored artifact (or a drop/skip verdict). */
export async function encodeImage(
  body: Buffer,
  contentType: string | undefined,
  opts: EncodeImageOptions,
): Promise<EncodedImage> {
  if (body.byteLength > MAX_IMAGE_BYTES) {
    return { kind: 'skipped', reason: `${body.byteLength} bytes exceeds the 10MB cap` };
  }
  if (isSvgImage(body, contentType)) return encodeSvg(body, opts);
  return encodeRaster(body, opts);
}

async function encodeRaster(body: Buffer, opts: EncodeImageOptions): Promise<EncodedImage> {
  const sharp = await loadSharp();
  try {
    // No `animated: true`: sharp reads the first frame of animated inputs,
    // which is what vision APIs consume.
    const image = sharp(body, { limitInputPixels: SHARP_LIMIT_INPUT_PIXELS });
    const meta = await image.metadata();
    if (meta.width < MIN_IMAGE_EDGE && meta.height < MIN_IMAGE_EDGE) {
      return {
        kind: 'dropped',
        reason: `${meta.width}x${meta.height} is below ${MIN_IMAGE_EDGE}px on both edges`,
      };
    }
    const pipeline =
      opts.maxImageEdge > 0
        ? image.resize({
            width: opts.maxImageEdge,
            height: opts.maxImageEdge,
            fit: 'inside',
            withoutEnlargement: true,
          })
        : image;
    // sharp carries no input metadata into the output unless `keepMetadata()` or
    // `withMetadata()` asks it to, so this plain `.webp()` is what makes the
    // stored raster metadata-stripped as `SPEC.md` promises. Downloaded images
    // are untrusted, and their EXIF routinely carries GPS coordinates and device
    // identity, so neither call may ever be added here.
    const { data, info } = await pipeline
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      kind: 'stored',
      data,
      ext: 'webp',
      contentType: 'image/webp',
      format: 'webp',
      width: info.width,
      height: info.height,
    };
  } catch (err) {
    return { kind: 'skipped', reason: `decode failed: ${errorMessage(err)}` };
  }
}

async function encodeSvg(body: Buffer, opts: EncodeImageOptions): Promise<EncodedImage> {
  const source = body.toString('utf8');
  // XXE / entity-expansion guard: reject DTD and entity declarations outright
  // (DOMPurify sanitizes the DOM tree, not the XML parser's entity handling).
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    return { kind: 'skipped', reason: 'SVG carries DOCTYPE/ENTITY declarations (XXE guard)' };
  }

  // Sanitize FIRST (the trust boundary), then optimize the safe markup.
  const dompurify = await loadDompurify();
  const sanitized = dompurify.sanitize(source, { USE_PROFILES: { svg: true, svgFilters: true } });
  if (!/<svg[\s>]/i.test(sanitized)) {
    return { kind: 'skipped', reason: 'nothing survived SVG sanitization' };
  }

  let optimized = sanitized;
  try {
    const optimize = await loadSvgoOptimize();
    // SVGO v4 preset-default keeps viewBox (removeViewBox left the preset in v4).
    optimized = optimize(sanitized, { multipass: true, plugins: ['preset-default'] }).data;
  } catch {
    // Optimization is best-effort; the sanitized source is already safe.
  }

  const sharp = await loadSharp();
  let intrinsicWidth: number | undefined;
  let intrinsicHeight: number | undefined;
  try {
    const meta = await sharp(Buffer.from(optimized), {
      limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
    }).metadata();
    intrinsicWidth = meta.width;
    intrinsicHeight = meta.height;
  } catch {
    // Intrinsic size stays unknown; rasterization below may still fail cleanly.
  }

  if (
    intrinsicWidth !== undefined &&
    intrinsicHeight !== undefined &&
    intrinsicWidth < MIN_IMAGE_EDGE &&
    intrinsicHeight < MIN_IMAGE_EDGE
  ) {
    return {
      kind: 'dropped',
      reason: `${intrinsicWidth}x${intrinsicHeight} is below ${MIN_IMAGE_EDGE}px on both edges`,
    };
  }

  if (!opts.rasterizeSvg) {
    return {
      kind: 'stored',
      data: optimized,
      ext: 'svg',
      contentType: 'image/svg+xml',
      format: 'svg',
      ...(intrinsicWidth !== undefined ? { width: intrinsicWidth } : {}),
      ...(intrinsicHeight !== undefined ? { height: intrinsicHeight } : {}),
    };
  }

  // Rasterize to PNG at a density targeting long edge ≈ min(maxImageEdge, 1568),
  // never above the intrinsic size (72 DPI renders 1 px per intrinsic px).
  const target =
    opts.maxImageEdge > 0
      ? Math.min(opts.maxImageEdge, SVG_RASTER_LONG_EDGE_CAP)
      : SVG_RASTER_LONG_EDGE_CAP;
  const intrinsicLongEdge = Math.max(intrinsicWidth ?? 0, intrinsicHeight ?? 0);
  const density =
    intrinsicLongEdge > 0
      ? Math.min(SVG_BASE_DENSITY, (SVG_BASE_DENSITY * target) / intrinsicLongEdge)
      : SVG_BASE_DENSITY;
  try {
    const { data, info } = await sharp(Buffer.from(optimized), {
      density,
      limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
    })
      .resize({ width: target, height: target, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return {
      kind: 'stored',
      data,
      ext: 'png',
      contentType: 'image/png',
      format: 'png',
      width: info.width,
      height: info.height,
    };
  } catch (err) {
    return { kind: 'skipped', reason: `SVG rasterization failed: ${errorMessage(err)}` };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
