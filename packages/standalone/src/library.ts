import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  buildFailedRecord,
  buildRequests,
  buildRouteMap,
  buildSkippedRecord,
  createMarkdowneeCrawler,
  createPendingWrites,
  type ExtractionResult,
  type FailedRequestInfo,
  memorySink,
  ProxyConfiguration,
  SAVE_FORMATS,
  type SaveFormat,
  type Sink,
  SitemapRequestList,
} from '@markdownee/crawler';
import {
  MarkdowneeFetchInput,
  MarkdowneeInput,
  MarkdowneeLibraryInput,
  SaveFormatResultKey,
  type SaveRoute,
} from '@markdownee/schema';
import {
  Configuration,
  LogLevel as CrawleeLogLevel,
  Dataset,
  KeyValueStore,
  log,
  RequestQueue,
} from 'crawlee';
import {
  buildCrawlConfig,
  type CliOnlyOverrides,
  type CrawlerRuntime,
  toCrawlerOptions,
} from './config.js';
import type { FetchOptions, FetchRuntimeOptions } from './fetch-options.js';
import type { MarkdowneeOptions } from './markdownee-options.js';
import { runCrawler } from './run-crawler.js';
import { createCrawleeStorageSink } from './sinks.js';
import { resolveStorageDir } from './storage/index.js';

export type { FetchOptions, FetchRuntimeOptions } from './fetch-options.js';
export type { MarkdowneeOptions } from './markdownee-options.js';

/**
 * A returned record. Identical to the crawler's {@link ExtractionResult} except
 * the raw `html` is omitted unless `includeHtml` is set. The
 * `rawHtmlHash` / `rawHtmlLength` metadata are always retained.
 */
export type LibraryRecord = Omit<ExtractionResult, 'html'> & { html?: string };

/** A subset of Crawlee's `FinalStatistics`, returned from `run()`. */
export interface RunStatistics {
  requestsFinished: number;
  requestsFailed: number;
  requestsTotal: number;
}

/** The result handle returned by `run(urls)`. */
export interface RunResult {
  dataset: ResultDataset;
  statistics: RunStatistics;
  /** Exhausted page failures; a completed run may contain both successes and failures. */
  failures: readonly FailedRequestInfo[];
}

/**
 * Compose several sinks into one. Each is awaited in order, so a disk sink
 * placed first receives the full {@link ExtractionResult} (including `html`)
 * before an in-memory adapter strips it.
 */
export function combineSinks<T>(...sinks: Sink<T>[]): Sink<T> {
  return async (result: T): Promise<void> => {
    for (const sink of sinks) {
      await sink(result);
    }
  };
}

/**
 * A `Dataset`-style handle over in-memory results (the Crawlee `Dataset`
 * pattern, minimally mirrored). Holds only successful extractions; failures and
 * skips are absent; request failures are available on {@link RunResult}.
 */
export class ResultDataset {
  constructor(private readonly items: LibraryRecord[]) {}

  /** Number of records held. */
  get count(): number {
    return this.items.length;
  }

  /** Return all records as a fresh array (the internal array is not exposed). */
  getData(): LibraryRecord[] {
    return [...this.items];
  }

  /** Alias of `getData()`, mirroring Crawlee's `dataset.export()`. */
  export(): LibraryRecord[] {
    return this.getData();
  }

  /** Iterate records sequentially, awaiting an async iteratee. */
  async forEach(
    iteratee: (item: LibraryRecord, index: number) => void | Promise<void>,
  ): Promise<void> {
    let index = 0;
    for (const item of this.items) {
      await iteratee(item, index);
      index++;
    }
  }

  /** Write all records as JSON to the caller's explicitly selected store. */
  async exportToJSON(key: string, store: Pick<KeyValueStore, 'setValue'>): Promise<void> {
    await store.setValue(key, this.items);
  }

  /** Write all records as CSV to the caller's explicitly selected store. */
  async exportToCSV(key: string, store: Pick<KeyValueStore, 'setValue'>): Promise<void> {
    await store.setValue(key, toCsv(this.items), { contentType: 'text/csv; charset=utf-8' });
  }
}

const SUPPORTED_PROXY_SCHEMES = ['http:', 'https:', 'socks4:', 'socks5:'];

/**
 * Build a `ProxyConfiguration` from the schema's `proxyConfiguration.proxyUrls`,
 * validating each scheme. Throws (never `process.exit`) on an unsupported or
 * malformed URL, with credentials redacted from the message. Apify Proxy
 * (`useApifyProxy` / `groups`) is Actor-only and rejected here.
 */
function validateProxy(
  proxyConfiguration: Record<string, unknown> | undefined,
): ProxyConfiguration | undefined {
  if (!proxyConfiguration) return undefined;

  const proxyUrls = proxyConfiguration.proxyUrls;
  if (!Array.isArray(proxyUrls) || proxyUrls.length === 0) {
    if ('useApifyProxy' in proxyConfiguration || 'groups' in proxyConfiguration) {
      throw new Error(
        'Apify Proxy configuration is only supported in the Apify Actor build. ' +
          'Provide explicit proxyConfiguration.proxyUrls (http/https/socks4/socks5) instead.',
      );
    }
    return undefined;
  }

  const urls: string[] = [];
  for (const raw of proxyUrls) {
    if (typeof raw !== 'string') {
      throw new Error('proxyConfiguration.proxyUrls must be an array of URL strings.');
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(raw);
    } catch {
      // Do not echo `raw` — it may embed credentials (user:pass@host).
      throw new Error('proxyConfiguration.proxyUrls contains a malformed URL.');
    }
    if (!SUPPORTED_PROXY_SCHEMES.includes(parsedUrl.protocol)) {
      // Report scheme + host only; never the userinfo segment.
      throw new Error(
        `Unsupported proxy scheme "${parsedUrl.protocol}" in "${parsedUrl.protocol}//${parsedUrl.host}". ` +
          'Use http://, https://, socks4:// or socks5://. ' +
          'Apify Proxy configuration is only supported in the Apify Actor build.',
      );
    }
    urls.push(raw);
  }
  return new ProxyConfiguration({ proxyUrls: urls });
}

function resolveLogLevel(level: MarkdowneeOptions['logLevel']): CrawleeLogLevel {
  switch (level) {
    case 'off':
      return CrawleeLogLevel.OFF;
    case 'error':
      return CrawleeLogLevel.ERROR;
    case 'warning':
      return CrawleeLogLevel.WARNING;
    case 'info':
      return CrawleeLogLevel.INFO;
    case 'debug':
      return CrawleeLogLevel.DEBUG;
    case undefined:
      return CrawleeLogLevel.WARNING;
    default: {
      // Compile-time exhaustiveness guard: a new LogLevel member breaks the build here.
      const exhaustive: never = level;
      void exhaustive;
      return CrawleeLogLevel.WARNING;
    }
  }
}

/** Contain synchronous Crawlee constructor effects before any asynchronous work. */
function createRunConfiguration(
  options: ConstructorParameters<typeof Configuration>[0],
): Configuration {
  const previousLevel = log.getLevel();
  const previousListeners = EventEmitter.defaultMaxListeners;
  try {
    return new Configuration(options);
  } finally {
    if (log.getLevel() !== previousLevel) log.setLevel(previousLevel);
    EventEmitter.defaultMaxListeners = previousListeners;
  }
}

/**
 * In-memory result collector. Wraps `memorySink` and strips `html` (unless
 * `includeHtml`) at the TypeScript boundary — never in the native layer. The
 * `rawHtmlHash` / `rawHtmlLength` siblings are retained either way.
 */
function memoryAdapter(includeHtml: boolean): {
  sink: Sink<ExtractionResult>;
  results: LibraryRecord[];
} {
  const mem = memorySink<LibraryRecord>();
  const sink: Sink<ExtractionResult> = async (result) => {
    const { html, ...rest } = result;
    await mem(includeHtml ? { ...rest, html } : rest);
  };
  return { sink, results: mem.results };
}

function csvEscape(value: string): string {
  // Neutralize spreadsheet formula injection: a cell whose first character is
  // =, +, -, @, tab, or CR is evaluated as a formula by Excel/Sheets. Scraped
  // content is untrusted (security.md), so prefix such cells with an apostrophe
  // before RFC-4180 quoting.
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return csvEscape(JSON.stringify(value));
  return csvEscape(String(value));
}

/**
 * Minimal, dependency-free RFC-4180 CSV serializer for a flat array of records.
 * Columns are the sorted union of top-level keys; nested objects (`metadata`,
 * `formats`) are JSON-stringified into a single cell.
 */
function toCsv(items: LibraryRecord[]): string {
  const keys = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item)) keys.add(key);
  }
  const header = [...keys].sort();
  const lines = [header.map(csvEscape).join(',')];
  for (const item of items) {
    const record: Record<string, unknown> = item;
    lines.push(header.map((key) => csvCell(record[key])).join(','));
  }
  return lines.join('\n');
}

async function executeRun(
  options: MarkdowneeOptions,
  urls: readonly string[],
  blockMediaExplicit: boolean,
): Promise<RunResult> {
  const { includeHtml = false, storageDir, logLevel, ...schemaOptions } = options;

  // Validate through the shared input schema. `startUrls` come from run(urls);
  // unknown library-only keys were already removed by destructuring above.
  const parsed = MarkdowneeInput.safeParse({
    ...schemaOptions,
    startUrls: urls.map((url) => ({ url })),
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid markdownee options: ${issues}`);
  }
  const input = parsed.data;

  const configuration = createRunConfiguration({
    storageClientOptions:
      storageDir === undefined && options.imageHandling !== 'save'
        ? { persistStorage: false }
        : { localDataDirectory: resolveStorageDir(storageDir) },
    purgeOnStart: false,
  });
  const requestQueue = await RequestQueue.open(`crawl-${randomUUID()}`, {
    config: configuration,
  });
  let requestList: SitemapRequestList | undefined;
  const writes = createPendingWrites();
  try {
    const cli: CliOnlyOverrides = {
      urls: input.startUrls
        .map((u) => u.url)
        .filter((u): u is string => typeof u === 'string' && u.length > 0),
      save: input.save,
      proxyUrls: [],
      proxyRotation: input.proxyRotation,
    };
    const cfg = buildCrawlConfig(input, cli);
    const proxyConfiguration = validateProxy(input.proxyConfiguration);

    const mem = memoryAdapter(includeHtml);
    const failures: FailedRequestInfo[] = [];
    let sink: Sink<ExtractionResult> = mem.sink;
    let onFailedRequest: CrawlerRuntime['onFailedRequest'] = async (info) => {
      failures.push(info);
    };
    let onSkippedUrl: CrawlerRuntime['onSkippedUrl'];
    let runtimeImageKvs: CrawlerRuntime['imageKvs'];

    // Optional disk path — mirrors the CLI: full records to the storage sink,
    // plus failed/skipped records pushed to the dataset.
    if (storageDir !== undefined) {
      const kvs = await KeyValueStore.open('default', { config: configuration });
      const ds = await Dataset.open('default', { config: configuration });
      const diskSink = createCrawleeStorageSink({
        routes: buildRouteMap(input.save),
        kvs,
        dataset: ds,
      });
      sink = combineSinks(diskSink, mem.sink);
      // Save-mode image bytes land in the same local store as the format
      // blobs; setValue-only, so references stay `kvs://{key}` (no public URL).
      runtimeImageKvs = { setValue: (key, value, options) => kvs.setValue(key, value, options) };
      onFailedRequest = async (info) => {
        failures.push(info);
        await ds.pushData(buildFailedRecord(info));
      };
      if (input.storeSkippedUrls) {
        onSkippedUrl = (url, reason) => {
          writes.add(ds.pushData(buildSkippedRecord(url, reason)));
        };
      }
    }

    const runtime: CrawlerRuntime = {
      sink,
      proxyConfiguration,
      proxyRotation: input.proxyRotation,
      onFailedRequest,
      onSkippedUrl,
      imageKvs: runtimeImageKvs,
      blockMediaExplicit,
      configuration,
      requestQueue,
      log: log.child({ level: resolveLogLevel(logLevel) }),
    };

    if (input.useSitemaps) {
      const sitemapUrls = [...new Set(cfg.urls.map((u) => `${new URL(u).origin}/sitemap.xml`))];
      // Crawlee's sitemap restore/persist opens a default KVS internally, even
      // with persistence events disabled. Bind it to private memory storage so
      // one run cannot restore another run's closed list or write global state.
      const sitemapConfiguration = createRunConfiguration({
        storageClientOptions: { persistStorage: false },
        purgeOnStart: false,
      });
      requestList = await Configuration.storage.run(sitemapConfiguration, () =>
        SitemapRequestList.open({
          sitemapUrls,
          globs: cfg.globs,
          exclude: cfg.exclude,
          config: sitemapConfiguration,
          persistenceOptions: { enable: false },
        }),
      );
      runtime.requestList = requestList;
    }

    const crawler = createMarkdowneeCrawler(toCrawlerOptions(cfg, runtime));
    const stats = await runCrawler(crawler, buildRequests(cfg.urls, cfg.keepUrlFragment));

    const max = input.maxResultsPerCrawl;
    const items = max > 0 ? mem.results.slice(0, max) : mem.results;

    return {
      dataset: new ResultDataset(items),
      failures,
      statistics: {
        requestsFinished: stats.requestsFinished,
        requestsFailed: stats.requestsFailed,
        requestsTotal: stats.requestsTotal,
      },
    };
  } finally {
    try {
      await writes.drain();
    } finally {
      try {
        await requestList?.teardown();
      } finally {
        await requestQueue.drop();
      }
    }
  }
}

/**
 * Construct a programmatic extractor from a camelCase options object, then call
 * `run(urls)` to crawl and get results back in memory.
 *
 * Mirrors Crawlee minimally: construct-from-options, `run(urls)` resolving to a
 * `Dataset`-style handle plus a `statistics` subset of `FinalStatistics`.
 * Page failures resolve with successful results, failure details and statistics;
 * invalid inputs and operation failures throw. No call uses `process.exit()`.
 * Returning in-memory data and writing to disk (via `storageDir`) are independent.
 */
export function createCrawler(options: MarkdowneeOptions = {}): {
  run(urls: readonly string[]): Promise<RunResult>;
} {
  const parsed = MarkdowneeLibraryInput.partial().safeParse(options);
  if (!parsed.success) throw invalidOptions(parsed.error.issues);
  const snapshot = parsed.data;
  // Cookie entries remain unknown until the crawler normalizes their fields;
  // Zod clones the array but leaves unknown object entries by reference.
  if (snapshot.initialCookies) {
    snapshot.initialCookies = snapshot.initialCookies.map((cookie) =>
      cookie !== null && typeof cookie === 'object' && !Array.isArray(cookie)
        ? { ...cookie }
        : cookie,
    );
  }
  const blockMediaExplicit = Object.hasOwn(options, 'blockMedia');
  return {
    run: (urls: readonly string[]) => executeRun(snapshot, urls, blockMediaExplicit),
  };
}

/** Selected content keys use camelCase; unavailable formats are omitted. */
export type FetchResultKey = (typeof SaveFormatResultKey)[SaveFormat];
export type FetchResult = Partial<Record<FetchResultKey, string>>;

/**
 * Crawl exactly one URL (no link-following) and return the extracted content
 * as a structured result map (`minified-html` is returned as `minifiedHtml`).
 * Uses the same crawler/configuration projection, capped at one request:
 * nothing is persisted (the run uses a non-persisting in-memory storage client),
 * and output routing stays with the caller. Throws when the single request fails.
 */
export async function fetchWithRuntime(
  url: string,
  options: FetchRuntimeOptions = {},
  blockMediaExplicit = Object.hasOwn(options, 'blockMedia'),
): Promise<FetchResult> {
  const { formats = ['markdown'], imageKvs, logLevel, ...singlePage } = options;
  const requested = [...new Set(formats)];
  if (requested.length === 0) {
    throw new Error('fetch: `formats` must list at least one format.');
  }
  for (const format of requested) {
    if (!SAVE_FORMATS.includes(format)) {
      throw new Error(`fetch: unknown format '${format}'. Valid: ${SAVE_FORMATS.join(', ')}.`);
    }
  }

  if (singlePage.imageHandling === 'save' && imageKvs === undefined) {
    throw new Error(
      'fetch: imageHandling "save" needs the npm CLI fetch command with ' +
        'file output (--save markdown-file, html-file, or minified-html-file).',
    );
  }

  // These route tokens select conversion formats only. The direct sink below
  // captures the extraction result without opening a Dataset or content KVS.
  const save = requested.map((format) => `${format}-kvs` as SaveRoute);

  // Keep the single-page run off the disk entirely and away from other crawls
  // in this process: an isolated, non-persisting Configuration (never the
  // mutable global one — Crawlee caches storages per client, so flipping the
  // global `persistStorage` would corrupt concurrent createCrawler runs).
  const configuration = createRunConfiguration({
    storageClientOptions: { persistStorage: false },
    purgeOnStart: false,
  });
  // A per-run queue: a shared RequestQueue remembers handled URLs for the
  // lifetime of the process, which would no-op a repeated fetch of the
  // same URL.
  const requestQueue = await RequestQueue.open(`fetch-${randomUUID()}`, {
    config: configuration,
  });
  try {
    const parsed = MarkdowneeInput.safeParse({
      ...singlePage,
      save,
      startUrls: [{ url }],
      maxCrawlDepth: 0,
      maxRequestsPerCrawl: 1,
    });
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid markdownee options: ${issues}`);
    }

    const input = parsed.data;
    const cfg = buildCrawlConfig(input, {
      urls: [url],
      save,
      proxyUrls: [],
      proxyRotation: input.proxyRotation,
    });
    const proxyConfiguration = validateProxy(input.proxyConfiguration);
    let record: ExtractionResult | undefined;
    let failedCount = 0;
    const crawlerOptions = toCrawlerOptions(cfg, {
      sink: async (result) => {
        record = result;
      },
      proxyConfiguration,
      proxyRotation: input.proxyRotation,
      requestQueue,
      configuration,
      imageKvs,
      blockMediaExplicit,
      onFailedRequest: async () => {
        failedCount += 1;
      },
    });
    // `original` is returned from the captured raw HTML. It must not cause a
    // second copy of every downloaded image beside the derived-output assets.
    crawlerOptions.saveOriginalImages = false;

    crawlerOptions.log = log.child({ level: resolveLogLevel(logLevel) });
    const crawler = createMarkdowneeCrawler(crawlerOptions);
    await runCrawler(crawler, buildRequests([url], false));

    if (!record) {
      throw new Error(
        `fetch: extraction failed for ${url} ` + `(${failedCount} failed request(s)).`,
      );
    }
    const contents: FetchResult = {};
    for (const format of requested) {
      if (format === 'original') {
        if (typeof record.html === 'string') contents.original = record.html;
        continue;
      }
      const resultKey = SaveFormatResultKey[format];
      const content = record.formats[resultKey];
      if (typeof content === 'string') contents[resultKey] = content;
    }
    return contents;
  } finally {
    await requestQueue.drop();
  }
}

export async function fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  if ((options as { imageHandling?: unknown }).imageHandling === 'save') {
    throw new Error(
      'fetch: imageHandling "save" cannot return image bytes. Use the npm CLI ' +
        'fetch command with file output (--save markdown-file, html-file, or ' +
        'minified-html-file), or choose "resolved-url".',
    );
  }
  const parsed = MarkdowneeFetchInput.partial().safeParse(options);
  if (!parsed.success) throw invalidOptions(parsed.error.issues);
  return fetchWithRuntime(url, parsed.data, Object.hasOwn(options, 'blockMedia'));
}

function invalidOptions(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Error {
  return new TypeError(
    `Invalid markdownee options: ${issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')}`,
  );
}
