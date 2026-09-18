import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFailedRecord,
  buildRequests,
  buildRouteMap,
  buildSkippedRecord,
  createMarkdowneeCrawler,
  createPendingWrites,
  ProxyConfiguration,
} from '@markdownee/crawler';
import {
  cliOptionDescription,
  MarkdowneeCliInput,
  type MarkdowneeCliInputType,
  MarkdowneeInput,
  type MarkdowneeInputType,
  SAVE_ROUTE_TOKENS,
  SaveFormatResultKey,
  type SaveRoute,
} from '@markdownee/schema';
import { Command, Option } from 'commander';
import {
  Dataset,
  KeyValueStore,
  LoggerText,
  type LogLevel,
  log,
  SitemapRequestList,
} from 'crawlee';
import {
  buildCrawlConfig,
  type CliOnlyOverrides,
  loadConfigFile,
  toCrawlerOptions,
  validateSaveTokens,
} from './config.js';
import { runExportAction } from './exportAction.js';
import {
  DEFAULT_FETCH_SAVE,
  FETCH_TOKENS,
  planFetchRoutes,
  resolveAssetsDirectory,
  resolveFileTargets,
} from './fetchOutput.js';
import { FilesystemImageSink } from './filesystem-image-sink.js';
import { type FetchRuntimeOptions, fetchWithRuntime } from './library.js';
import { purgeStorageBuckets, runPurgeAction } from './purgeAction.js';
import { createCrawleeStorageSink } from './sinks.js';
import { configureStorage, resolveStorageDir } from './storage/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toInt(value: string): number {
  const parsed = Number(value);
  if (!/^[+-]?\d+$/.test(value.trim()) || !Number.isSafeInteger(parsed)) {
    throw new Error(`Expected integer, got '${value}'`);
  }
  return parsed;
}

function toFloat(value: string): number {
  const parsed = Number(value);
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) || !Number.isFinite(parsed)) {
    throw new Error(`Expected number, got '${value}'`);
  }
  return parsed;
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseCrawlerType(value: string): MarkdowneeInputType['crawlerType'] {
  switch (value.trim().toLowerCase()) {
    case 'adaptive':
      return 'playwright-adaptive';
    case 'firefox':
      return 'playwright-firefox';
    case 'chromium':
      return 'playwright-chromium';
    case 'cheerio':
      return 'cheerio';
    default:
      throw new Error(
        `Unsupported --crawler-type value: '${value}'. Use adaptive, firefox, chromium, or cheerio.`,
      );
  }
}

function parseWaitUntil(value: string): MarkdowneeInputType['waitUntil'] {
  const result = MarkdowneeInput.shape.waitUntil.safeParse(value.trim().toLowerCase());
  if (!result.success)
    throw new Error(
      `Invalid --wait-until value: '${value}'. Use load, domcontentloaded, networkidle, or commit.`,
    );
  return result.data;
}

function parseProxyRotation(value: string): MarkdowneeInputType['proxyRotation'] {
  const result = MarkdowneeInput.shape.proxyRotation.safeParse(value.trim().toLowerCase());
  if (!result.success)
    throw new Error(
      `Invalid --proxy-rotation value: '${value}'. Use recommended, per-request, or until-failure.`,
    );
  return result.data;
}

const DEDUPLICATION_CHOICES = MarkdowneeInput.shape.deduplication.unwrap().options;

function parseDeduplication(value: string): MarkdowneeInputType['deduplication'] {
  const result = MarkdowneeInput.shape.deduplication.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid --deduplication value: '${value}'. Choose from: ${DEDUPLICATION_CHOICES.join(', ')}.`,
    );
  }
  return result.data;
}

const MODE_CHOICES = MarkdowneeInput.shape.mode.unwrap().options;

function parseMode(value: string): MarkdowneeInputType['mode'] {
  const result = MarkdowneeInput.shape.mode.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid --mode value: '${value}'. Use ${MODE_CHOICES.join(', ')}.`);
  }
  return result.data;
}

const IMAGE_HANDLING_CHOICES = MarkdowneeInput.shape.imageHandling.unwrap().options;

function parseImageHandling(value: string): MarkdowneeInputType['imageHandling'] {
  const result = MarkdowneeInput.shape.imageHandling.safeParse(value.trim().toLowerCase());
  if (!result.success) {
    throw new Error(
      `Invalid --image-handling value: '${value}'. Use ${IMAGE_HANDLING_CHOICES.join(', ')}.`,
    );
  }
  return result.data;
}

const LINK_HANDLING_CHOICES = MarkdowneeInput.shape.linkHandling.unwrap().options;

function parseLinkHandling(value: string): MarkdowneeInputType['linkHandling'] {
  const result = MarkdowneeInput.shape.linkHandling.safeParse(value.trim().toLowerCase());
  if (!result.success) {
    throw new Error(
      `Invalid --link-handling value: '${value}'. Use ${LINK_HANDLING_CHOICES.join(', ')}.`,
    );
  }
  return result.data;
}

const TABLE_HANDLING_CHOICES = MarkdowneeInput.shape.tableHandling.unwrap().options;

function parseTableHandling(value: string): MarkdowneeInputType['tableHandling'] {
  const result = MarkdowneeInput.shape.tableHandling.safeParse(value.trim().toLowerCase());
  if (!result.success) {
    throw new Error(
      `Invalid --table-handling value: '${value}'. Use ${TABLE_HANDLING_CHOICES.join(', ')}.`,
    );
  }
  return result.data;
}

const COMMENT_HANDLING_CHOICES = MarkdowneeInput.shape.commentHandling.unwrap().options;
const OUTPUT_LAYOUT_CHOICES = MarkdowneeInput.shape.outputLayout.unwrap().options;

const MARKDOWN_DISCOVERY_CHOICES = MarkdowneeInput.shape.markdownDiscovery.unwrap().options;

function parseMarkdownDiscovery(value: string): MarkdowneeInputType['markdownDiscovery'] {
  const result = MarkdowneeInput.shape.markdownDiscovery.safeParse(value.trim().toLowerCase());
  if (!result.success) {
    throw new Error(
      `Invalid --markdown-discovery value: '${value}'. Choose from: ${MARKDOWN_DISCOVERY_CHOICES.join(', ')}.`,
    );
  }
  return result.data;
}

function parseCommentHandling(value: string): MarkdowneeInputType['commentHandling'] {
  const result = MarkdowneeInput.shape.commentHandling.safeParse(value.trim().toLowerCase());
  if (!result.success) {
    throw new Error(
      `Invalid --comment-handling value: '${value}'. Use ${COMMENT_HANDLING_CHOICES.join(', ')}.`,
    );
  }
  return result.data;
}

function parseOutputLayout(value: string): MarkdowneeInputType['outputLayout'] {
  const result = MarkdowneeInput.shape.outputLayout.safeParse(value.trim().toLowerCase());
  if (!result.success) {
    throw new Error(
      `Invalid --output-layout value: '${value}'. Use ${OUTPUT_LAYOUT_CHOICES.join(', ')}.`,
    );
  }
  return result.data;
}

function parseJsonArray(raw: string, flagName: string): unknown[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${flagName} must be a JSON array`);
  return parsed;
}

function parseStringRecord(raw: string, flagName: string): Record<string, string> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${flagName} must be a JSON object`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string')
      throw new Error(`${flagName} must be a JSON object with string values`);
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared option appliers
// ---------------------------------------------------------------------------

/** Help text for the `--storage` flag, shared by `crawl`, `export`, and `purge`. */
const STORAGE_FLAG_HELP = cliOptionDescription('storage');

/**
 * Single-page options shared by `crawl` and `fetch`: the
 * extraction/rendering/network/content knobs that apply to one page. The
 * crawl-frontier and storage flags live in {@link addCrawlOptions} and apply
 * to `crawl` only.
 */
function addSinglePageOptions(cmd: Command): Command {
  const s = MarkdowneeInput.shape;
  return cmd
    .option('--headless', cliOptionDescription('headless'), s.headless.def.defaultValue)
    .option('--no-headless', cliOptionDescription('no-headless'))
    .option('--proxy <url>', cliOptionDescription('proxy'), collectValues, [])
    .option('--proxy-rotation <strategy>', cliOptionDescription('proxy-rotation'))
    .addOption(
      new Option('--max-session-rotations <n>', cliOptionDescription('max-session-rotations'))
        .argParser(toInt)
        .default(s.maxSessionRotations.def.defaultValue),
    )
    .option('--crawler-type <type>', cliOptionDescription('crawler-type'))
    .option(
      '--rendering-type-detection <ratio>',
      cliOptionDescription('rendering-type-detection'),
      toFloat,
    )
    .addOption(
      new Option('--markdown-discovery <mode>', cliOptionDescription('markdown-discovery'))
        .choices(MARKDOWN_DISCOVERY_CHOICES)
        .argParser(parseMarkdownDiscovery)
        .default(MarkdowneeInput.shape.markdownDiscovery.def.defaultValue),
    )
    .option('--wait-until <event>', cliOptionDescription('wait-until'))
    .addOption(
      new Option('--navigation-timeout <secs>', cliOptionDescription('navigation-timeout'))
        .argParser(toInt)
        .default(s.navigationTimeoutSecs.def.defaultValue),
    )
    .option('--block-media', cliOptionDescription('block-media'))
    .option('--no-block-media', cliOptionDescription('no-block-media'))
    .option('--ignore-cors-and-csp', cliOptionDescription('ignore-cors-and-csp'))
    .option(
      '--close-cookie-modals',
      cliOptionDescription('close-cookie-modals'),
      s.closeCookieModals.def.defaultValue,
    )
    .option('--no-close-cookie-modals', cliOptionDescription('no-close-cookie-modals'))
    .option('--max-scroll-height <px>', cliOptionDescription('max-scroll-height'), toInt)
    .option('--ignore-https-errors', cliOptionDescription('ignore-https-errors'))
    .option('--user-agent <ua>', cliOptionDescription('user-agent'))
    .option('--respect-robots-txt', cliOptionDescription('respect-robots-txt'))
    .option('--cookies <json>', cliOptionDescription('cookies'))
    .option('--headers <json>', cliOptionDescription('headers'))
    .addOption(
      new Option('--max-retries <n>', cliOptionDescription('max-retries'))
        .argParser(toInt)
        .default(s.maxRequestRetries.def.defaultValue),
    )
    .addOption(
      new Option('--mode <mode>', cliOptionDescription('mode'))
        .choices(MODE_CHOICES)
        .argParser(parseMode)
        .default('balanced'),
    )
    .addOption(
      new Option('--image-handling <mode>', cliOptionDescription('image-handling'))
        .choices(IMAGE_HANDLING_CHOICES)
        .argParser(parseImageHandling)
        .default(s.imageHandling.def.defaultValue),
    )
    .addOption(
      new Option('--max-image-edge <px>', cliOptionDescription('max-image-edge'))
        .argParser(toInt)
        .default(s.maxImageEdge.def.defaultValue),
    )
    .option(
      '--rasterize-svg',
      cliOptionDescription('rasterize-svg'),
      s.rasterizeSvg.def.defaultValue,
    )
    .option('--no-rasterize-svg', cliOptionDescription('no-rasterize-svg'))
    .addOption(
      new Option('--link-handling <mode>', cliOptionDescription('link-handling'))
        .choices(LINK_HANDLING_CHOICES)
        .argParser(parseLinkHandling)
        .default(s.linkHandling.def.defaultValue),
    )
    .addOption(
      new Option('--table-handling <mode>', cliOptionDescription('table-handling'))
        .choices(TABLE_HANDLING_CHOICES)
        .argParser(parseTableHandling)
        .default(s.tableHandling.def.defaultValue),
    )
    .addOption(
      new Option('--comment-handling <mode>', cliOptionDescription('comment-handling'))
        .choices(COMMENT_HANDLING_CHOICES)
        .argParser(parseCommentHandling)
        .default(s.commentHandling.def.defaultValue),
    )
    .option('--language <lang>', cliOptionDescription('language'))
    .addOption(
      new Option('--output-layout <layout>', cliOptionDescription('output-layout'))
        .choices(OUTPUT_LAYOUT_CHOICES)
        .argParser(parseOutputLayout)
        .default(s.outputLayout.def.defaultValue),
    )
    .option('-v, --verbose', cliOptionDescription('verbose'))
    .option(
      '--wait-for-dynamic-content <seconds>',
      cliOptionDescription('wait-for-dynamic-content'),
      toInt,
    )
    .option('--wait-for-selector <selector>', cliOptionDescription('wait-for-selector'))
    .option('--soft-wait-for-selector <selector>', cliOptionDescription('soft-wait-for-selector'));
}

/**
 * Crawl-frontier, concurrency, deduplication, and storage options for
 * `crawl` only — `fetch` crawls exactly one URL to a file/stdout sink
 * and never touches Crawlee storage.
 */
function addCrawlOptions(cmd: Command): Command {
  const s = MarkdowneeInput.shape;
  return (
    cmd
      .option('-c, --config-file <path>', cliOptionDescription('config-file'))
      .option('--purge', cliOptionDescription('purge'))
      .addOption(
        new Option('--max-requests-per-crawl <n>', cliOptionDescription('max-requests-per-crawl'))
          .argParser(toInt)
          .default(s.maxRequestsPerCrawl.def.defaultValue, 'unlimited'),
      )
      .addOption(
        new Option('--max-crawl-depth <n>', cliOptionDescription('max-crawl-depth'))
          .argParser(toInt)
          .default(s.maxCrawlDepth.def.defaultValue, 'unlimited'),
      )
      .option('--globs <pattern>', cliOptionDescription('globs'), collectValues, [])
      .option('--exclude <pattern>', cliOptionDescription('exclude'), collectValues, [])
      .option('--selector <css>', cliOptionDescription('selector'))
      .option('--keep-url-fragment', cliOptionDescription('keep-url-fragment'))
      .option('--use-sitemaps', cliOptionDescription('use-sitemaps'))
      .option('--initial-concurrency <n>', cliOptionDescription('initial-concurrency'), toInt)
      .addOption(
        new Option('--max-concurrency <n>', cliOptionDescription('max-concurrency'))
          .argParser(toInt)
          .default(s.maxConcurrency.def.defaultValue),
      )
      .addOption(
        new Option('--max-results <n>', cliOptionDescription('max-results'))
          .argParser(toInt)
          .default(s.maxResultsPerCrawl.def.defaultValue, 'unlimited'),
      )
      .option(
        '--save <token>',
        cliOptionDescription('save'),
        collectValues,
        s.save.def.defaultValue,
      )
      .addOption(
        new Option('--deduplication <level>', cliOptionDescription('deduplication'))
          .choices(DEDUPLICATION_CHOICES)
          .argParser(parseDeduplication),
      )
      // Cross-run session sharing needs the persisted session-pool state under
      // `--storage`; `fetch` runs non-persisting, so the flag lives here.
      .option('--session-pool-name <name>', cliOptionDescription('session-pool-name'))
      .option('--storage <path>', STORAGE_FLAG_HELP)
      .option('--store-skipped-urls', cliOptionDescription('store-skipped-urls'))
  );
}

// ---------------------------------------------------------------------------
// Schema mapping helpers
// ---------------------------------------------------------------------------

function isCliOverride(command: Command | undefined, optionName: string): boolean {
  return command?.getOptionValueSource(optionName) === 'cli';
}

function getExplicitRepeatedValues(command: Command | undefined, longFlag: string): string[] {
  const parent = command?.parent as (Command & { rawArgs?: string[] }) | undefined;
  const current = command as (Command & { rawArgs?: string[] }) | undefined;
  const rawArgs = parent?.rawArgs ?? current?.rawArgs ?? [];
  const values: string[] = [];

  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index];
    if (arg === undefined) continue;
    if (arg === longFlag) {
      const value = rawArgs[index + 1];
      if (value !== undefined) values.push(value);
      index++;
      continue;
    }
    if (arg.startsWith(`${longFlag}=`)) {
      values.push(arg.slice(longFlag.length + 1));
    }
  }

  return values;
}

/**
 * Schema overrides for the single-page flags registered by
 * {@link addSinglePageOptions}. Used directly by `fetch`, whose options
 * object never sees a crawl-frontier or storage field — this function maps
 * none of them by construction.
 */
function buildSinglePageOverrides(
  opts: SinglePageOpts,
  command?: Command,
): Partial<MarkdowneeInputType> {
  const out: Partial<MarkdowneeInputType> = {};

  if (isCliOverride(command, 'headless')) out.headless = opts.headless;
  if (isCliOverride(command, 'crawlerType') && opts.crawlerType) {
    out.crawlerType = parseCrawlerType(opts.crawlerType);
  }
  if (isCliOverride(command, 'renderingTypeDetection')) {
    out.renderingTypeDetectionRatio = opts.renderingTypeDetection;
  }
  if (isCliOverride(command, 'markdownDiscovery')) {
    out.markdownDiscovery = opts.markdownDiscovery;
  }
  if (isCliOverride(command, 'waitUntil') && opts.waitUntil) {
    out.waitUntil = parseWaitUntil(opts.waitUntil);
  }
  if (isCliOverride(command, 'proxyRotation') && opts.proxyRotation) {
    out.proxyRotation = parseProxyRotation(opts.proxyRotation);
  }
  if (isCliOverride(command, 'navigationTimeout'))
    out.navigationTimeoutSecs = opts.navigationTimeout;
  if (isCliOverride(command, 'blockMedia')) out.blockMedia = opts.blockMedia;
  if (isCliOverride(command, 'ignoreCorsAndCsp')) out.ignoreCorsAndCsp = opts.ignoreCorsAndCsp;
  if (isCliOverride(command, 'closeCookieModals')) {
    out.closeCookieModals = opts.closeCookieModals;
  }
  if (isCliOverride(command, 'maxScrollHeight')) out.maxScrollHeight = opts.maxScrollHeight;
  if (isCliOverride(command, 'ignoreHttpsErrors')) out.ignoreHttpsErrors = opts.ignoreHttpsErrors;
  if (isCliOverride(command, 'userAgent')) out.userAgent = opts.userAgent;
  if (isCliOverride(command, 'respectRobotsTxt')) {
    out.respectRobotsTxtFile = opts.respectRobotsTxt;
  }
  if (isCliOverride(command, 'cookies') && opts.cookies) {
    out.initialCookies = parseJsonArray(opts.cookies, '--cookies');
  }
  if (isCliOverride(command, 'headers') && opts.headers) {
    out.customHttpHeaders = parseStringRecord(opts.headers, '--headers');
  }
  if (isCliOverride(command, 'maxRetries')) out.maxRequestRetries = opts.maxRetries;
  if (isCliOverride(command, 'waitForDynamicContent')) {
    out.waitForDynamicContentSecs = opts.waitForDynamicContent;
  }
  if (isCliOverride(command, 'waitForSelector')) out.waitForSelector = opts.waitForSelector;
  if (isCliOverride(command, 'softWaitForSelector')) {
    out.softWaitForSelector = opts.softWaitForSelector;
  }

  if (isCliOverride(command, 'mode')) out.mode = opts.mode;
  if (isCliOverride(command, 'imageHandling')) out.imageHandling = opts.imageHandling;
  if (isCliOverride(command, 'maxImageEdge')) out.maxImageEdge = opts.maxImageEdge;
  if (isCliOverride(command, 'rasterizeSvg')) out.rasterizeSvg = opts.rasterizeSvg;
  if (isCliOverride(command, 'linkHandling')) out.linkHandling = opts.linkHandling;
  if (isCliOverride(command, 'tableHandling')) out.tableHandling = opts.tableHandling;
  if (isCliOverride(command, 'commentHandling')) out.commentHandling = opts.commentHandling;
  if (isCliOverride(command, 'language')) out.languageCode = opts.language;
  if (isCliOverride(command, 'outputLayout')) out.outputLayout = opts.outputLayout;

  if (isCliOverride(command, 'maxSessionRotations')) {
    out.maxSessionRotations = opts.maxSessionRotations;
  }

  return out;
}

/**
 * Schema overrides for the crawl-frontier, concurrency, deduplication, and
 * session-pool flags registered by {@link addCrawlOptions} — `crawl` only.
 */
function buildCrawlOverrides(opts: CrawlOpts, command?: Command): Partial<MarkdowneeInputType> {
  const out: Partial<MarkdowneeInputType> = {};

  if (isCliOverride(command, 'maxRequestsPerCrawl'))
    out.maxRequestsPerCrawl = opts.maxRequestsPerCrawl;
  if (isCliOverride(command, 'maxCrawlDepth')) out.maxCrawlDepth = opts.maxCrawlDepth;
  if (isCliOverride(command, 'globs') && opts.globs?.length) {
    out.globs = opts.globs.map((s) => ({ glob: s }));
  }
  if (isCliOverride(command, 'exclude') && opts.exclude?.length) {
    out.exclude = opts.exclude.map((s) => ({ glob: s }));
  }
  if (isCliOverride(command, 'selector')) out.selector = opts.selector;
  if (isCliOverride(command, 'keepUrlFragment')) out.keepUrlFragment = opts.keepUrlFragment;
  if (isCliOverride(command, 'useSitemaps')) out.useSitemaps = opts.useSitemaps;
  if (isCliOverride(command, 'initialConcurrency'))
    out.initialConcurrency = opts.initialConcurrency;
  if (isCliOverride(command, 'maxConcurrency')) out.maxConcurrency = opts.maxConcurrency;
  if (isCliOverride(command, 'maxResults')) out.maxResultsPerCrawl = opts.maxResults;
  if (isCliOverride(command, 'deduplication') && opts.deduplication !== undefined) {
    out.deduplication = opts.deduplication;
  }
  if (isCliOverride(command, 'storeSkippedUrls')) out.storeSkippedUrls = opts.storeSkippedUrls;
  if (isCliOverride(command, 'sessionPoolName') && opts.sessionPoolName) {
    out.sessionPoolName = opts.sessionPoolName;
  }

  return out;
}

/** All schema overrides for `crawl`: the single-page subset plus the crawl flags. */
function buildSchemaOverrides(opts: CrawlOpts, command?: Command): Partial<MarkdowneeInputType> {
  return { ...buildSinglePageOverrides(opts, command), ...buildCrawlOverrides(opts, command) };
}

function resolveCliOnly(
  opts: CrawlOpts,
  input: MarkdowneeCliInputType,
  command?: Command,
): CliOnlyOverrides {
  const urls = input.startUrls
    .map((u) => u.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);

  let save: SaveRoute[] = input.save;
  if (isCliOverride(command, 'save')) {
    save = validateSaveTokens(getExplicitRepeatedValues(command, '--save'), SAVE_ROUTE_TOKENS);
  }

  const proxyUrls = isCliOverride(command, 'proxy')
    ? (opts.proxy ?? [])
    : (input.proxyConfiguration?.proxyUrls ?? []);

  return {
    urls,
    save,
    proxyUrls,
    proxyRotation: input.proxyRotation,
  };
}

// ---------------------------------------------------------------------------
// Shared extraction action
// ---------------------------------------------------------------------------

async function runCrawlAction(
  urls: string[],
  opts: CrawlOpts,
  startUrlsFile?: string,
  command?: Command,
): Promise<void> {
  if (opts.verbose) process.env.LOG_LEVEL = 'DEBUG';

  const storageDir = resolveStorageDir(opts.storage);
  configureStorage(storageDir);

  const fromFile: Record<string, unknown> = opts.configFile
    ? await loadConfigFile(opts.configFile)
    : {};
  const fromCli = buildSchemaOverrides(opts, command);

  const collectedUrls = [...urls];

  if (startUrlsFile) {
    const text = await readFile(startUrlsFile, 'utf8');
    const fileUrls = text
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#'));
    collectedUrls.push(...fileUrls);
  }

  if (collectedUrls.length > 0) fromCli.startUrls = collectedUrls.map((url) => ({ url }));

  const layered: Record<string, unknown> = { ...fromFile, ...fromCli };

  const startUrlsLayered = Array.isArray(layered.startUrls) ? layered.startUrls : undefined;
  if (!startUrlsLayered || startUrlsLayered.length === 0) {
    console.error('Error: No URLs specified. Provide URLs as arguments or via --config-file.');
    process.exit(1);
  }

  const parsed = MarkdowneeCliInput.safeParse(layered);
  if (!parsed.success) {
    console.error('Invalid configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }

  const cliOnly = resolveCliOnly(opts, parsed.data, command);
  const cfg = buildCrawlConfig(parsed.data, cliOnly);

  const routes = buildRouteMap(cfg.save);

  if (opts.purge) await purgeStorageBuckets(storageDir);

  // One `--storage` path fully identifies a run's storage — always the
  // `default` buckets (named buckets are an Apify Actor concept; the schema's
  // datasetName/keyValueStoreName/requestQueueName are not surfaced here).
  const kvs = await KeyValueStore.open('default');
  const ds = await Dataset.open('default');

  process.stderr.write(`Extracting ${cfg.urls.length} URL(s) → storage [${cfg.save.join(', ')}]\n`);

  const sink = createCrawleeStorageSink({ routes, kvs, dataset: ds });

  let proxyConfiguration: ProxyConfiguration | undefined;
  if (cliOnly.proxyUrls.length > 0) {
    for (const raw of cliOnly.proxyUrls) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(raw);
      } catch {
        console.error(
          `proxyConfiguration.proxyUrls: malformed proxy URL. ` +
            `Expected http://user:pass@host:port (also accepts https://, socks4://, socks5://).`,
        );
        process.exit(1);
      }
      if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(parsedUrl.protocol)) {
        console.error(
          `proxyConfiguration.proxyUrls: unsupported scheme "${parsedUrl.protocol}". ` +
            `Use http://, https://, socks4:// or socks5://. ` +
            `Apify Proxy configuration is only supported in the Apify Actor build.`,
        );
        process.exit(1);
      }
    }
    proxyConfiguration = new ProxyConfiguration({ proxyUrls: cliOnly.proxyUrls });
  } else if (cliOnly.proxyRotation && cliOnly.proxyRotation !== 'recommended') {
    console.warn(
      `Warning: --proxy-rotation=${cliOnly.proxyRotation} has no effect ` +
        `without --proxy; running without proxy.`,
    );
  }

  let sitemapList: SitemapRequestList | undefined;
  if (parsed.data.useSitemaps) {
    const sitemapUrls = [...new Set(cfg.urls.map((u) => `${new URL(u).origin}/sitemap.xml`))];
    sitemapList = await SitemapRequestList.open({
      sitemapUrls,
      globs: cfg.globs,
      exclude: cfg.exclude,
    });
  }

  let failedCount = 0;
  const pendingWrites = createPendingWrites();

  const crawler = createMarkdowneeCrawler(
    toCrawlerOptions(cfg, {
      sink,
      proxyConfiguration,
      proxyRotation: cliOnly.proxyRotation,
      requestList: sitemapList,
      blockMediaExplicit: 'blockMedia' in layered,
      // Save-mode image bytes land in the same local store as the format
      // blobs; setValue-only, so references stay `kvs://{key}` (no public URL).
      imageKvs: { setValue: (key, value, options) => kvs.setValue(key, value, options) },
      onFailedRequest: async (info) => {
        failedCount++;
        await ds.pushData(buildFailedRecord(info));
      },
      onSkippedUrl: parsed.data.storeSkippedUrls
        ? (url, reason) => {
            pendingWrites.add(ds.pushData(buildSkippedRecord(url, reason)));
          }
        : undefined,
    }),
  );

  try {
    await crawler.run(buildRequests(cfg.urls, cfg.keepUrlFragment));
  } finally {
    await pendingWrites.drain();
  }

  process.stderr.write('Done.\n');
  if (failedCount > 0) process.exit(2);
}

// ---------------------------------------------------------------------------
// fetch action
// ---------------------------------------------------------------------------

/**
 * A LoggerText that writes every line to stderr. @apify/log routes INFO/DEBUG
 * through console.log/console.debug (stdout) by default; fetch keeps
 * stdout reserved for the raw content of a `-stdout` save token, so all
 * diagnostics must land on stderr.
 */
class StderrLoggerText extends LoggerText {
  override _outputWithConsole(_level: LogLevel, line: string): void {
    process.stderr.write(`${line}\n`);
  }
}

/**
 * Write raw content to stdout and resolve only once the chunk has been
 * flushed to the OS — pipe writes are asynchronous, and `runCli`'s
 * `process.exit()` would otherwise truncate anything still queued past the
 * pipe buffer. EPIPE (the reader closed early, e.g. `| head`) ends the
 * stream quietly and counts as success.
 */
function writeToStdout(content: string): Promise<void> {
  return new Promise((resolveWrite, rejectWrite) => {
    process.stdout.write(content, (error) => {
      if (!error || (error as NodeJS.ErrnoException).code === 'EPIPE') resolveWrite();
      else rejectWrite(error);
    });
  });
}

async function runFetchAction(url: string, opts: FetchOpts, command: Command): Promise<void> {
  const tokens = validateSaveTokens(
    opts.save?.length ? opts.save : [DEFAULT_FETCH_SAVE],
    FETCH_TOKENS,
  );
  const plan = planFetchRoutes(tokens);
  const fileTargets = resolveFileTargets(url, plan.fileFormats, opts.output);
  const savingImages = opts.imageHandling === 'save';
  if (savingImages && plan.stdoutFormat !== undefined) {
    throw new Error(
      'fetch --image-handling save cannot write content to stdout because image ' +
        'references need a sibling assets directory. Route every format to -file.',
    );
  }
  if (
    savingImages &&
    !plan.fileFormats.some((format) => ['markdown', 'html', 'minified-html'].includes(format))
  ) {
    throw new Error(
      'fetch --image-handling save requires a markdown-file, html-file, or ' +
        'minified-html-file output. Text and original HTML cannot reference saved assets.',
    );
  }
  const imageSink = savingImages
    ? new FilesystemImageSink(resolveAssetsDirectory(fileTargets))
    : undefined;

  // Only the single-page flags are registered on fetch, and
  // buildSinglePageOverrides maps nothing else by construction, so no
  // crawl-frontier or storage field can reach the fetch options.
  const options: FetchRuntimeOptions = {
    ...buildSinglePageOverrides(opts, command),
    formats: plan.formats,
    logLevel: opts.verbose ? 'debug' : 'warning',
    imageKvs: imageSink,
    ...(opts.proxy?.length ? { proxyConfiguration: { proxyUrls: opts.proxy } } : {}),
  };

  log.setOptions({ logger: new StderrLoggerText() });

  process.stderr.write(`Extracting ${url} → [${tokens.join(', ')}]\n`);
  const contents = await fetchWithRuntime(url, options);

  // A requested format the page yielded no content for is a partial result on
  // every route: warn on stderr and exit 2 (the same partial code `crawl`
  // uses) — never a hard failure, never a silent success.
  let partial = false;

  if (plan.stdoutFormat !== undefined) {
    const content = contents[SaveFormatResultKey[plan.stdoutFormat]];
    if (content === undefined) {
      process.stderr.write(
        `Warning: no ${plan.stdoutFormat} content extracted — nothing written to stdout.\n`,
      );
      partial = true;
    } else {
      await writeToStdout(content);
    }
  }

  if (imageSink !== undefined) await imageSink.commit();

  for (const { format, filePath } of fileTargets) {
    const content = contents[SaveFormatResultKey[format]];
    if (content === undefined) {
      process.stderr.write(`Warning: no ${format} content extracted — skipped ${filePath}.\n`);
      partial = true;
      continue;
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    process.stderr.write(`Wrote ${path.resolve(filePath)}\n`);
  }

  if (partial) process.exitCode = 2;
}

// ---------------------------------------------------------------------------
// Program builder
// ---------------------------------------------------------------------------

// The package version, resolved at runtime relative to this file: from src/
// in development and from the bundled dist/ output alike, `../package.json`
// is the package root manifest, so the CLI reports the version it shipped with.
const { version: packageVersion } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('markdownee')
    .description('Extract web content from URLs using configurable extraction options.')
    .version(packageVersion);

  // ---------------------------------------------------------------------------
  // crawl subcommand — explicit named form
  // ---------------------------------------------------------------------------
  const crawl = new Command('crawl');
  crawl.description('Extract content from URLs and save to storage');
  crawl.argument('[urls...]', 'URLs to extract content from');
  crawl.option('--start-urls-file <path>', cliOptionDescription('start-urls-file'));
  addSinglePageOptions(crawl);
  addCrawlOptions(crawl);
  crawl.action(
    async (urls: string[], opts: CrawlOpts & { startUrlsFile?: string }, command: Command) => {
      await runCrawlAction(urls, opts, opts.startUrlsFile, command);
    },
  );
  program.addCommand(crawl);

  // ---------------------------------------------------------------------------
  // fetch subcommand
  // ---------------------------------------------------------------------------
  const fetchCmd = new Command('fetch');
  fetchCmd.description(
    'Extract a single URL (no link-following) and write the content to file(s) or stdout',
  );
  fetchCmd.argument('<url>', 'URL to extract content from');
  addSinglePageOptions(fetchCmd);
  fetchCmd.addOption(
    new Option('--save <token>', cliOptionDescription('save-one'))
      .argParser(collectValues)
      .default([], DEFAULT_FETCH_SAVE),
  );
  fetchCmd.option('-o, --output <path>', cliOptionDescription('output'));
  fetchCmd.action(async (url: string, opts: FetchOpts, command: Command) => {
    await runFetchAction(url, opts, command);
  });
  program.addCommand(fetchCmd);

  // ---------------------------------------------------------------------------
  // export subcommand
  // ---------------------------------------------------------------------------
  const exportCmd = new Command('export');
  exportCmd
    .description('Export stored extraction content to a user-facing output directory')
    .option('--output-dir <path>', cliOptionDescription('output-dir'))
    .option('--storage <path>', STORAGE_FLAG_HELP)
    .action(async (opts: { outputDir?: string; storage?: string }) => {
      const result = await runExportAction({
        outputDir: opts.outputDir,
        storageDir: opts.storage,
      });
      process.stderr.write(
        `Exported ${result.filesWritten} file(s) from ${result.recordsTotal} record(s) → ${result.outputDir}\n`,
      );
    });
  program.addCommand(exportCmd);

  // ---------------------------------------------------------------------------
  // purge subcommand
  // ---------------------------------------------------------------------------
  const purge = new Command('purge');
  purge
    .description('Purge the storage at --storage (datasets, key-value stores, request queues)')
    .option('--storage <path>', STORAGE_FLAG_HELP)
    .action(async (opts: { storage?: string }) => {
      const { storageDir } = await runPurgeAction({ storageDir: opts.storage });
      process.stderr.write(`Purged storage at ${storageDir}.\n`);
    });
  program.addCommand(purge);

  return program;
}

/**
 * stdout carries raw `-stdout` content; a reader that closes early
 * (`| head`) must end the stream quietly instead of crashing the CLI with
 * an uncaught EPIPE. Module-level so repeated `runCli` calls (tests) attach
 * the listener once.
 */
const swallowStdoutEpipe = (error: NodeJS.ErrnoException): void => {
  if (error.code !== 'EPIPE') throw error;
};

export async function runCli(program: Command, argv: string[]): Promise<void> {
  if (!process.stdout.listeners('error').includes(swallowStdoutEpipe)) {
    process.stdout.on('error', swallowStdoutEpipe);
  }
  try {
    await program.parseAsync(argv);
    // Honor a partial-result code (2) set by an action; an explicit exit is
    // still required because crawler resources can keep the loop alive.
    process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export function isMainEntry(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return fileURLToPath(metaUrl) === realpathSync(resolve(argv1));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Type interfaces
// ---------------------------------------------------------------------------

/** The flags registered by {@link addSinglePageOptions} — `crawl` and `fetch`. */
interface SinglePageOpts {
  headless?: boolean;
  proxy?: string[];
  proxyRotation?: string;
  maxSessionRotations?: number;
  crawlerType?: string;
  markdownDiscovery?: MarkdowneeInputType['markdownDiscovery'];
  renderingTypeDetection?: number;
  waitUntil?: string;
  navigationTimeout?: number;
  blockMedia?: boolean;
  ignoreCorsAndCsp?: boolean;
  closeCookieModals?: boolean;
  maxScrollHeight?: number;
  ignoreHttpsErrors?: boolean;
  userAgent?: string;
  respectRobotsTxt?: boolean;
  cookies?: string;
  headers?: string;
  maxRetries?: number;
  mode?: MarkdowneeInputType['mode'];
  imageHandling?: MarkdowneeInputType['imageHandling'];
  maxImageEdge?: number;
  rasterizeSvg?: boolean;
  linkHandling?: MarkdowneeInputType['linkHandling'];
  tableHandling?: MarkdowneeInputType['tableHandling'];
  commentHandling?: MarkdowneeInputType['commentHandling'];
  language?: string;
  outputLayout?: MarkdowneeInputType['outputLayout'];
  verbose?: boolean;
  waitForDynamicContent?: number;
  waitForSelector?: string;
  softWaitForSelector?: string;
}

/** `crawl`'s full surface: the single-page flags plus {@link addCrawlOptions}. */
interface CrawlOpts extends SinglePageOpts {
  configFile?: string;
  purge?: boolean;
  maxRequestsPerCrawl?: number;
  maxCrawlDepth?: number;
  globs?: string[];
  exclude?: string[];
  selector?: string;
  keepUrlFragment?: boolean;
  useSitemaps?: boolean;
  initialConcurrency?: number;
  maxConcurrency?: number;
  maxResults?: number;
  save?: string[];
  deduplication?: MarkdowneeInputType['deduplication'];
  sessionPoolName?: string;
  storage?: string;
  storeSkippedUrls?: boolean;
}

/**
 * `fetch`'s exact surface: the single-page flags plus its own `--save`
 * and `--output`. Deliberately NOT {@link CrawlOpts} — reading a crawl or
 * storage flag Commander never registers here is a compile error.
 */
type FetchOpts = SinglePageOpts & { save?: string[]; output?: string };
