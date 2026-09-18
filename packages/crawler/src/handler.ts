import type { Readable } from 'node:stream';
import {
  ContentExtractor,
  computeContentInfo,
  type OutputFormat,
  type OutputLayout,
  type PageExtraction,
  type PageOutputContext,
  type TrafilaturacoreConfig,
} from '@markdownee/extraction';
import { type Deduplication, MarkdownDiscovery } from '@markdownee/schema';
import type {
  AdaptivePlaywrightCrawlerContext,
  BaseHttpClient,
  CheerioAPI,
  CheerioCrawlingContext,
  EnqueueLinksOptions,
  LoadedContext,
  PlaywrightCrawlingContext,
  RequestHandler,
} from 'crawlee';
import { GotScrapingHttpClient, NonRetryableError, playwrightUtils } from 'crawlee';
import type { Page } from 'playwright';
import {
  hasMatchingReturnTarget,
  hasSubstantialArticle,
  recoverConsentWallAdaptive,
  recoverConsentWallOnPage,
  stripConsentFromCheerio,
  stripConsentFromPage,
} from './browser/consent.js';
import { autoScroll, type ScrollConfig } from './browser/scroll.js';
import { type RunCancellation, withRunCancellation } from './cancellation.js';
import {
  adaptiveImageFetcher,
  type ImageFetcher,
  playwrightImageFetcher,
  sendRequestImageFetcher,
} from './images/image-fetcher.js';
import { type ImageLog, saveImages } from './images/pipeline.js';
import type { StoredImage } from './images/stored-image.js';
import {
  decodeBody,
  isMarkdownContentType,
  MARKDOWN_ACCEPT,
  MAX_MARKDOWN_BYTES,
  type MarkdownFetcher,
  type MarkdownResponse,
  OriginProbeBudget,
  resolveServedMarkdown,
  type ServedMarkdownSource,
} from './markdown/discovery.js';
import { extractServedMarkdown } from './markdown/extract.js';
import type { MarkdownRobotsGate } from './markdown/robots.js';
import type { KvsLike } from './sinks/storage.js';
import type { ExtractionResult, Sink } from './sinks/types.js';
import {
  bindSubFetchHeaders,
  type SubFetchHeaders,
  type SubFetchHeadersFor,
  subFetchOriginContext,
} from './sub-fetch-headers.js';

/**
 * Default {@link HandlerOpts.minHttpExtractionChars}. A client-rendered page
 * fetched over plain HTTP yields an empty shell — far below this — while an
 * ordinary short article clears it, so escalation stays rare.
 */
const DEFAULT_MIN_HTTP_EXTRACTION_CHARS = 200;

/**
 * Stable identity for one Crawlee request across the several handler runs the
 * adaptive crawler may perform for it. `Request.id` is assigned per request;
 * `uniqueKey` and the URL are the fallbacks used by contexts that carry neither.
 */
function requestKey(request: { id?: string; uniqueKey?: string; url: string }): string {
  return request.id ?? request.uniqueKey ?? request.url;
}

/**
 * Whether this request has already been retried for a consent wall that appeared
 * while its waits ran.
 *
 * Tracked on `userData`, which the same `Request` carries across its retries,
 * rather than read from `retryCount`: that counts *every* retryable failure, so a
 * page that had already failed once on a proxy or navigation error would take the
 * terminal fallback on its first late wall and never get the retry that the
 * accepted consent cookie makes worthwhile.
 */
function consentRetried(request: { userData?: Record<string, unknown> }): boolean {
  return request.userData?.consentRetried === true;
}

/** Record that the consent retry for this request has been spent. */
function markConsentRetried(request: { userData?: Record<string, unknown> }): void {
  if (request.userData === undefined) request.userData = {};
  request.userData.consentRetried = true;
}

/** Selector-wait fallback when no dynamic-content budget is configured. */
export const DEFAULT_SELECTOR_TIMEOUT_SECS = 30;

/**
 * Timeout for the selector waits, in milliseconds.
 *
 * `waitForDynamicContentSecs` doubles as this budget, but it defaults to 0 and
 * the Actor forwards that 0 verbatim. A nullish fallback would keep it, and
 * Playwright reads a timeout of 0 as *no* timeout — so a soft selector that never
 * appears would hang to the handler's own deadline and fail the request instead
 * of being skipped. Zero therefore falls back to the same bound as absent.
 */
function selectorTimeoutMs(opts: HandlerOpts): number {
  return (opts.waitForDynamicContentSecs || DEFAULT_SELECTOR_TIMEOUT_SECS) * 1000;
}

/**
 * Enforce a required selector against an already-materialized document.
 *
 * Used on the HTTP recovery path, where the article arrived over the crawler's
 * HTTP channel while the live page still shows the consent wall. The page-based
 * waits cannot help there and `context.waitForSelector` would inspect the wall
 * rather than the article, but `waitForSelector` is a validation contract whose
 * absence must fail the request, so it is checked against the recovered markup.
 * The message matches Crawlee's so both paths fail identically.
 *
 * The guard is truthiness, not definedness. The input schema defaults this field
 * to the empty string and documents "leave empty to disable", and every product
 * surface forwards that default verbatim — while Cheerio matches nothing for
 * `$('')`, so a definedness check would fail every recovered page by default.
 * This matches how the wait paths test the same option.
 */
function requireSelectorInDocument($: CheerioAPI, selector: string | undefined): void {
  if (selector && $(selector).length === 0) {
    throw new Error(`Selector '${selector}' not found.`);
  }
}

/**
 * The live page's current URL, or `undefined` when there is no live page.
 *
 * Reading `context.page` in an HTTP-only run throws, which Crawlee treats as a
 * request to rerun in a browser. That escalation is deliberately swallowed here:
 * an HTTP-only run has no page that could have navigated, so there is nothing to
 * re-check and escalating would cost a browser render for no reason.
 */
function livePageUrl(context: LoadedContext<AdaptivePlaywrightCrawlerContext>): string | undefined {
  try {
    return context.page.url();
  } catch {
    return undefined;
  }
}

/**
 * The live page, or `undefined` when this adaptive run has none.
 *
 * Reading `context.page` on the HTTP-only branch throws, and Crawlee reads that
 * throw as a request to rerun in a browser. That escalation is swallowed here on
 * purpose, exactly as {@link livePageUrl} swallows it: the branch that has no
 * page is the branch whose whole value is not launching one, so a discovery
 * probe must never be the thing that forces the render.
 *
 * Optional chaining is not a substitute — `context.page?.request` still fires
 * the throwing getter.
 */
function adaptivePage(context: LoadedContext<AdaptivePlaywrightCrawlerContext>): Page | undefined {
  try {
    return context.page;
  } catch {
    return undefined;
  }
}

/** Whether a page-level wait (scroll or network settle) is configured. */
function hasPageWaits(opts: HandlerOpts): boolean {
  return Boolean(opts.scroll || opts.waitForDynamicContentSecs);
}

/** Whether a selector wait is configured. */
function hasSelectorWaits(opts: HandlerOpts): boolean {
  return Boolean(opts.waitForSelector || opts.softWaitForSelector);
}

interface HandlerOpts {
  extractionConfig?: Partial<TrafilaturacoreConfig>;
  sink: Sink<ExtractionResult>;
  scroll?: ScrollConfig;
  formats: OutputFormat[];
  maxResults?: number;
  selector?: string;
  maxCrawlDepth?: number;
  globs?: string[];
  exclude?: string[];
  keepUrlFragment?: boolean;
  onSkippedUrl?: (url: string, reason: string) => void;
  waitForSelector?: string;
  softWaitForSelector?: string;
  waitForDynamicContentSecs?: number;
  /**
   * Remove known consent/CMP containers from the captured DOM before extraction.
   * Gated on cookie handling being enabled (`closeCookieModals` → `'ghostery'`).
   * Applied in place so the single captured `html` — and therefore the
   * `original` output, `rawHtmlHash`, metadata, and extracted formats — is
   * consent-free when on, and the raw page when off (the retest control).
   */
  stripConsent?: boolean;
  deduplication: Deduplication;
  seenCanonicals: Set<string>;
  seenContentHashes: Set<string>;
  /**
   * Adaptive-only floor, in characters of extracted body text, below which an
   * HTTP-only run is treated as an unhydrated shell and escalated to a browser
   * rerun. Deliberately conservative: escalation costs one browser render, while
   * accepting a shell silently truncates the page.
   */
  minHttpExtractionChars?: number;
  /**
   * Save image-handling byte pipeline config. Present only when
   * `imageHandling === 'save'`; the handlers then split the engine pass
   * (`cleanPage`) from format rendering (`renderFormats`), download + store the
   * image bytes in between, and rewrite each stored `img src` on the cleaned
   * HTML so the references flow into every rendered format.
   */
  images?: HandlerImageOptions;
  /**
   * How hard to look for a Markdown representation the origin publishes for the
   * page. `off` (the default) is a complete no-op: no header changes, no extra
   * request, and byte-identical output to a run without this feature.
   */
  markdownDiscovery?: MarkdownDiscovery;
  /**
   * Generated output envelope, needed here because the served bytes replace the
   * rendered Markdown after `renderFormats` has already applied the layout.
   */
  outputLayout?: OutputLayout;
  /** Per-origin speculative-fetch budget, shared across a crawler's handlers. */
  markdownBudget?: OriginProbeBudget;
  /**
   * The crawler's own HTTP client, held by every handler sub-fetch that cannot
   * ride `context.sendRequest`.
   *
   * A Cheerio-path Markdown discovery fetch needs it so it can read its candidate
   * off a response stream and stop at the ceiling instead of buffering whatever
   * the origin chose to send: `context.sendRequest` cannot do that — it resolves
   * with a body already materialised — and it is bound to this same client, so
   * nothing about the channel changes by holding it directly. See
   * {@link streamingMarkdownFetcher}.
   *
   * The adaptive HTTP-only branch's image fallback needs it for a different
   * reason: with initial cookies this is `createRescopingHttpClient`, whose
   * `beforeRedirect` hook re-derives the `Cookie` header per hop against the URL
   * the crawl asked for. Allocating a client there instead left those sub-fetches
   * following redirects with got's hostname-and-port comparison as their only
   * guard. It is therefore set unconditionally rather than with the Markdown
   * options — an image fetch needs it on a run with Markdown discovery off.
   */
  httpClient?: BaseHttpClient;
  /**
   * This run's robots.txt gate, shared across handlers. Present only when the
   * run respects robots.txt; see {@link MarkdownRobotsGate} for why discovery
   * cannot inherit Crawlee's own enforcement.
   */
  markdownRobots?: MarkdownRobotsGate;
  /**
   * This crawler's handler-cancellation registry, shared with the crawler's own
   * failure hooks. Absent when a handler is built directly rather than through
   * `createMarkdowneeCrawler`, which is how the co-located tests drive
   * these handlers: there is no crawler to report a failure, so there is nothing
   * to cancel. See {@link RunCancellation} for why Crawlee's own `tryCancel()`
   * is not what does this.
   */
  cancellation?: RunCancellation;
  /**
   * The caller's transferable identity — `userAgent`, `extraHTTPHeaders` and the
   * in-scope initial cookies — rebuilt for one sub-fetch URL. Every HTTP sub-fetch
   * below merges it beneath its own headers: one riding `ctx.sendRequest` because
   * Crawlee REPLACES the origin request's headers with a fetcher's override rather
   * than merging, one calling the client directly because it has no origin request
   * to inherit from. Either way each went out with a fabricated User-Agent and no
   * credentials behind a page fetch that carried all three. Absent when a handler is
   * built directly rather than through `createMarkdowneeCrawler`, and on the
   * browser paths, which fetch through `page.request` and inherit the context.
   */
  subFetchHeaders?: SubFetchHeadersFor;
}

interface HttpConsentResponse {
  readonly body: string;
  readonly url: string;
  readonly statusCode?: number;
}

async function tryRecoverRedirectedArticle(
  $: CheerioAPI,
  articleUrl: string,
  currentLoadedUrl: string,
  fetchHtml: (url: string) => Promise<HttpConsentResponse>,
  log: ImageLog,
): Promise<{ $: CheerioAPI; loadedUrl: string } | undefined> {
  if (!hasMatchingReturnTarget(articleUrl, currentLoadedUrl)) return undefined;

  const response = await fetchHtml(articleUrl).catch(() => undefined);
  if (response === undefined) return undefined;
  if (
    response.statusCode !== undefined &&
    (response.statusCode < 200 || response.statusCode >= 300)
  ) {
    return undefined;
  }

  try {
    if (new URL(response.url).origin !== new URL(articleUrl).origin) return undefined;
  } catch {
    return undefined;
  }
  if (hasMatchingReturnTarget(articleUrl, response.url)) return undefined;

  const recovered = $.load(response.body);
  if (!hasSubstantialArticle(recovered)) return undefined;

  log.info(`Recovered consent redirect through the crawler HTTP channel for ${articleUrl}`);
  return { $: recovered, loadedUrl: response.url };
}

function failUnresolvedConsentRedirect(articleUrl: string, log: ImageLog): never {
  log.warning(`Consent redirect remained unresolved for ${articleUrl}; failing request`);
  throw new Error(`CONSENT_WALL_NOT_BYPASSED: ${articleUrl}`);
}

function rejectUnresolvedConsentRedirect(
  articleUrl: string,
  currentLoadedUrl: string,
  log: ImageLog,
): void {
  if (hasMatchingReturnTarget(articleUrl, currentLoadedUrl)) {
    failUnresolvedConsentRedirect(articleUrl, log);
  }
}

/** Save-mode image pipeline wiring resolved by `createMarkdowneeCrawler`. */
export interface HandlerImageOptions {
  /** Lazily resolves the destination key-value store (opened at most once per run). */
  getKvs: () => Promise<KvsLike>;
  /** Long-edge pixel cap (never upscales); `0` = uncapped. */
  maxImageEdge: number;
  /** Store SVGs rasterized to PNG (`true`) or as sanitized SVG source (`false`). */
  rasterizeSvg: boolean;
  /** Also store pre-normalization bytes (an `original-*` save token is set). */
  saveOriginal: boolean;
}

/**
 * One extraction pass. Outside save mode this is the plain single-engine-pass
 * `extractPage`. In save mode it splits the pass — `cleanPage`, then the image
 * byte pipeline over the cleaned HTML, then `renderFormats` on the rewritten
 * HTML — so stored-image references land in every format.
 */
async function runExtraction(
  extractor: ContentExtractor,
  html: string,
  url: string,
  opts: HandlerOpts,
  fetcher: ImageFetcher | undefined,
  log: ImageLog,
  context: PageOutputContext,
  checkCancelled?: () => void,
): Promise<{ extracted: PageExtraction; images?: StoredImage[] }> {
  if (opts.images === undefined || fetcher === undefined) {
    return {
      extracted: await extractor.extractPage(html, { url, formats: opts.formats, context }),
    };
  }
  // Checked here rather than between images: `saveImages` treats every per-image
  // failure as non-fatal and swallows it, so a cancellation raised inside that
  // loop would be logged as one more failed download and the handler would carry
  // on to the sink. This is the last point before the byte pipeline that a throw
  // still propagates.
  checkCancelled?.();
  const page = await extractor.cleanPage(html, url);
  let cleanedHtml = page.html;
  let images: StoredImage[] | undefined;
  if (!page.rejected) {
    const result = await saveImages(cleanedHtml, fetcher, {
      kvs: await opts.images.getKvs(),
      maxImageEdge: opts.images.maxImageEdge,
      rasterizeSvg: opts.images.rasterizeSvg,
      saveOriginal: opts.images.saveOriginal,
      log,
    });
    cleanedHtml = result.html;
    images = result.images;
  }
  return {
    extracted: await extractor.renderFormats(cleanedHtml, page, opts.formats, context),
    images,
  };
}

function pageOutputContext(
  url: string,
  loadedUrl: string,
  depth: number,
  referrerUrl: string | null,
  httpStatusCode?: number,
): PageOutputContext {
  return {
    url,
    crawl: {
      loadedUrl,
      scrapedAt: new Date().toISOString(),
      ...(httpStatusCode !== undefined ? { httpStatusCode } : {}),
      depth,
      ...(referrerUrl !== null ? { referrerUrl } : {}),
    },
  };
}

function observedStatusCode(response: unknown): number | undefined {
  if (typeof response !== 'object' || response === null) return undefined;
  const candidate = response as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  if (typeof candidate.status === 'function') {
    const status = candidate.status();
    return typeof status === 'number' ? status : undefined;
  }
  return typeof candidate.status === 'number' ? candidate.status : undefined;
}

/** The rung this handler runs at; `off` unless the caller opted in. */
function markdownRung(opts: HandlerOpts): MarkdownDiscovery {
  return opts.markdownDiscovery ?? MarkdownDiscovery.Off;
}

/**
 * A second `ContentExtractor` for Markdown-sourced pages, built once per handler
 * and only when the option is on.
 *
 * It differs from the page extractor in exactly one setting: `boilerplate` is
 * `keep`. The origin already decided what this page's content is, so running
 * main-content extraction across a document that is entirely content would
 * discard part of it. Every other content-handling choice the caller made —
 * links, tables, comments, images, target language — still applies, and the
 * unconditional security floor runs on this path exactly as on the other.
 */
function servedMarkdownExtractor(opts: HandlerOpts): ContentExtractor | undefined {
  if (markdownRung(opts) === MarkdownDiscovery.Off) return undefined;
  return new ContentExtractor({ ...opts.extractionConfig, boilerplate: 'keep' });
}

/**
 * The response header a path can read, lowercased, or `undefined`.
 *
 * `headers` has two shapes across the crawler paths, exactly as `status` does
 * in {@link observedStatusCode}: a plain object on the got-scraping response the
 * Cheerio and adaptive-HTTP paths carry, and a **method** on the Playwright
 * `Response` the browser paths carry. Reading only the object form left the
 * `Link:` header carrier silently dead on every Playwright path — which is the
 * one an origin advertising its alternate by response header alone depends on.
 */
function responseHeader(response: unknown, name: string): string | undefined {
  if (typeof response !== 'object' || response === null) return undefined;
  const raw = (response as { headers?: unknown }).headers;
  let headers: unknown = raw;
  if (typeof raw === 'function') {
    try {
      headers = (raw as () => unknown).call(response);
    } catch {
      return undefined;
    }
  }
  if (typeof headers !== 'object' || headers === null) return undefined;
  const value = (headers as Record<string, unknown>)[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/**
 * The page response read as a possible Markdown body.
 *
 * Only ever non-`undefined` on a path whose own page fetch carried
 * {@link MARKDOWN_ACCEPT} and whose response object still holds the body. On the
 * adaptive HTTP-only branch that is `context.response`, whose runtime shape is
 * got-scraping's response — `body` is a string there even though the declared
 * `BaseHttpResponseData` does not promise it, so it is read defensively.
 */
function pageResponseAsMarkdown(response: unknown, body?: unknown): MarkdownResponse | undefined {
  const contentType = responseHeader(response, 'content-type');
  if (!isMarkdownContentType(contentType)) return undefined;
  const decoded = decodeBody(body ?? (response as { body?: unknown } | null)?.body);
  if (decoded === undefined) return undefined;
  const statusCode = observedStatusCode(response);
  return { statusCode: statusCode ?? 200, contentType: contentType ?? '', body: decoded };
}

/**
 * Milliseconds one discovery fetch may take.
 *
 * Neither channel bounded this, and neither request-handler budget allots a
 * single second to discovery: `browserRequestTimeouts` sums navigation, settle,
 * selectors and scroll, and the Cheerio path allots `navigationTimeoutSecs`
 * alone. A page advertising three alternates behind a slow origin was measured
 * spending 15 s of a 10 s handler budget and failing a URL that the same crawl
 * with `markdownDiscovery: 'off'` returned in 194 ms — discovery turning a
 * succeeding page into a failing one. Five seconds is generous for a
 * speculative fetch whose miss costs nothing.
 */
const MARKDOWN_FETCH_TIMEOUT_MS = 5_000;

/**
 * Read a response body, or abandon the transfer once it passes `limit` bytes.
 *
 * Returns `undefined` for a body over the ceiling, which the caller reports as
 * one more non-fatal discovery miss — the same outcome the size gate in
 * {@link acceptMarkdownResponse} produces, reached before the bytes are paid for
 * rather than after. What makes it a bound rather than a verdict is abandoning
 * the read: leaving the loop closes the socket, so an origin serving an enormous
 * body stops being read from instead of running to completion into a buffer
 * nothing wants. `destroy()` is stated rather than left to the async-iterator
 * protocol's own `return()`, which was measured doing it anyway — the bound does
 * not rest on that.
 *
 * The count is of the bytes the stream yields, which are the decompressed ones —
 * got decompresses by default — so a small compressed body that expands past the
 * ceiling is refused on what it costs in memory rather than on what it cost on
 * the wire. Chunks are concatenated before they are decoded, so a multi-byte
 * character split across two of them survives.
 *
 * A read error is a miss too: the fetch is speculative, and a page that yields
 * nothing here is extracted from its HTML.
 */
async function readBoundedBody(stream: Readable, limit: number): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      size += bytes.length;
      if (size > limit) {
        stream.destroy();
        return undefined;
      }
      chunks.push(bytes);
    }
  } catch {
    stream.destroy();
    return undefined;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetch a candidate Markdown URL through Crawlee's own HTTP channel, which
 * carries the crawler's proxy and session, reading the body off the response
 * stream and stopping at {@link MAX_MARKDOWN_BYTES}.
 *
 * **Why the stream and not `sendRequest`.** `sendRequest` resolves with a
 * materialised body, so the ceiling could only ever reject bytes already
 * downloaded in full: an origin serving a `text/markdown` sibling of
 * 209,715,200 bytes was measured driving peak RSS from 149.2 MB to 387.9 MB
 * before the gate refused it — correctly, and far too late — at a cost linear in
 * a size the ORIGIN chooses and multiplied by `maxConcurrency`. `stream()` is
 * the other method of the same `BaseHttpClient` interface `sendRequest` runs on:
 * it returns once the response headers are in, with the body as a `Readable`,
 * and proxy and session ride the same options object, so the bound costs this
 * path none of its wiring. Refusing on a `content-length` over the ceiling would
 * not be a bound at all — the response that matters is chunked and declares
 * none. Measured on the same client and the same ceiling, a 200 MB chunked body
 * with no `content-length` now transfers 261,923 bytes at a peak of +18.6 MB.
 *
 * `throwHttpErrors: false` so a `406`, `415` or `404` arrives as a response to
 * be rejected rather than an exception to be retried: every one of those has
 * been observed live, and one 404 body measured a megabyte of `text/plain`.
 *
 * `followRedirect: false` because `safeAlternateUrl` checks the origin of the
 * URL it is GIVEN, and got follows ten hops by default. One `302` on an
 * advertised alternate was measured turning the same-origin guarantee into "any
 * host the page names", fetched through this crawler's session and proxy, with
 * `markdownSource.url` still naming the same-origin URL that was asked for. A
 * redirect now lands as a 3xx that {@link acceptMarkdownResponse} rejects on
 * status, which costs a same-origin redirect its discovery and is the right
 * trade on a path where every miss is non-fatal.
 *
 * The method is left to got, whose default is `GET`. Riding `sendRequest` took
 * the crawl request's own method instead, which would have sent a speculative
 * discovery `POST` on a POST-crawled page; a discovery fetch is a read of a
 * candidate URL and nothing else.
 */
function streamingMarkdownFetcher(
  client: BaseHttpClient,
  wiring: { proxyUrl?: string; sessionToken?: object },
  subFetchHeaders?: SubFetchHeaders,
): MarkdownFetcher {
  return async (url) => {
    const response = await client.stream({
      url,
      headers: { ...subFetchHeaders?.(url), accept: MARKDOWN_ACCEPT },
      // Inert beside `followRedirect: false`, and stated anyway so the pin travels
      // with the headers at every site rather than at the ones that need it today.
      ...subFetchOriginContext(subFetchHeaders),
      throwHttpErrors: false,
      followRedirect: false,
      timeout: { request: MARKDOWN_FETCH_TIMEOUT_MS },
      ...(wiring.proxyUrl === undefined ? {} : { proxyUrl: wiring.proxyUrl }),
      ...(wiring.sessionToken === undefined ? {} : { sessionToken: wiring.sessionToken }),
    });
    const body = await readBoundedBody(response.stream, MAX_MARKDOWN_BYTES);
    if (body === undefined) return undefined;
    return {
      statusCode: response.statusCode ?? 0,
      contentType: responseHeader(response, 'content-type') ?? '',
      body,
    };
  };
}

/**
 * The same fetch through a live browser page's request context, which shares the
 * browser's cookie jar. Used on the browser paths, where it is already the
 * channel consent recovery uses. Never reached on an HTTP-only adaptive run,
 * where touching `page` escalates the request into a browser render.
 *
 * `maxRedirects: 0` for the reason the HTTP fetcher pins it, and it matters more
 * here: Playwright's default is twenty hops and this channel carries the
 * browser's cookie jar.
 */
function pageRequestMarkdownFetcher(page: Page): MarkdownFetcher {
  return async (url) => {
    const response = await page.request.get(url, {
      headers: { accept: MARKDOWN_ACCEPT },
      failOnStatusCode: false,
      maxRedirects: 0,
      timeout: MARKDOWN_FETCH_TIMEOUT_MS,
    });
    return {
      statusCode: response.status(),
      contentType: response.headers()['content-type'] ?? '',
      body: await response.text(),
    };
  };
}

/** The log channel the discovery path writes to. Crawlee's `log` satisfies it. */
interface MarkdownLog {
  info(message: string): void;
  debug(message: string): void;
  warning(message: string): void;
}

/** Everything a handler needs to hand the shared resolver. */
interface MarkdownAttempt {
  opts: HandlerOpts;
  url: string;
  loadedUrl: string;
  html?: string;
  response?: unknown;
  pageResponse?: MarkdownResponse;
  alreadyNegotiated: boolean;
  fetch?: MarkdownFetcher;
  /**
   * The proxy this request already resolved, read from the crawling context
   * rather than allocated. Only the robots.txt gate uses it: every other
   * discovery fetch rides a channel that is already bound to this proxy.
   */
  proxyUrl?: string;
  log: MarkdownLog;
  checkCancelled?: () => void;
}

/** Resolve this page's served Markdown, or `undefined` to extract from HTML. */
async function findServedMarkdown(
  attempt: MarkdownAttempt,
): Promise<ServedMarkdownSource | undefined> {
  const rung = markdownRung(attempt.opts);
  if (rung === MarkdownDiscovery.Off) return undefined;
  const source = await resolveServedMarkdown({
    rung,
    url: attempt.url,
    loadedUrl: attempt.loadedUrl,
    ...(attempt.html !== undefined ? { html: attempt.html } : {}),
    ...(responseHeader(attempt.response, 'link') !== undefined
      ? { linkHeader: responseHeader(attempt.response, 'link') }
      : {}),
    ...(attempt.pageResponse !== undefined ? { pageResponse: attempt.pageResponse } : {}),
    alreadyNegotiated: attempt.alreadyNegotiated,
    ...(attempt.fetch !== undefined ? { fetch: attempt.fetch } : {}),
    budget: attempt.opts.markdownBudget ?? new OriginProbeBudget(),
    ...(attempt.opts.markdownRobots !== undefined
      ? {
          allowedByRobots: (url: string) =>
            attempt.opts.markdownRobots?.allows(url, attempt.proxyUrl, attempt.log) ??
            Promise.resolve(true),
        }
      : {}),
    ...(attempt.checkCancelled !== undefined ? { checkCancelled: attempt.checkCancelled } : {}),
    log: attempt.log,
  });
  if (source !== undefined) {
    attempt.log.info(
      `Using published Markdown for ${attempt.url}; source ${source.mechanism}: ${source.url}`,
    );
  }
  return source;
}

/** Whether this run's rung reaches `negotiate`, i.e. the page fetch asks for Markdown. */
function reachesNegotiate(opts: HandlerOpts): boolean {
  const rung = markdownRung(opts);
  return rung === MarkdownDiscovery.Negotiate || rung === MarkdownDiscovery.Probe;
}

/** Shared arguments for the two emit helpers below. */
interface EmitCommon {
  opts: HandlerOpts;
  url: string;
  loadedUrl: string;
  crawlDepth: number;
  referrerUrl: string | null;
  log: MarkdownLog;
  /** Abandons this run when the crawler has already failed its request. */
  checkCancelled?: () => void;
}

/**
 * Emit one page rendered from an origin's own Markdown.
 *
 * Deduplication runs exactly as on the HTML path, over the same `dedupeText`, so
 * the aggressive mode still catches a page that repeats within this crawl. It
 * cannot catch the same page arriving once as Markdown and once as extracted
 * HTML: the two representations genuinely differ, which the option's
 * documentation states rather than papering over.
 *
 * A Markdown-sourced page still enqueues links, and they come from its HTML
 * document rather than from the served body. That ordering is the safety
 * property, not a side effect: one measured origin answers the site's llms.txt
 * index for a root-path Markdown request, and those links must never be followed
 * as though they were the page's. The one case with nothing to enqueue from is a
 * page whose own fetch returned Markdown, where there is no document to run the
 * selector against.
 */
async function emitServedMarkdown(
  args: EmitCommon & {
    extractor: ContentExtractor;
    served: ServedMarkdownSource;
    statusCode?: number;
  },
): Promise<boolean | 'unusable'> {
  const { opts, served, url, loadedUrl, crawlDepth, referrerUrl, log } = args;
  // Rendering a served body can still fail after validation accepted it: the
  // body is bounded at its own cap, but Markdown expands on the way to HTML and
  // the engine rejects anything past its input ceiling. Failing the request
  // there would lose a page ordinary HTML extraction would have returned, so
  // this reports `unusable` and the caller falls through to that path — the same
  // non-fatal shape the image pipeline already has.
  let rendered: Awaited<ReturnType<typeof extractServedMarkdown>>;
  try {
    rendered = await extractServedMarkdown(
      args.extractor,
      served,
      url,
      opts.formats,
      pageOutputContext(url, loadedUrl, crawlDepth, referrerUrl, args.statusCode),
      opts.outputLayout ?? 'minimal',
    );
  } catch (error) {
    log.warning(
      `Rendering the published Markdown failed for ${url} (${String(error)}); ` +
        'continuing with HTML extraction.',
    );
    return 'unusable';
  }
  const { extracted, html } = rendered;

  if (opts.deduplication === 'aggressive') {
    const text = extracted.dedupeText;
    if (text.length > 0) {
      const { hash } = computeContentInfo(text);
      if (opts.seenContentHashes.has(hash)) {
        log.info(`Skipping ${url} — duplicate content hash`);
        return false;
      }
      opts.seenContentHashes.add(hash);
    }
  }

  const { hash: rawHtmlHash, length: rawHtmlLength } = computeContentInfo(html);
  args.checkCancelled?.();
  await opts.sink({
    url: extracted.outputContext.url ?? url,
    html,
    metadata: extracted.outputContext.metadata,
    crawl: extracted.outputContext.crawl,
    formats: extracted.formats,
    rawHtmlHash,
    rawHtmlLength,
    markdownSource: { mechanism: served.mechanism, url: served.url, verbatim: rendered.verbatim },
  });
  return true;
}

/**
 * Emit one page from an HTML string that no Cheerio document was produced for.
 *
 * Reached only by the Cheerio path's Markdown-rejection recovery, where the
 * response Crawlee parsed was Markdown-typed and there is therefore no `$`.
 */
async function emitExtractedHtml(
  args: EmitCommon & {
    extractor: ContentExtractor;
    html: string;
    statusCode?: number;
    fetcher?: ImageFetcher;
  },
): Promise<boolean> {
  const { opts, html, url, loadedUrl, crawlDepth, referrerUrl, log } = args;
  if (opts.deduplication !== 'minimal') {
    const { skip, canonical } = checkAndRecordCanonical(html, url, opts.seenCanonicals);
    if (skip) {
      log.info(`Skipping ${url} — duplicate of canonical ${canonical}`);
      return false;
    }
  }

  const { hash: rawHtmlHash, length: rawHtmlLength } = computeContentInfo(html);
  const { extracted, images } = await runExtraction(
    args.extractor,
    html,
    url,
    opts,
    args.fetcher,
    log,
    pageOutputContext(url, loadedUrl, crawlDepth, referrerUrl, args.statusCode),
    args.checkCancelled,
  );

  if (opts.deduplication === 'aggressive') {
    const text = extracted.dedupeText;
    if (text.length > 0) {
      const { hash } = computeContentInfo(text);
      if (opts.seenContentHashes.has(hash)) {
        log.info(`Skipping ${url} — duplicate content hash`);
        return false;
      }
      opts.seenContentHashes.add(hash);
    }
  }

  args.checkCancelled?.();
  await opts.sink({
    url: extracted.outputContext.url ?? url,
    html,
    metadata: extracted.outputContext.metadata,
    crawl: extracted.outputContext.crawl,
    formats: extracted.formats,
    rawHtmlHash,
    rawHtmlLength,
    ...(images !== undefined ? { images } : {}),
  });
  return true;
}

function checkAndRecordCanonical(
  html: string,
  url: string,
  seenCanonicals: Set<string>,
): { skip: boolean; canonical?: string } {
  const canonicalMatch =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ??
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  const canonical = canonicalMatch?.[1];
  if (canonical === undefined) return { skip: false };
  if (canonical !== url && seenCanonicals.has(canonical)) {
    return { skip: true, canonical };
  }
  seenCanonicals.add(canonical);
  return { skip: false, canonical };
}

export function createHandler(opts: HandlerOpts): RequestHandler<PlaywrightCrawlingContext> {
  const extractor = new ContentExtractor(opts.extractionConfig);
  const markdownExtractor = servedMarkdownExtractor(opts);
  let resultCount = 0;

  const run = async (context: PlaywrightCrawlingContext): Promise<void> => {
    const { page, request, log } = context;
    const url = request.url;
    let loadedUrl = request.loadedUrl ?? request.url;
    const crawlDepth = typeof request.userData?.depth === 'number' ? request.userData.depth : 0;
    const referrerUrl =
      typeof request.userData?.referrerUrl === 'string' ? request.userData.referrerUrl : null;
    const checkCancelled = (): void => opts.cancellation?.throwIfCancelled(context.id, url);
    log.info(`Processing ${url}`);

    if (opts.maxResults && resultCount >= opts.maxResults) {
      log.info(`Max results (${opts.maxResults}) reached, stopping.`);
      return;
    }

    let recoveredDocument: CheerioAPI | undefined;
    // A browser may be redirected into a consent/login flow even when the same
    // crawler session can fetch the requested document without running its
    // JavaScript. When the redirect carries a validated return target, try that
    // bounded channel once before interacting with the wall. This is
    // provider-neutral and rides `page.request` — the browser context's own
    // fetcher, as the adaptive twin does — so the fetch inherits that context's
    // proxy, cookie jar, User-Agent and extra headers by construction. Crawlee's
    // `sendRequest` would not: this branch never writes `request.headers`, and
    // its client discards the session jar, so the fetch went out with a
    // fabricated User-Agent and no cookies behind a navigation that carried the
    // caller's.
    if (opts.stripConsent) {
      const currentPageUrl = page.url();
      if (hasMatchingReturnTarget(url, currentPageUrl)) {
        const currentDocument = await context.parseWithCheerio();
        const recovered = await tryRecoverRedirectedArticle(
          currentDocument,
          url,
          currentPageUrl,
          async (recoveryUrl) => {
            const response = await page.request.get(recoveryUrl, { failOnStatusCode: false });
            return {
              body: await response.text(),
              url: response.url(),
              statusCode: response.status(),
            };
          },
          log,
        );
        if (recovered !== undefined) {
          recoveredDocument = recovered.$;
          loadedUrl = recovered.loadedUrl;
        }
      }
      if (recoveredDocument === undefined) {
        loadedUrl = await recoverConsentWallOnPage(page, url, loadedUrl, log);
      }
    }

    let html: string;
    if (recoveredDocument !== undefined) {
      // The live page still holds the wall, so the page-based waits below are
      // skipped and cannot enforce the required selector. It is a validation
      // contract whose absence must fail the request, so it is checked against
      // the recovered markup instead — the post-condition the adaptive handler
      // applies at the same point, and before the strip, which can remove a
      // matching node. It stays above the Markdown discovery block for the same
      // reason `page.waitForSelector` does on the other arm: the browser branch
      // holds the page's own HTML and is gated on it.
      requireSelectorInDocument(recoveredDocument, opts.waitForSelector);
      stripConsentFromCheerio(recoveredDocument);
      html = recoveredDocument.html() ?? '';
    } else {
      if (opts.scroll) {
        await autoScroll(context, opts.scroll);
      }

      if (opts.waitForDynamicContentSecs && opts.waitForDynamicContentSecs > 0) {
        await page
          .waitForLoadState('networkidle', { timeout: opts.waitForDynamicContentSecs * 1000 })
          .catch(() => {});
      }

      const timeout = selectorTimeoutMs(opts);

      if (opts.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout });
      }
      if (opts.softWaitForSelector) {
        await page.waitForSelector(opts.softWaitForSelector, { timeout }).catch(() => {});
      }

      if (opts.stripConsent) await stripConsentFromPage(page);

      html = await page.content();
    }
    rejectUnresolvedConsentRedirect(
      url,
      recoveredDocument === undefined ? page.url() : loadedUrl,
      log,
    );

    // The page HTML is already in hand, so the advertised-alternate rung costs
    // no discovery request here. A browser is never navigated to a Markdown URL:
    // Chromium renders one inline but `page.content()` returns it HTML-escaped,
    // and an origin sending `Content-Disposition: attachment` makes `page.goto`
    // throw outright. The second fetch goes through the page's own request
    // context, the same channel consent recovery already uses.
    if (markdownExtractor !== undefined) {
      const served = await findServedMarkdown({
        opts,
        url,
        loadedUrl,
        html,
        response: context.response,
        alreadyNegotiated: false,
        fetch: pageRequestMarkdownFetcher(page),
        proxyUrl: context.proxyInfo?.url,
        log,
        checkCancelled,
      });
      if (served !== undefined) {
        const emitted = await emitServedMarkdown({
          opts,
          extractor: markdownExtractor,
          served,
          url,
          loadedUrl,
          crawlDepth,
          referrerUrl,
          statusCode: observedStatusCode(context.response),
          log,
          checkCancelled,
        });
        // `unusable` means the served body could not be rendered; fall through
        // to ordinary HTML extraction rather than losing the page.
        if (emitted !== 'unusable') {
          if (emitted) {
            resultCount += 1;
            if (opts.maxResults && resultCount >= opts.maxResults) {
              log.info(`Max results (${opts.maxResults}) reached, stopping crawler.`);
              throw new Error('MAX_RESULTS_REACHED');
            }
          }
          if (opts.selector) {
            checkCancelled();
            await enqueueLinks(context, opts);
          }
          return;
        }
      }
    }

    if (opts.deduplication !== 'minimal') {
      const { skip, canonical } = checkAndRecordCanonical(html, url, opts.seenCanonicals);
      if (skip) {
        log.info(`Skipping ${url} — duplicate of canonical ${canonical}`);
        return;
      }
    }

    const { hash: rawHtmlHash, length: rawHtmlLength } = computeContentInfo(html);
    // One engine pass per page: the extractor cleans the HTML once, then renders
    // every requested format from that single cleaned string. In save mode the
    // image byte pipeline runs between the two steps, fetching through the live
    // page context (same session/headers as the page itself).
    const fetcher = opts.images ? playwrightImageFetcher(page, loadedUrl) : undefined;
    const { extracted, images } = await runExtraction(
      extractor,
      html,
      url,
      opts,
      fetcher,
      log,
      pageOutputContext(
        url,
        loadedUrl,
        crawlDepth,
        referrerUrl,
        observedStatusCode(context.response),
      ),
      checkCancelled,
    );
    const formats = extracted.formats;

    if (opts.deduplication === 'aggressive') {
      const extractedText = extracted.dedupeText;
      if (extractedText.length > 0) {
        const { hash: contentHash } = computeContentInfo(extractedText);
        if (opts.seenContentHashes.has(contentHash)) {
          log.info(`Skipping ${url} — duplicate content hash`);
          return;
        }
        opts.seenContentHashes.add(contentHash);
      }
    }

    checkCancelled();
    await opts.sink({
      url: extracted.outputContext.url ?? url,
      html,
      metadata: extracted.outputContext.metadata,
      crawl: extracted.outputContext.crawl,
      formats,
      rawHtmlHash,
      rawHtmlLength,
      ...(images !== undefined ? { images } : {}),
    });

    resultCount += 1;

    if (opts.maxResults && resultCount >= opts.maxResults) {
      log.info(`Max results (${opts.maxResults}) reached, stopping crawler.`);
      throw new Error('MAX_RESULTS_REACHED');
    }

    if (opts.selector) {
      checkCancelled();
      await enqueueLinks(context, opts);
    }
  };
  return withRunCancellation(opts.cancellation, run);
}

async function enqueueLinks(context: PlaywrightCrawlingContext, opts: HandlerOpts): Promise<void> {
  const rawDepth = context.request.userData?.depth;
  const currentDepth = typeof rawDepth === 'number' ? rawDepth : 0;
  if (
    opts.maxCrawlDepth !== undefined &&
    opts.maxCrawlDepth !== 0 &&
    currentDepth >= opts.maxCrawlDepth
  ) {
    return;
  }
  const newDepth = currentDepth + 1;
  const referrerUrl = context.request.url;
  const globs = opts.globs?.filter(Boolean) ?? [];
  const exclude = opts.exclude?.filter(Boolean) ?? [];
  await context.enqueueLinks({
    selector: opts.selector,
    ...(globs.length > 0 ? { globs } : {}),
    ...(exclude.length > 0 ? { exclude: exclude } : {}),
    userData: { depth: newDepth, referrerUrl },
    transformRequestFunction: (request) => {
      request.keepUrlFragment = opts.keepUrlFragment ?? false;
      return request;
    },
    ...(opts.onSkippedUrl
      ? { onSkippedRequest: ({ url, reason }) => opts.onSkippedUrl?.(url, reason) }
      : {}),
  });
}

export function createCheerioHandler(opts: HandlerOpts): RequestHandler<CheerioCrawlingContext> {
  const extractor = new ContentExtractor(opts.extractionConfig);
  const markdownExtractor = servedMarkdownExtractor(opts);
  let resultCount = 0;

  const run = async (context: CheerioCrawlingContext): Promise<void> => {
    const { request, log } = context;
    const url = request.url;
    // Bound to the URL the crawl asked for rather than to `loadedUrl`: that is the
    // scope a cookie given without a domain was normalized against, and re-binding it
    // to a redirect's destination would re-point the credential at that host.
    const subFetchHeaders = bindSubFetchHeaders(opts.subFetchHeaders, url);
    let loadedUrl = request.loadedUrl ?? request.url;
    const crawlDepth = typeof request.userData?.depth === 'number' ? request.userData.depth : 0;
    const referrerUrl =
      typeof request.userData?.referrerUrl === 'string' ? request.userData.referrerUrl : null;
    const checkCancelled = (): void => opts.cancellation?.throwIfCancelled(context.id, url);
    log.info(`Processing ${url}`);

    if (opts.maxResults && resultCount >= opts.maxResults) {
      log.info(`Max results (${opts.maxResults}) reached, stopping.`);
      return;
    }

    // The Markdown branch runs ABOVE every `context.$` access, and that ordering
    // is a hard requirement rather than a preference: `$` is `undefined` — not a
    // broken function — for a response Crawlee admitted through
    // `additionalMimeTypes`, so `context.$` below would throw
    // `TypeError: $ is not a function` on every negotiated page. The body also
    // arrives as a `Buffer` on those responses, which `decodeBody` handles.
    //
    // A page currently sitting on a consent redirect is exempt, and has to be:
    // this branch runs before consent recovery (which needs `$`), so acting on
    // it here would emit a wall's own representation as though it were the page
    // — the one thing `SPEC.md` says no path may do — and would skip the
    // recovery that rescues the article. Such a page takes the ordinary path and
    // is discovered on a later attempt, or not at all.
    const onConsentRedirect = opts.stripConsent && hasMatchingReturnTarget(url, loadedUrl);
    if (markdownExtractor !== undefined && !onConsentRedirect) {
      const pageResponse = pageResponseAsMarkdown(context.response, context.body);
      const served = await findServedMarkdown({
        opts,
        url,
        loadedUrl,
        // The page HTML is only readable when the response WAS HTML; a Markdown
        // response has no parsed document, which is also why a rejected Markdown
        // body costs a re-fetch below.
        ...(pageResponse === undefined ? { html: context.body?.toString() } : {}),
        response: context.response,
        ...(pageResponse !== undefined ? { pageResponse } : {}),
        // This path sets the ordered Accept on the page fetch itself, so a
        // response that came back as something else is the origin's answer.
        alreadyNegotiated: reachesNegotiate(opts),
        // The crawler's own client rather than `context.sendRequest`, because the
        // transfer has to be bounded and only `stream()` can bound it. What
        // `sendRequest` adds over a bare client call is this request's proxy and
        // session token, both of which the context carries and both of which are
        // restated here; the cookie jar it also passes is not among them, since
        // `GotScrapingHttpClient` nulls that on every call, and neither are the
        // caller's transferable headers, which the origin request carried and a
        // bare client call cannot see — hence the third argument. A handler built
        // outside `createMarkdowneeCrawler` — which is how the co-located
        // tests drive these handlers — gets the client Crawlee itself would have
        // defaulted to, so discovery keeps working there rather than silently
        // switching off.
        fetch: streamingMarkdownFetcher(
          opts.httpClient ?? new GotScrapingHttpClient(),
          {
            ...(context.proxyInfo?.url === undefined ? {} : { proxyUrl: context.proxyInfo.url }),
            ...(context.session === undefined ? {} : { sessionToken: context.session }),
          },
          subFetchHeaders,
        ),
        proxyUrl: context.proxyInfo?.url,
        log,
        checkCancelled,
      });

      if (served !== undefined) {
        const emitted = await emitServedMarkdown({
          opts,
          extractor: markdownExtractor,
          served,
          url,
          loadedUrl,
          crawlDepth,
          referrerUrl,
          statusCode: observedStatusCode(context.response),
          log,
          checkCancelled,
        });
        // `unusable` means the served body could not be rendered; fall through
        // to ordinary extraction rather than losing the page.
        if (emitted !== 'unusable') {
          if (emitted) {
            resultCount += 1;
            if (opts.maxResults && resultCount >= opts.maxResults) {
              log.info(`Max results (${opts.maxResults}) reached, stopping crawler.`);
              throw new Error('MAX_RESULTS_REACHED');
            }
          }
          // Links come from the page's HTML document, never from the served
          // Markdown. `pageResponse` being set means the page fetch ITSELF
          // returned Markdown, so there is no document to run the selector
          // against and nothing is enqueued; otherwise the HTML is in hand and
          // link-following continues exactly as it would have.
          if (opts.selector && pageResponse === undefined) {
            checkCancelled();
            await enqueueLinksCheerio(context, opts);
          }
          return;
        }
      }

      if (pageResponse !== undefined) {
        // A Markdown-typed response that validation rejected leaves NO parsed
        // document to fall back on — `context.$` is `undefined` for it, and Read
        // the Docs really does serve an HTML body under `text/markdown`.
        // Recovery therefore costs a full second request, which is the honest
        // cost of the `negotiate` rung when it misses.
        //
        // The recovered markup is extracted from the string rather than through
        // Cheerio, so this one path does not run the Cheerio consent strip: the
        // only parser available is Crawlee's own `$`, which this response never
        // produced, and the package cannot import `cheerio` directly because
        // Crawlee pins `1.0.0-rc.12` against the `1.2.0` this workspace
        // resolves. The trade is bounded and logged — it is reachable only on
        // the Cheerio crawler, only above the `alternate` rung, and only against
        // an origin that mislabels its own Markdown.
        log.warning(
          `Requesting HTML again for ${url}: the Markdown-labeled body failed validation. ` +
            'This response bypasses consent-container removal.',
        );
        const recovered = await context
          .sendRequest<string>({
            url,
            headers: { ...subFetchHeaders?.(url), accept: 'text/html' },
            // Same URL as the page fetch, so this only restates what the request's
            // own URL already says — stated for the same reason as above.
            ...subFetchOriginContext(subFetchHeaders),
            throwHttpErrors: false,
          })
          .catch(() => undefined);
        // The recovery has to clear the same status gate every other fetch does.
        // Taking whatever came back put a `404` error page and a `503` "slow
        // down" body into the dataset as the page's content.
        const recoveredStatus = recovered?.statusCode ?? 0;
        const recoveredHtml =
          recoveredStatus >= 200 && recoveredStatus < 300 ? decodeBody(recovered?.body) : undefined;
        // A recovery that fails is not fatal. The mislabelled body is still in
        // hand and on every origin measured it IS the HTML document the origin
        // typed wrong, so falling back to it extracts the page that turning the
        // rung off would have extracted. Throwing here failed the whole request
        // for a page the `off` default handles fine — the one non-recoverable
        // exit the feature had.
        const fallbackHtml =
          recoveredHtml !== undefined && recoveredHtml !== '' ? recoveredHtml : pageResponse.body;
        const emitted = await emitExtractedHtml({
          opts,
          extractor,
          html: fallbackHtml,
          url,
          loadedUrl,
          crawlDepth,
          referrerUrl,
          statusCode: recoveredHtml !== undefined ? recovered?.statusCode : pageResponse.statusCode,
          fetcher: opts.images
            ? sendRequestImageFetcher(context.sendRequest.bind(context), loadedUrl, subFetchHeaders)
            : undefined,
          log,
          checkCancelled,
        });
        if (emitted) {
          resultCount += 1;
          if (opts.maxResults && resultCount >= opts.maxResults) {
            log.info(`Max results (${opts.maxResults}) reached, stopping crawler.`);
            throw new Error('MAX_RESULTS_REACHED');
          }
        }
        return;
      }
    }

    let $ = context.$;
    if (opts.stripConsent && hasMatchingReturnTarget(url, loadedUrl)) {
      const recovered = await tryRecoverRedirectedArticle(
        $,
        url,
        loadedUrl,
        (recoveryUrl) => context.sendRequest<string>({ url: recoveryUrl }),
        log,
      );
      if (recovered === undefined) {
        failUnresolvedConsentRedirect(url, log);
      }
      $ = recovered.$;
      loadedUrl = recovered.loadedUrl;
    }

    // This crawler runs no JavaScript, so there is nothing to wait for: the
    // required selector is a validation contract, and on an HTTP-only path it
    // means the served document must already carry it. Crawlee reads it the same
    // way on its own HTTP-only branch, and the message matches so all four
    // crawler types fail identically.
    //
    // The position is the adaptive handler's own: below any consent recovery,
    // because a wall that replaced the article would fail an article selector
    // with the article never fetched; above the CMP strip, because a selector
    // the served document really did carry must not be judged after part of that
    // document has been removed. A page whose own fetch returned Markdown is
    // settled far above this and is never asked for an HTML selector.
    requireSelectorInDocument($, opts.waitForSelector);

    if (opts.stripConsent) stripConsentFromCheerio($);

    const html = $('html').prop('outerHTML') ?? '';
    rejectUnresolvedConsentRedirect(url, loadedUrl, log);

    if (opts.deduplication !== 'minimal') {
      const { skip, canonical } = checkAndRecordCanonical(html, url, opts.seenCanonicals);
      if (skip) {
        log.info(`Skipping ${url} — duplicate of canonical ${canonical}`);
        return;
      }
    }

    const { hash: rawHtmlHash, length: rawHtmlLength } = computeContentInfo(html);
    // One engine pass per page: the extractor cleans the HTML once, then renders
    // every requested format from that single cleaned string. In save mode the
    // image byte pipeline fetches through Crawlee's sendRequest (the crawler's
    // own HTTP client: same session and proxy).
    const fetcher = opts.images
      ? sendRequestImageFetcher(context.sendRequest.bind(context), loadedUrl, subFetchHeaders)
      : undefined;
    const { extracted, images } = await runExtraction(
      extractor,
      html,
      url,
      opts,
      fetcher,
      log,
      pageOutputContext(
        url,
        loadedUrl,
        crawlDepth,
        referrerUrl,
        observedStatusCode(context.response),
      ),
      checkCancelled,
    );
    const formats = extracted.formats;

    if (opts.deduplication === 'aggressive') {
      const extractedText = extracted.dedupeText;
      if (extractedText.length > 0) {
        const { hash: contentHash } = computeContentInfo(extractedText);
        if (opts.seenContentHashes.has(contentHash)) {
          log.info(`Skipping ${url} — duplicate content hash`);
          return;
        }
        opts.seenContentHashes.add(contentHash);
      }
    }

    checkCancelled();
    await opts.sink({
      url: extracted.outputContext.url ?? url,
      html,
      metadata: extracted.outputContext.metadata,
      crawl: extracted.outputContext.crawl,
      formats,
      rawHtmlHash,
      rawHtmlLength,
      ...(images !== undefined ? { images } : {}),
    });

    resultCount += 1;

    if (opts.maxResults && resultCount >= opts.maxResults) {
      log.info(`Max results (${opts.maxResults}) reached, stopping crawler.`);
      throw new Error('MAX_RESULTS_REACHED');
    }

    if (opts.selector) {
      checkCancelled();
      await enqueueLinksCheerio(context, opts);
    }
  };
  return withRunCancellation(opts.cancellation, run);
}

/**
 * The page-level half of `createHandler`'s rendering waits — scroll, then the
 * bounded network settle — adapted to the restricted adaptive context.
 *
 * Kept separate from the selector waits because these are what give a consent
 * wall time to appear, so the wall check has to run between the two halves. Both
 * need a real page, so they read `context.page`; in an HTTP-only run that throws,
 * which is Crawlee's escalation to a browser and the right outcome, because a
 * caller that configured a browser wait needs a browser.
 */
async function applyAdaptivePageWaits(
  context: LoadedContext<AdaptivePlaywrightCrawlerContext>,
  opts: HandlerOpts,
): Promise<void> {
  const configuredSettleMs = (opts.waitForDynamicContentSecs ?? 0) * 1000;
  if (!opts.scroll && configuredSettleMs <= 0) return;

  const page = context.page;
  if (opts.scroll) {
    // Bounded by `maxScrollHeight` alone, as Apify's own scrapers bound it. The
    // waits run once each now, so there is no budget for a scroll to overspend.
    await playwrightUtils.infiniteScroll(page, {
      maxScrollHeight: opts.scroll.maxScrollHeight,
      waitForSecs: opts.scroll.waitForSecs ?? 2,
    });
  }

  if (configuredSettleMs > 0) {
    // Soft and bounded, exactly as `createHandler` uses it: `networkidle` never
    // settles on a page with continuous beacons, so a timeout here is expected
    // and ignored rather than treated as a failure.
    await page.waitForLoadState('networkidle', { timeout: configuredSettleMs }).catch(() => {});
  }
}

/**
 * The selector half of the rendering waits, run only once the page has settled
 * and any consent wall has been dealt with.
 *
 * Order matters: a wall that appears while the page settles removes the article,
 * so a required article selector can never resolve. Running this first would let
 * that rejection fail the request and hide the wall entirely, which is why the
 * wall check sits between the page waits and these.
 *
 * `context.waitForSelector` works in both rendering modes; in an HTTP-only run it
 * throws when the selector is absent from the static HTML, which is Crawlee's
 * designed escalation to a browser.
 */
async function applyAdaptiveSelectorWaits(
  context: LoadedContext<AdaptivePlaywrightCrawlerContext>,
  opts: HandlerOpts,
): Promise<Error | undefined> {
  // Each selector gets its own configured timeout, exactly as the non-adaptive
  // Playwright handler grants them, so a separately configured wait is never
  // truncated. Each runs at most once per handler invocation, so the caller's
  // configured budget is also the worst case.
  const timeout = selectorTimeoutMs(opts);
  let pending: Error | undefined;
  if (opts.waitForSelector) {
    // Returned rather than thrown so the caller can run its consent check first.
    // A wall appearing during this very wait removes the article and makes the
    // selector unresolvable, and letting the rejection escape here would fail the
    // request with the wall unexamined. The caller rethrows this once it has
    // confirmed no wall explains it.
    try {
      await context.waitForSelector(opts.waitForSelector, timeout);
    } catch (error) {
      pending = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (opts.softWaitForSelector) {
    await context.waitForSelector(opts.softWaitForSelector, timeout).catch(() => {});
  }
  return pending;
}

export function createAdaptiveHandler(
  opts: HandlerOpts,
): (ctx: LoadedContext<AdaptivePlaywrightCrawlerContext>) => Promise<void> {
  const extractor = new ContentExtractor(opts.extractionConfig);
  const markdownExtractor = servedMarkdownExtractor(opts);
  let resultCount = 0;
  // Crawlee runs this handler more than once for a single request: during
  // rendering-type detection the browser pass is committed and a plain-HTTP pass
  // then runs only so the two can be compared, and on a mispredicted static page
  // the HTTP pass runs before the browser rerun. Its own types warn that a
  // handler "must refrain from calling code with side effects, other than the
  // methods of the crawling context. Any other side effects may be invoked
  // repeatedly by the crawler, which can lead to inconsistent results." The sink
  // is such a side effect, and `SPEC.md` allows one result per page, so a
  // request that already reached the sink never reaches it twice.
  //
  // Emission and completion are tracked separately on purpose. Work that follows
  // the sink — the max-results stop and link enqueueing — can still throw, and
  // Crawlee then retries the whole request. Only a request whose handler ran to
  // completion short-circuits; a request that emitted but did not finish resumes
  // at exactly the work that is left.
  const emitted = new Set<string>();
  const completed = new Set<string>();

  // Everything after the sink, so a retry can reach it without replaying the
  // capture, deduplication, and extraction that already produced the result.
  const finishRequest = async (
    context: LoadedContext<AdaptivePlaywrightCrawlerContext>,
    key: string,
    log: { info: (message: string) => void },
    /**
     * Whether the document this request parsed is the page's HTML. False on the
     * HTTP-only branch when the page fetch itself returned Markdown: the parsed
     * document is then the served body, and enqueueing from it would follow raw
     * anchors inside third-party Markdown as though they were the page's own
     * links — the hazard one measured origin walks straight into by answering
     * its llms.txt index for a root-path Markdown request.
     */
    enqueueFrom = true,
  ): Promise<void> => {
    if (opts.maxResults && resultCount >= opts.maxResults) {
      log.info(`Max results (${opts.maxResults}) reached, stopping crawler.`);
      throw new Error('MAX_RESULTS_REACHED');
    }
    if (opts.selector && enqueueFrom) {
      opts.cancellation?.throwIfCancelled(context.id, context.request.url);
      await enqueueLinksAdaptive(context, opts);
    }
    completed.add(key);
  };

  const run = async (context: LoadedContext<AdaptivePlaywrightCrawlerContext>): Promise<void> => {
    const { request, log } = context;
    const url = request.url;
    // See the Cheerio handler: bound to the requested URL, not to `loadedUrl`.
    const subFetchHeaders = bindSubFetchHeaders(opts.subFetchHeaders, url);
    const checkCancelled = (): void => opts.cancellation?.throwIfCancelled(context.id, url);
    if (completed.has(requestKey(request))) {
      log.debug(`Skipping ${url} — an earlier run of this request already completed`);
      return;
    }
    // Emitted but unfinished: a previous attempt reached the sink and then threw.
    // Resume at the remaining work rather than replaying the handler, which would
    // otherwise stop at this request's own canonical or content-hash claim and
    // silently drop the links it never enqueued.
    if (emitted.has(requestKey(request))) {
      // Hitting the result limit is a successful stop, not a defect in this
      // request. `finishRequest` rethrows `MAX_RESULTS_REACHED` every time it
      // runs, so a resumed request would throw on each retry until Crawlee gave
      // up and recorded a failure for a page that was already emitted. Once the
      // limit is reached there is nothing left to resume, so settle instead.
      if (opts.maxResults && resultCount >= opts.maxResults) {
        log.info(`Max results (${opts.maxResults}) reached, stopping.`);
        completed.add(requestKey(request));
        return;
      }
      log.debug(`Resuming ${url} — an earlier run emitted it but did not finish`);
      await finishRequest(context, requestKey(request), log);
      return;
    }
    let loadedUrl = request.loadedUrl ?? request.url;
    const crawlDepth = typeof request.userData?.depth === 'number' ? request.userData.depth : 0;
    const referrerUrl =
      typeof request.userData?.referrerUrl === 'string' ? request.userData.referrerUrl : null;
    log.info(`Processing ${url}`);

    if (opts.maxResults && resultCount >= opts.maxResults) {
      log.info(`Max results (${opts.maxResults}) reached, stopping.`);
      return;
    }

    // A page whose OWN fetch returned Markdown is settled here, above every wait
    // and above the selector post-condition, and it is the only page that is.
    //
    // This branch's page fetch carries the ordered Accept (set on
    // `request.headers` in the pre-navigation hook), so an origin that publishes
    // Markdown answers it with the served body — which Crawlee still hands over
    // as `load(response.body)`, whatever the content type. The parsed document is
    // therefore the Markdown, not the page's HTML, and an HTML `waitForSelector`
    // can never match it. Left below the waits, that impossible match rejects,
    // and Crawlee reads any error out of this handler as a request to rerun in a
    // browser: measured over three trials of twenty pages, configuring the
    // selector took browser renders from four to twenty of twenty and escalated
    // every HTTP-only attempt. The fast path is not degraded, it is eliminated
    // for the origin, at one render per page.
    //
    // So the gate is WAIVED here rather than relocated — there is no document it
    // could be checked against — and `SPEC.md` carries that exemption. It stops
    // at this branch. The browser branch holds the page's own HTML, checks the
    // selector against it, and only then emits any Markdown it discovered; the
    // page waits are waived on the same ground, since a served body has no DOM to
    // scroll or settle and reaching for a page to scroll would itself be the
    // escalation this branch exists to avoid.
    //
    // A page sitting on a consent redirect is exempt from the exemption, as it is
    // on the Cheerio branch above: acting on it here would emit a wall's own
    // representation as though it were the page and skip the recovery that
    // rescues the article. Unlike that branch the test is not gated on
    // `stripConsent`, because this path's `rejectUnresolvedConsentRedirect` is
    // not either — a run with consent handling off still fails such a page rather
    // than emitting it, which is the contract for every wall. So it takes the
    // ordinary path: with recovery on that begins by reading `page` and therefore
    // escalates, and with recovery off it reaches the rejection below.
    if (markdownExtractor !== undefined && adaptivePage(context) === undefined) {
      const pageResponse = pageResponseAsMarkdown(context.response);
      if (pageResponse !== undefined && !hasMatchingReturnTarget(url, loadedUrl)) {
        const served = await findServedMarkdown({
          opts,
          url,
          loadedUrl,
          response: context.response,
          pageResponse,
          // The page fetch itself asked, so a body that came back as something
          // else is the origin's answer rather than a rung still to try. No
          // `html` and no `fetch` are passed: with the served body in hand,
          // discovery resolves from it before it reads either, and this branch
          // has no channel a further rung could ride.
          alreadyNegotiated: reachesNegotiate(opts),
          // Inert here today, and wired anyway: passing no `fetch` means
          // discovery short-circuits before it consults robots.txt at all, so
          // this site issues no lookup to proxy. Kept so the site does not
          // silently re-leak if it ever gains a fetch channel.
          proxyUrl: context.proxyInfo?.url,
          log,
          checkCancelled,
        });
        if (served !== undefined) {
          const wasEmitted = await emitServedMarkdown({
            opts,
            extractor: markdownExtractor,
            served,
            url,
            loadedUrl,
            crawlDepth,
            referrerUrl,
            statusCode: observedStatusCode(context.response),
            log,
            checkCancelled,
          });
          // `unusable` means the served body could not be rendered. Nothing was
          // served after all, so the page is an ordinary one: fall through to the
          // waits, the gate, and HTML extraction rather than lose it.
          if (wasEmitted !== 'unusable') {
            if (wasEmitted) {
              emitted.add(requestKey(request));
              resultCount += 1;
            }
            // Never enqueue from the served body: its anchors are the Markdown's,
            // not the page's, and one measured origin answers its llms.txt index
            // for a root-path Markdown request.
            await finishRequest(context, requestKey(request), log, false);
            return;
          }
        }
      }
    }

    let $ = await context.parseWithCheerio();
    // Whether the article arrived over the crawler's HTTP channel rather than from
    // the live page. That is the one case the waits below must skip: the live page
    // still shows the wall, so they would act on the wrong document.
    let recoveredOverHttp = false;
    // Recover a content-replacing consent wall (escalates an HTTP-only run to a
    // browser render, accepts the wall, re-fetches the article); a no-op when the
    // parsed HTML is already the article. Fails the request on an unclearable wall.
    if (opts.stripConsent) {
      if (hasMatchingReturnTarget(url, loadedUrl)) {
        const page = context.page;
        const recovered = await tryRecoverRedirectedArticle(
          $,
          url,
          loadedUrl,
          async (recoveryUrl) => {
            const response = await page.request.get(recoveryUrl, { failOnStatusCode: false });
            return {
              body: await response.text(),
              url: response.url(),
              statusCode: response.status(),
            };
          },
          log,
        );
        if (recovered !== undefined) {
          $ = recovered.$;
          loadedUrl = recovered.loadedUrl;
          recoveredOverHttp = true;
        } else {
          ({ $, loadedUrl } = await recoverConsentWallAdaptive(context, $, url, loadedUrl, log));
        }
      } else {
        ({ $, loadedUrl } = await recoverConsentWallAdaptive(context, $, url, loadedUrl, log));
      }
    }

    // Rendering waits run AFTER consent recovery, matching the order the
    // non-adaptive Playwright handler uses. Waiting first would deadlock the
    // recovery path: when a consent wall has replaced the article, a required
    // article selector can never appear, so the wait would fail the request before
    // recovery ever ran. `http` recovery is excluded because its article arrived
    // over the crawler's HTTP channel while the live page still shows the wall, so
    // page waits would act on the wrong document.
    if (!recoveredOverHttp) {
      await applyAdaptivePageWaits(context, opts);
      // Held rather than thrown until the consent check below has run: a wall
      // arriving during this wait removes the article, and letting the rejection
      // escape here would fail the request with that wall unexamined.
      let selectorError = await applyAdaptiveSelectorWaits(context, opts);

      if (hasPageWaits(opts) || hasSelectorWaits(opts)) {
        $ = await context.parseWithCheerio();
        const currentUrl = livePageUrl(context);
        if (currentUrl !== undefined) loadedUrl = currentUrl;

        // One check, not a loop. The waits are the window in which a late wall can
        // appear, so the page is examined once after them; anything it finds is
        // handled the same way as a wall present from the start.
        if (opts.stripConsent) {
          const beforeRecovery = $;
          ({ $, loadedUrl } = await recoverConsentWallAdaptive(context, $, url, loadedUrl, log));
          // Clearing a wall here produced a document that has only reached its
          // navigation event, while the waits meant to hydrate it have already run
          // against the wall. Extracting it would capture an unhydrated page, and
          // re-running the waits in place is what made this a loop — a loop with no
          // honest stopping rule, since the recovered document can bring its own
          // late wall.
          //
          // Failing hands the page to Crawlee's own request-level retry, which is
          // where every comparable crawler puts retries. Acceptance left its cookie
          // in the shared browser context, so the retry is normally served the
          // article directly and takes the plain linear path. Unlike re-enqueueing,
          // this needs no request accounting and cannot be dropped: `addRequests` is
          // itself capped by the remaining `maxRequestsPerCrawl` budget, so a
          // single-page run would silently discard the retry, whereas
          // `handledRequestsCount` only counts successes and a retry is therefore
          // always allowed to run.
          //
          // Exactly one such retry, tracked on the request itself. The cookie
          // survives in the browser context, not in the session: Crawlee writes
          // response cookies back to the session but not the ones the CMP sets
          // during this handler, so under `proxyRotation: 'per-request'` — which
          // retires the session after one request — the retry starts from a fresh
          // context with no consent. Retrying forever there would burn every attempt
          // and lose the page.
          if ($ !== beforeRecovery) {
            if (!consentRetried(request)) {
              markConsentRetried(request);
              log.warning(`Consent interrupted the wait on ${url}; scheduling the request retry`);
              throw new Error(`CONSENT_WALL_APPEARED_WHILE_WAITING: ${url}`);
            }

            // The retry is spent, so this document is the last chance at the page.
            // It has only reached its navigation event and the waits ran against the
            // wall, so extracting it here would emit exactly the truncated page these
            // waits exist to prevent. They run once more against it instead. This
            // cannot recur: it is reached only when the consent retry is already
            // spent, so it is a terminal tail rather than another pass of a loop.
            log.warning(
              `Consent interrupted ${url} again; waiting for the recovered article before extraction`,
            );
            await applyAdaptivePageWaits(context, opts);
            selectorError = await applyAdaptiveSelectorWaits(context, opts);
            $ = await context.parseWithCheerio();
            const hydratedUrl = livePageUrl(context);
            if (hydratedUrl !== undefined) loadedUrl = hydratedUrl;

            // A wall that returns during that final wait is cleared here or throws;
            // either way it is never emitted as the page.
            const beforeFinalRecovery = $;
            ({ $, loadedUrl } = await recoverConsentWallAdaptive(context, $, url, loadedUrl, log));
            if ($ !== beforeFinalRecovery) {
              // Cleared a second wall, so this document has itself only reached its
              // navigation event and the hydration wait that would fill it in is
              // already spent. Emitting it would be the truncation this tail exists
              // to prevent — its `<article>` shell would satisfy a required selector
              // while carrying no body — and hydrating it again is the loop this
              // whole change removed. The page is given up instead, which is what
              // this package already does for any wall it cannot get past.
              log.warning(
                `Consent returned during the final wait for ${url}; the request will fail`,
              );
              // Non-retryable, or the claim that this rung is terminal is false:
              // `consentRetried` stays set across retries, so an ordinary error
              // would send every remaining attempt back down the same ladder to the
              // same failure, paying for a browser render each time.
              throw new NonRetryableError(`CONSENT_WALL_RECURRED_WHILE_HYDRATING: ${url}`);
            }
          }
        }
      }

      // No wall explained it, so a required selector that never appeared is a
      // genuine failure. In an HTTP-only run this is also Crawlee's escalation
      // signal, deferred rather than lost.
      if (selectorError !== undefined) throw selectorError;
    }

    // Post-condition for every path: whatever is about to be extracted must
    // satisfy the required selector, whose absence has to fail the request.
    requireSelectorInDocument($, opts.waitForSelector);

    if (opts.stripConsent) stripConsentFromCheerio($);
    const html = $.html() ?? '';
    rejectUnresolvedConsentRedirect(url, loadedUrl, log);

    // The adaptive path's two branches are not symmetrical, and the difference
    // decides which rungs are reachable on each.
    //
    // On the HTTP-only branch the page fetch already carried the ordered Accept
    // (set on `request.headers` in the pre-navigation hook, which is the one
    // channel that hook has), so `negotiate` costs NOTHING here: the served
    // Markdown is already in `context.response`, whose runtime shape is
    // got-scraping's response even though the declared `BaseHttpResponseData`
    // promises no `body`. No other rung is reachable on that branch — a second
    // fetch would need either `sendRequest`, which the restricted context does
    // not expose, or `page`, and merely reading `page` escalates the request
    // into the browser render this branch exists to avoid. Those rungs are
    // skipped there rather than paid for.
    //
    // On the browser branch — the shipped default, since the package installs a
    // predictor that always renders — the page HTML is in hand, so `alternate`
    // is free, and the second fetch goes through `page.request`.
    if (markdownExtractor !== undefined) {
      const browserPage = adaptivePage(context);
      const pageResponse =
        browserPage === undefined ? pageResponseAsMarkdown(context.response) : undefined;
      // A negotiation refusal on the HTTP-only branch. The Markdown Accept this
      // branch sent is what provoked it, so the page would have come back as
      // ordinary HTML at `off` — and the branch has neither `sendRequest` nor a
      // touchable `page` to recover with, the way the Cheerio path re-fetches.
      // Extracting the body anyway commits the refusal text as the page's
      // content; one measured refusal body ran to 1,004,391 bytes. Throwing is
      // this branch's escalation signal, and the browser navigation that follows
      // carries no Markdown Accept, so it gets the HTML.
      const refusedStatus = observedStatusCode(context.response);
      if (
        browserPage === undefined &&
        reachesNegotiate(opts) &&
        (refusedStatus === 406 || refusedStatus === 415)
      ) {
        throw new Error(`MARKDOWN_NEGOTIATION_REFUSED: ${url} answered ${refusedStatus}`);
      }
      const served = await findServedMarkdown({
        opts,
        url,
        loadedUrl,
        html,
        response: context.response,
        ...(pageResponse !== undefined ? { pageResponse } : {}),
        alreadyNegotiated: browserPage === undefined && reachesNegotiate(opts),
        ...(browserPage !== undefined ? { fetch: pageRequestMarkdownFetcher(browserPage) } : {}),
        proxyUrl: context.proxyInfo?.url,
        log,
        checkCancelled,
      });
      if (served !== undefined) {
        const wasEmitted = await emitServedMarkdown({
          opts,
          extractor: markdownExtractor,
          served,
          url,
          loadedUrl,
          crawlDepth,
          referrerUrl,
          statusCode: observedStatusCode(context.response),
          log,
          checkCancelled,
        });
        // `unusable` means the served body could not be rendered; fall through
        // to ordinary HTML extraction rather than losing the page. Any other
        // outcome finishes the request here, including its link enqueueing —
        // but only when the document this branch parsed is the page's HTML, and
        // not when the page fetch itself returned the Markdown.
        if (wasEmitted !== 'unusable') {
          if (wasEmitted) {
            emitted.add(requestKey(request));
            resultCount += 1;
          }
          await finishRequest(context, requestKey(request), log, pageResponse === undefined);
          return;
        }
      }
    }

    // Kept so an escalation below can release it again. The canonical is claimed
    // before extraction so a duplicate never pays for a cleaning pass, but a run
    // that escalates to a browser rerun must not leave its own claim behind, or
    // the rerun would skip the page as a duplicate of itself and emit nothing.
    let claimedCanonical: string | undefined;
    if (opts.deduplication !== 'minimal') {
      const { skip, canonical } = checkAndRecordCanonical(html, url, opts.seenCanonicals);
      if (skip) {
        log.info(`Skipping ${url} — duplicate of canonical ${canonical}`);
        return;
      }
      claimedCanonical = canonical;
    }

    const { hash: rawHtmlHash, length: rawHtmlLength } = computeContentInfo(html);
    // One engine pass per page: the extractor cleans the HTML once, then renders
    // every requested format from that single cleaned string. In save mode the
    // image byte pipeline follows whichever handler ran: the live page in a
    // browser run, a plain fetch fallback in an HTTP-only run.
    const fetcher = opts.images
      ? adaptiveImageFetcher(context, loadedUrl, subFetchHeaders, opts.httpClient)
      : undefined;
    const { extracted, images } = await runExtraction(
      extractor,
      html,
      url,
      opts,
      fetcher,
      log,
      pageOutputContext(
        url,
        loadedUrl,
        crawlDepth,
        referrerUrl,
        observedStatusCode(context.response),
      ),
      checkCancelled,
    );
    const formats = extracted.formats;

    // A client-rendered article fetched over plain HTTP extracts to almost
    // nothing, and the adaptive crawler would otherwise commit that shell: its
    // default result check accepts every HTTP result, so nothing retries the page
    // in a browser. Reading `context.page` is Crawlee's own escalation signal —
    // it throws in an HTTP-only run and makes the crawler rerun the request in a
    // browser, exactly as the return-target consent path above relies on. In a
    // browser run `page` is an ordinary property, so this read is a no-op there
    // and a genuinely short page is emitted instead of escalating forever.
    if (
      extracted.dedupeText.length <
      (opts.minHttpExtractionChars ?? DEFAULT_MIN_HTTP_EXTRACTION_CHARS)
    ) {
      try {
        void context.page;
        // Browser run: `page` is an ordinary property, so nothing escalated and a
        // genuinely short page falls through to the sink below.
      } catch (error) {
        // HTTP-only run: the read threw, so Crawlee will rerun this request in a
        // browser. Release the canonical claimed above first — releasing it only
        // on this path keeps the claim continuously held on every other path, so
        // a concurrent request sharing the canonical can never slip through.
        log.debug(
          `Retrying ${url} in a browser because the extracted body is below the configured length`,
        );
        if (claimedCanonical !== undefined) opts.seenCanonicals.delete(claimedCanonical);
        throw error;
      }
    }

    if (opts.deduplication === 'aggressive') {
      const extractedText = extracted.dedupeText;
      if (extractedText.length > 0) {
        const { hash: contentHash } = computeContentInfo(extractedText);
        if (opts.seenContentHashes.has(contentHash)) {
          log.info(`Skipping ${url} — duplicate content hash`);
          return;
        }
        opts.seenContentHashes.add(contentHash);
      }
    }

    checkCancelled();
    await opts.sink({
      url: extracted.outputContext.url ?? url,
      html,
      metadata: extracted.outputContext.metadata,
      crawl: extracted.outputContext.crawl,
      formats,
      rawHtmlHash,
      rawHtmlLength,
      ...(images !== undefined ? { images } : {}),
    });
    emitted.add(requestKey(request));
    resultCount += 1;

    await finishRequest(context, requestKey(request), log);
  };
  return withRunCancellation(opts.cancellation, run);
}

async function enqueueLinksCheerio(
  context: CheerioCrawlingContext,
  opts: HandlerOpts,
): Promise<void> {
  const rawDepth = context.request.userData?.depth;
  const currentDepth = typeof rawDepth === 'number' ? rawDepth : 0;
  if (
    opts.maxCrawlDepth !== undefined &&
    opts.maxCrawlDepth !== 0 &&
    currentDepth >= opts.maxCrawlDepth
  ) {
    return;
  }
  const newDepth = currentDepth + 1;
  const referrerUrl = context.request.url;
  const globs = opts.globs?.filter(Boolean) ?? [];
  const exclude = opts.exclude?.filter(Boolean) ?? [];
  await context.enqueueLinks({
    selector: opts.selector,
    ...(globs.length > 0 ? { globs } : {}),
    ...(exclude.length > 0 ? { exclude: exclude } : {}),
    userData: { depth: newDepth, referrerUrl },
    transformRequestFunction: (request) => {
      request.keepUrlFragment = opts.keepUrlFragment ?? false;
      return request;
    },
    ...(opts.onSkippedUrl
      ? { onSkippedRequest: ({ url, reason }) => opts.onSkippedUrl?.(url, reason) }
      : {}),
  });
}

async function enqueueLinksAdaptive(
  context: LoadedContext<AdaptivePlaywrightCrawlerContext>,
  opts: HandlerOpts,
): Promise<void> {
  const rawDepth = context.request.userData?.depth;
  const currentDepth = typeof rawDepth === 'number' ? rawDepth : 0;
  if (
    opts.maxCrawlDepth !== undefined &&
    opts.maxCrawlDepth !== 0 &&
    currentDepth >= opts.maxCrawlDepth
  ) {
    return;
  }
  const newDepth = currentDepth + 1;
  const referrerUrl = context.request.url;
  const globs = opts.globs?.filter(Boolean) ?? [];
  const exclude = opts.exclude?.filter(Boolean) ?? [];
  const enqueueOpts: EnqueueLinksOptions = {
    selector: opts.selector,
    ...(globs.length > 0 ? { globs } : {}),
    ...(exclude.length > 0 ? { exclude: exclude } : {}),
    userData: { depth: newDepth, referrerUrl },
    transformRequestFunction: (request) => {
      request.keepUrlFragment = opts.keepUrlFragment ?? false;
      return request;
    },
    ...(opts.onSkippedUrl
      ? { onSkippedRequest: ({ url, reason }) => opts.onSkippedUrl?.(url, reason) }
      : {}),
  };
  try {
    await context.enqueueLinks(enqueueOpts);
  } catch (error) {
    // Crawlee's adaptive browser branch waits for the crawl selector to attach
    // before it extracts any URL, and a page with no matching link therefore
    // times out instead of yielding zero links. `finishRequest` runs after the
    // sink, so that throw fails a request whose record is already written: one
    // URL lands in the results and in `onFailedRequest` both, and every retry
    // pays the wait again.
    //
    // The wait itself is kept. `waitForDynamicContentSecs` defaults to 0, so on a
    // default crawl no configured wait runs at all and this is the only window in
    // which a client-rendered page's links can appear; shortening it would trade
    // a visible failure for links silently dropped. What is corrected is reading
    // its expiry as a failure. The Cheerio branch and the plain Playwright
    // handler both extract without any such wait and complete the same page, so
    // this restores their shared rule rather than inventing one for this path.
    if (!(await hasNoMatchingLink(context, opts.selector, error))) throw error;
    context.log.debug(
      `No links were enqueued for ${context.request.url}; selector '${opts.selector}' matched none`,
    );
  }
}

/**
 * Whether a failed `enqueueLinks` is the selector wait expiring on a page that
 * genuinely has no matching link.
 *
 * Both halves are required. The error must be a Playwright timeout, and the page
 * must actually hold no matching element. Absorbing a timeout on its type alone
 * would discard the links a request never enqueued the first time anything else
 * behind that wait learns to time out.
 *
 * The absence is re-asked with `page.$$eval`, the query `extractUrlsFromPage`
 * itself runs: same frame, same selector engine, and no wait of its own.
 * `parseWithCheerio` cannot answer it, because it inlines every iframe body into
 * the document it returns — a leaf page carrying a consent, embed, or ad frame
 * would look as though it had links and keep failing — and it re-expands the
 * page's shadow roots by writing to the live DOM on the way.
 *
 * The timeout is matched by `name` rather than `instanceof` so the check survives
 * this package and Crawlee resolving separate `playwright-core` copies, and so
 * the handler needs no runtime import of `playwright`. A selector Playwright
 * cannot evaluate, or a page already gone, proves nothing about the links and
 * leaves the original failure standing.
 */
async function hasNoMatchingLink(
  context: LoadedContext<AdaptivePlaywrightCrawlerContext>,
  selector: string | undefined,
  error: unknown,
): Promise<boolean> {
  if (selector === undefined) return false;
  if (!(error instanceof Error) || error.name !== 'TimeoutError') return false;
  const page = adaptivePage(context);
  if (page === undefined) return false;
  try {
    return (await page.$$eval(selector, (elements) => elements.length)) === 0;
  } catch {
    return false;
  }
}
