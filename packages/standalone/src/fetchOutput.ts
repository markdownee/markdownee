import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileSuffixForKind, SAVE_FORMATS, type SaveFormat } from '@markdownee/crawler';
import { slugForUrl } from './exportAction.js';

/** A single `fetch` save token binding one format to file or stdout. */
export type FetchRoute = `${SaveFormat}-${'file' | 'stdout'}`;

/**
 * The `--save` vocabulary for `fetch`: the canonical `SAVE_FORMATS`
 * crossed with the CLI-local `file`/`stdout` destinations. Derived so a new
 * format flows into `fetch` automatically. This union never enters the
 * shared schema or the Apify Actor — the storage destinations live in the
 * schema's `SAVE_ROUTE_TOKENS`.
 */
export const FETCH_TOKENS: readonly FetchRoute[] = SAVE_FORMATS.flatMap(
  (format) => [`${format}-file`, `${format}-stdout`] as const,
);

/** The route used when `fetch` is invoked without `--save`. */
export const DEFAULT_FETCH_SAVE: FetchRoute = 'markdown-stdout';

/** The routing plan derived from validated `fetch` save tokens. */
export interface FetchPlan {
  /** Unique formats across all tokens, in first-seen order. */
  formats: SaveFormat[];
  /** Formats routed to `-file` tokens, in first-seen order. */
  fileFormats: SaveFormat[];
  /** The single format routed to stdout, if any. */
  stdoutFormat?: SaveFormat;
}

/**
 * Split validated `fetch` tokens into a routing plan. Throws when more
 * than one `-stdout` token is present — the single stdout stream carries one
 * format only (raw content, never a JSON wrapper); route the rest to `-file`.
 */
export function planFetchRoutes(tokens: readonly FetchRoute[]): FetchPlan {
  const formats: SaveFormat[] = [];
  const fileFormats: SaveFormat[] = [];
  const stdoutFormats: SaveFormat[] = [];
  for (const token of tokens) {
    const idx = token.lastIndexOf('-');
    const format = token.slice(0, idx) as SaveFormat;
    const destination = token.slice(idx + 1);
    if (!formats.includes(format)) formats.push(format);
    if (destination === 'file') {
      if (!fileFormats.includes(format)) fileFormats.push(format);
    } else if (!stdoutFormats.includes(format)) {
      stdoutFormats.push(format);
    }
  }
  if (stdoutFormats.length > 1) {
    throw new Error(
      `--save routes ${stdoutFormats.length} formats to stdout ` +
        `(${stdoutFormats.map((f) => `${f}-stdout`).join(', ')}); stdout carries one ` +
        'format only — route the others to -file tokens.',
    );
  }
  return { formats, fileFormats, stdoutFormat: stdoutFormats[0] };
}

/**
 * Complete suffixes recognized on a multi-format `--output`. Longest comes
 * first so `.min.html` is never mistaken for `.html`.
 */
const STRIP_SUFFIXES = [...new Set(SAVE_FORMATS.map(fileSuffixForKind))].sort(
  (left, right) => right.length - left.length,
);

/**
 * Per-format file suffix. Original uses the clean `.html` suffix only when no
 * generated HTML sibling needs disambiguation.
 */
function suffixFor(format: SaveFormat, fileFormats: readonly SaveFormat[]): string {
  if (
    format === 'original' &&
    !fileFormats.includes('html') &&
    !fileFormats.includes('minified-html')
  ) {
    return '.html';
  }
  return fileSuffixForKind(format);
}

/** One resolved file write: which format goes to which path. */
export interface FileTarget {
  format: SaveFormat;
  filePath: string;
}

/** Resolve the sibling `<stem>.assets/` directory for one-page file outputs. */
export function resolveAssetsDirectory(fileTargets: readonly FileTarget[]): string {
  const first = fileTargets[0];
  if (first === undefined) {
    throw new Error('Image saving requires at least one file output.');
  }
  const parent = path.dirname(first.filePath);
  if (fileTargets.some((target) => path.dirname(target.filePath) !== parent)) {
    throw new Error('All fetch file outputs must share one directory.');
  }
  const filename = path.basename(first.filePath);
  const lowerFilename = filename.toLowerCase();
  const completeSuffix = STRIP_SUFFIXES.find((suffix) => lowerFilename.endsWith(suffix));
  const stem =
    completeSuffix === undefined
      ? filename.slice(0, filename.length - path.extname(filename).length)
      : filename.slice(0, filename.length - completeSuffix.length);
  return path.join(parent, `${stem}.assets`);
}

/**
 * Resolve the file path for each `-file` format from the `--output` value:
 *
 * - exactly one `-file` format → `--output` is a literal path; the format's
 *   extension is appended only when the value has none;
 * - two or more `-file` formats → `--output` is a base prefix; a trailing
 *   recognized complete suffix (`.md`/`.html`/`.min.html`/`.txt`) is stripped and each
 *   format appends its own extension;
 * - a directory value (trailing slash or an existing dir) → URL-slug file
 *   names inside it;
 * - absent → URL-slug file names in the cwd.
 */
export function resolveFileTargets(
  url: string,
  fileFormats: readonly SaveFormat[],
  output: string | undefined,
): FileTarget[] {
  if (fileFormats.length === 0) return [];

  const isDir =
    output !== undefined &&
    (output.endsWith('/') ||
      output.endsWith(path.sep) ||
      (existsSync(output) && statSync(output).isDirectory()));

  if (output === undefined || isDir) {
    const dir = output ?? '.';
    const base = slugForUrl(url);
    return fileFormats.map((format) => ({
      format,
      filePath: path.join(dir, `${base}${suffixFor(format, fileFormats)}`),
    }));
  }

  const [onlyFormat] = fileFormats;
  if (fileFormats.length === 1 && onlyFormat !== undefined) {
    const format = onlyFormat;
    const filePath =
      path.extname(output) === '' ? `${output}${suffixFor(format, fileFormats)}` : output;
    return [{ format, filePath }];
  }

  const lowerOutput = output.toLowerCase();
  const suffix = STRIP_SUFFIXES.find((candidate) => lowerOutput.endsWith(candidate));
  const base = suffix === undefined ? output : output.slice(0, output.length - suffix.length);
  return fileFormats.map((format) => ({
    format,
    filePath: `${base}${suffixFor(format, fileFormats)}`,
  }));
}
