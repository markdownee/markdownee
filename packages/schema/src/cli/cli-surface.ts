import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  canonicalizeJsonSchema,
  schemaId,
  TO_JSON_SCHEMA_INPUT,
} from '../canonical-json-schema.js';
import { MarkdowneeInput } from '../source-of-truth/input.js';
import { OrdinaryProxyConfiguration } from '../source-of-truth/ordinary-proxy-configuration.js';

/**
 * The single definition site for the Markdownee CLI's flag surface — the
 * field↔flag↔kind↔subcommand mapping plus the help text. This is NOT a second
 * Zod schema: the running binary validates with the shared `MarkdowneeInput`
 * (Commander owns the flag grammar, Zod owns the contract). This module owns
 * only the metadata-about-the-flags:
 *
 * - `cliProgram.ts` looks up each option's help string here via
 *   `cliOptionDescription(id)` (so `--help` text has one source, not scattered
 *   literals);
 * - the README `cli-flags` region renders from Commander, which now carries
 *   these descriptions;
 * - `cli-surface.json` serializes this map for external consumers (e.g. the
 *   playground), and `cli-input.schema.json` is the config-file JSON Schema.
 *
 * Encodes the deliberate CLI renames (`respectRobotsTxtFile`→`--respect-robots-txt`,
 * `maxRequestRetries`→`--max-retries`, `languageCode`→`--language`,
 * `navigationTimeoutSecs`→`--navigation-timeout`, and the greenfield bool→enum
 * replacements `includeImages`→`--image-handling`, `includeLinks`→`--link-handling`,
 * `includeTables`→`--table-handling`, `includeComments`→`--comment-handling`,
 * …), the `--flag`/`--no-flag` boolean pairs, the enum value flags, the
 * repeatable flags, and the CLI-only / orchestrator flags. When a CLI flag is
 * added, renamed, or removed, update THIS table (and its test) in the same change.
 */

type CliSubcommand = 'crawl' | 'fetch' | 'export' | 'purge';

type CliOptionKind =
  | 'scalar' // --flag <value>
  | 'enum' // --flag <value>, value restricted to the option's `values` choices
  | 'switch' // --flag (bare boolean, no negation)
  | 'negation' // --no-flag (negates a default-true boolean)
  | 'boolean-on' // --flag, the positive half of a --flag/--no-flag pair
  | 'repeatable' // --flag <value>, repeatable
  | 'json'; // --flag <json>, value parsed as JSON

export interface CliSurfaceOption {
  /** Stable, unique id `cliProgram.ts` uses to look up the description. */
  id: string;
  /** The long flag, e.g. `--respect-robots-txt`. */
  flag: string;
  /** Short alias, e.g. `-c`, when one exists. */
  short?: string;
  /** The `MarkdowneeInput` field this maps to, or null for CLI-only flags. */
  field: string | null;
  kind: CliOptionKind;
  /**
   * The ordered value choices of an `enum`-kind flag — Commander registers them
   * via `.choices(values)`, so `--help` and this artifact carry the same list.
   * Present exactly when `kind` is `'enum'`.
   */
  values?: readonly string[];
  /** Help text — the single source for `--help` and the README flags table. */
  description: string;
  /**
   * The default value exactly as `--help` renders it after `default: ` — the
   * custom label where `cliProgram.ts` passes one (`unlimited`), otherwise the
   * JSON-rendered value (`true`, `3`, `[]`, `"balanced"`, `["markdown-kvs"]`).
   * Present only when Commander shows a machine default for the flag; absent
   * for flags whose `--help` line shows none, or whose default is baked into the
   * description text (e.g. `--block-media`, `--storage`). The README `cli-flags`
   * table appends ` (default: <defaultLabel>)` from this. When a flag's default
   * (or its display label) changes in `cliProgram.ts`, update this in lockstep.
   */
  defaultLabel?: string;
  /** Subcommands this flag is registered on. */
  subcommands: CliSubcommand[];
}

const STORAGE_FLAG_HELP =
  'Storage directory holding the datasets/key_value_stores/request_queues ' +
  '(default: ./storage or the XDG data dir)';

const SINGLE_PAGE: CliSurfaceOption[] = [
  {
    id: 'headless',
    flag: '--headless',
    field: 'headless',
    kind: 'boolean-on',
    description: 'Run browser in headless mode',
    defaultLabel: 'true',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'no-headless',
    flag: '--no-headless',
    field: 'headless',
    kind: 'negation',
    description: 'Run browser with UI',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'proxy',
    flag: '--proxy',
    field: null,
    kind: 'repeatable',
    description: 'Proxy URL (repeatable)',
    defaultLabel: '[]',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'proxy-rotation',
    flag: '--proxy-rotation',
    field: 'proxyRotation',
    kind: 'scalar',
    description: 'Proxy rotation: recommended, per-request, until-failure',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'max-session-rotations',
    flag: '--max-session-rotations',
    field: 'maxSessionRotations',
    kind: 'scalar',
    description: 'Max session rotations per request on block detection',
    defaultLabel: '10',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'crawler-type',
    flag: '--crawler-type',
    field: 'crawlerType',
    kind: 'scalar',
    description: 'Crawler engine: adaptive, firefox, chromium, cheerio',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'rendering-type-detection',
    flag: '--rendering-type-detection',
    field: 'renderingTypeDetectionRatio',
    kind: 'scalar',
    description: 'Rendering type detection ratio 0–1 (adaptive only)',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'markdown-discovery',
    flag: '--markdown-discovery',
    field: 'markdownDiscovery',
    kind: 'enum',
    values: ['off', 'alternate', 'negotiate', 'probe'],
    description:
      'Choose the content source for all formats: off uses HTML; alternate follows advertised ' +
      'same-origin Markdown links; negotiate also requests text/markdown through Accept; ' +
      'probe also tries a .md sibling. Available steps depend on the crawler path and add requests',
    defaultLabel: '"off"',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'wait-until',
    flag: '--wait-until',
    field: 'waitUntil',
    kind: 'scalar',
    description: 'Page load event: load, domcontentloaded, networkidle, commit',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'navigation-timeout',
    flag: '--navigation-timeout',
    field: 'navigationTimeoutSecs',
    kind: 'scalar',
    description: 'Navigation timeout in seconds',
    defaultLabel: '60',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'block-media',
    flag: '--block-media',
    field: 'blockMedia',
    kind: 'boolean-on',
    description:
      'Enable Chromium request blocking for images, stylesheets, fonts, PDFs, and ZIPs (default)',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'no-block-media',
    flag: '--no-block-media',
    field: 'blockMedia',
    kind: 'negation',
    description: 'Do not block media requests',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'ignore-cors-and-csp',
    flag: '--ignore-cors-and-csp',
    field: 'ignoreCorsAndCsp',
    kind: 'switch',
    description: 'Disable CORS/CSP restrictions',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'close-cookie-modals',
    flag: '--close-cookie-modals',
    field: 'closeCookieModals',
    kind: 'boolean-on',
    description: 'Auto-dismiss cookie banners',
    defaultLabel: 'true',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'no-close-cookie-modals',
    flag: '--no-close-cookie-modals',
    field: 'closeCookieModals',
    kind: 'negation',
    description: 'Do not auto-dismiss cookie banners',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'max-scroll-height',
    flag: '--max-scroll-height',
    field: 'maxScrollHeight',
    kind: 'scalar',
    description: 'Max scroll height in pixels',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'ignore-https-errors',
    flag: '--ignore-https-errors',
    field: 'ignoreHttpsErrors',
    kind: 'switch',
    description: 'Skip HTTPS certificate verification',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'user-agent',
    flag: '--user-agent',
    field: 'userAgent',
    kind: 'scalar',
    description: 'Custom User-Agent string',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'respect-robots-txt',
    flag: '--respect-robots-txt',
    field: 'respectRobotsTxtFile',
    kind: 'switch',
    description: 'Honor robots.txt',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'cookies',
    flag: '--cookies',
    field: 'initialCookies',
    kind: 'json',
    description: 'JSON array of cookie objects',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'headers',
    flag: '--headers',
    field: 'customHttpHeaders',
    kind: 'json',
    description: 'JSON object of custom HTTP headers',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'max-retries',
    flag: '--max-retries',
    field: 'maxRequestRetries',
    kind: 'scalar',
    description: 'Max request retries',
    defaultLabel: '3',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'mode',
    flag: '--mode',
    field: 'mode',
    kind: 'enum',
    values: ['precision', 'balanced', 'recall', 'keep'],
    description:
      'Extraction mode: precision (less noise), balanced (default), recall (more content), or keep (no boilerplate removal, clean HTML only)',
    defaultLabel: '"balanced"',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'image-handling',
    flag: '--image-handling',
    field: 'imageHandling',
    kind: 'enum',
    values: ['exclude', 'alt-text', 'resolved-url', 'save'],
    description:
      'Image handling: exclude (default, remove images), alt-text (textual stand-in, no URL), ' +
      'resolved-url (keep images with resolved absolute URLs), or the save MODE (multi-page: ' +
      'download bytes to the key-value store; fetch: write a sibling .assets directory ' +
      'for file-only Markdown/HTML outputs — distinct from --save routing tokens)',
    defaultLabel: '"exclude"',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'max-image-edge',
    flag: '--max-image-edge',
    field: 'maxImageEdge',
    kind: 'scalar',
    description:
      'Long-edge pixel cap for images stored by the save image-handling mode ' +
      '(never upscales; 0 = uncapped; ignored outside save mode)',
    defaultLabel: '1568',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'rasterize-svg',
    flag: '--rasterize-svg',
    field: 'rasterizeSvg',
    kind: 'boolean-on',
    description:
      'Store SVG images rasterized to PNG in the save image-handling mode (default; ignored outside save mode)',
    defaultLabel: 'true',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'no-rasterize-svg',
    flag: '--no-rasterize-svg',
    field: 'rasterizeSvg',
    kind: 'negation',
    description: 'Store the sanitized SVG source instead of a rasterized PNG in save mode',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'link-handling',
    flag: '--link-handling',
    field: 'linkHandling',
    kind: 'enum',
    values: ['include', 'exclude'],
    description:
      'Link handling: include (default, inline links) or exclude (keep anchor text, drop URL)',
    defaultLabel: '"include"',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'table-handling',
    flag: '--table-handling',
    field: 'tableHandling',
    kind: 'enum',
    values: ['include', 'exclude'],
    description:
      'Table handling: include (default) or exclude (drop table subtrees including cell text)',
    defaultLabel: '"include"',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'comment-handling',
    flag: '--comment-handling',
    field: 'commentHandling',
    kind: 'enum',
    values: ['include', 'exclude'],
    description:
      'User-comment section handling (forum/blog comments, not <!-- --> markup): include (default) ' +
      'or exclude detected comment containers',
    defaultLabel: '"include"',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'language',
    flag: '--language',
    field: 'languageCode',
    kind: 'scalar',
    description: 'Filter by language (e.g. en)',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'output-layout',
    flag: '--output-layout',
    field: 'outputLayout',
    kind: 'enum',
    values: ['minimal', 'standard', 'enhanced'],
    description: 'Generated output layout: minimal (default), standard, or enhanced',
    defaultLabel: '"minimal"',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'verbose',
    flag: '--verbose',
    short: '-v',
    field: null,
    kind: 'switch',
    description: 'Enable verbose logging',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'wait-for-dynamic-content',
    flag: '--wait-for-dynamic-content',
    field: 'waitForDynamicContentSecs',
    kind: 'scalar',
    description:
      'Maximum seconds to wait for dynamic content after navigation; the crawler continues as soon as the network is idle or this timeout elapses, whichever comes first (0 = disabled)',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'wait-for-selector',
    flag: '--wait-for-selector',
    field: 'waitForSelector',
    kind: 'scalar',
    description: 'CSS selector to wait for before extracting (fails on timeout)',
    subcommands: ['crawl', 'fetch'],
  },
  {
    id: 'soft-wait-for-selector',
    flag: '--soft-wait-for-selector',
    field: 'softWaitForSelector',
    kind: 'scalar',
    description: 'CSS selector to wait for before extracting (continues on timeout)',
    subcommands: ['crawl', 'fetch'],
  },
];

const CRAWL: CliSurfaceOption[] = [
  {
    id: 'config-file',
    flag: '--config-file',
    short: '-c',
    field: null,
    kind: 'scalar',
    description: 'Path to JSON config file',
    subcommands: ['crawl'],
  },
  {
    id: 'purge',
    flag: '--purge',
    field: null,
    kind: 'switch',
    description: 'Purge the storage at --storage before extracting (datasets, KVS, request queues)',
    subcommands: ['crawl'],
  },
  {
    id: 'max-requests-per-crawl',
    flag: '--max-requests-per-crawl',
    field: 'maxRequestsPerCrawl',
    kind: 'scalar',
    description: 'Max requests to handle (0 = unlimited)',
    defaultLabel: 'unlimited',
    subcommands: ['crawl'],
  },
  {
    id: 'max-crawl-depth',
    flag: '--max-crawl-depth',
    field: 'maxCrawlDepth',
    kind: 'scalar',
    description: 'Max link depth from start URLs (0 = unlimited)',
    defaultLabel: 'unlimited',
    subcommands: ['crawl'],
  },
  {
    id: 'globs',
    flag: '--globs',
    field: 'globs',
    kind: 'repeatable',
    description: 'Glob pattern to include (repeatable)',
    defaultLabel: '[]',
    subcommands: ['crawl'],
  },
  {
    id: 'exclude',
    flag: '--exclude',
    field: 'exclude',
    kind: 'repeatable',
    description: 'Glob pattern to exclude (repeatable)',
    defaultLabel: '[]',
    subcommands: ['crawl'],
  },
  {
    id: 'selector',
    flag: '--selector',
    field: 'selector',
    kind: 'scalar',
    description: 'CSS selector for links to follow',
    subcommands: ['crawl'],
  },
  {
    id: 'keep-url-fragment',
    flag: '--keep-url-fragment',
    field: 'keepUrlFragment',
    kind: 'switch',
    description: 'Preserve URL fragments',
    subcommands: ['crawl'],
  },
  {
    id: 'use-sitemaps',
    flag: '--use-sitemaps',
    field: 'useSitemaps',
    kind: 'switch',
    description: 'Discover and enqueue URLs from sitemap.xml at each start URL domain root',
    subcommands: ['crawl'],
  },
  {
    id: 'initial-concurrency',
    flag: '--initial-concurrency',
    field: 'initialConcurrency',
    kind: 'scalar',
    description: 'Initial parallel requests (0 = Crawlee default)',
    subcommands: ['crawl'],
  },
  {
    id: 'max-concurrency',
    flag: '--max-concurrency',
    field: 'maxConcurrency',
    kind: 'scalar',
    description: 'Max parallel requests',
    defaultLabel: '3',
    subcommands: ['crawl'],
  },
  {
    id: 'max-results',
    flag: '--max-results',
    field: 'maxResultsPerCrawl',
    kind: 'scalar',
    description: 'Max results per crawl (0 = unlimited)',
    defaultLabel: 'unlimited',
    subcommands: ['crawl'],
  },
  {
    id: 'save',
    flag: '--save',
    field: 'save',
    kind: 'repeatable',
    description:
      'Format-destination token, e.g. markdown-kvs, original-dataset (repeatable). ' +
      'Format: txt|markdown|html|minified-html|original; destination: dataset|kvs. ' +
      'List a format twice to save to both. Saving HTML content to the dataset risks OOM on large pages.',
    defaultLabel: '["markdown-kvs"]',
    subcommands: ['crawl'],
  },
  {
    id: 'deduplication',
    flag: '--deduplication',
    field: 'deduplication',
    kind: 'enum',
    values: ['minimal', 'standard', 'aggressive'],
    description: 'Deduplication level: minimal, standard (default), or aggressive',
    subcommands: ['crawl'],
  },
  {
    id: 'session-pool-name',
    flag: '--session-pool-name',
    field: 'sessionPoolName',
    kind: 'scalar',
    description: 'Named session pool for cross-run session sharing',
    subcommands: ['crawl'],
  },
  {
    id: 'storage',
    flag: '--storage',
    field: null,
    kind: 'scalar',
    description: STORAGE_FLAG_HELP,
    subcommands: ['crawl', 'export', 'purge'],
  },
  {
    id: 'store-skipped-urls',
    flag: '--store-skipped-urls',
    field: 'storeSkippedUrls',
    kind: 'switch',
    description: 'Push skipped URL records to the dataset after crawl',
    subcommands: ['crawl'],
  },
];

const EXTRACT_ONLY: CliSurfaceOption[] = [
  {
    id: 'start-urls-file',
    flag: '--start-urls-file',
    field: null,
    kind: 'scalar',
    description: 'Read start URLs (one per line) from a file',
    subcommands: ['crawl'],
  },
];

const FETCH_ONLY: CliSurfaceOption[] = [
  {
    id: 'save-one',
    flag: '--save',
    field: null,
    kind: 'repeatable',
    description:
      'Format-destination token, e.g. markdown-stdout, html-file (repeatable). ' +
      'Format: txt|markdown|html|minified-html|original; destination: file|stdout. ' +
      'At most one format may target stdout.',
    subcommands: ['fetch'],
  },
  {
    id: 'output',
    flag: '--output',
    short: '-o',
    field: null,
    kind: 'scalar',
    description:
      'File path for -file tokens: a literal path for one format, a base prefix for several, ' +
      'or a directory (trailing slash or an existing dir) for URL-slug names',
    subcommands: ['fetch'],
  },
];

const ORCHESTRATOR: CliSurfaceOption[] = [
  {
    id: 'output-dir',
    flag: '--output-dir',
    field: null,
    kind: 'scalar',
    description: 'Output directory (default: ./markdownee-output)',
    subcommands: ['export'],
  },
];

/** The authoritative, ordered CLI option surface (registration order). */
export const cliSurface: readonly CliSurfaceOption[] = [
  ...EXTRACT_ONLY,
  ...SINGLE_PAGE,
  ...CRAWL,
  ...FETCH_ONLY,
  ...ORCHESTRATOR,
];

const DESCRIPTION_BY_ID = new Map(cliSurface.map((o) => [o.id, o.description]));

/** Look up an option's help text by its surface id. Throws on an unknown id. */
export function cliOptionDescription(id: string): string {
  const description = DESCRIPTION_BY_ID.get(id);
  if (description === undefined) {
    throw new Error(`cliOptionDescription: no CLI surface option with id "${id}"`);
  }
  return description;
}

/** The serializable field↔flag↔kind↔subcommand map written to `cli-surface.json`. */
export function toCliSurface(): Record<string, unknown> {
  return {
    title: 'Markdownee CLI surface',
    description:
      'Generated field-to-flag mapping for the markdownee CLI. Derived from the Zod source of truth; do not edit by hand.',
    options: cliSurface,
  };
}

export function writeCliSurface(outPath: string): void {
  writeFileSync(outPath, `${JSON.stringify(toCliSurface(), null, 2)}\n`, 'utf8');
}

export const CLI_INPUT_SCHEMA_ID = schemaId('cli-input.schema.json');

/** Runtime CLI input, sharing its projection with the published config schema. */
export const MarkdowneeCliInput = MarkdowneeInput.omit({
  datasetName: true,
  keyValueStoreName: true,
  requestQueueName: true,
}).extend({ proxyConfiguration: OrdinaryProxyConfiguration.optional() });

export type MarkdowneeCliInputType = z.infer<typeof MarkdowneeCliInput>;

/**
 * The CLI config-file JSON Schema — the nested camelCase shape users author and
 * associate via `$schema`. A partial of `MarkdowneeInput` (every field
 * optional, since args/flags can supply any of them) minus the Apify-only named
 * buckets the CLI does not surface. `$schema` is the only non-input association
 * key accepted by the strict config contract and is stripped by `loadConfigFile`.
 */
export function toCliInputSchema(): Record<string, unknown> {
  const config = MarkdowneeCliInput.partial().extend({ $schema: z.string().optional() }).strict();
  const generated = z.toJSONSchema(config, TO_JSON_SCHEMA_INPUT);
  return canonicalizeJsonSchema(generated, {
    id: CLI_INPUT_SCHEMA_ID,
    title: 'Markdownee CLI config',
  });
}

export function writeCliInputSchema(outPath: string): void {
  writeFileSync(outPath, `${JSON.stringify(toCliInputSchema(), null, 2)}\n`, 'utf8');
}
