import { createRequire } from 'node:module';
import {
  type BoilerplateMode,
  type CommentHandling,
  DEFAULT_CONFIG,
  type ImageHandling,
  type LinkHandling,
  type OutputFormat,
  type OutputLayout,
  type TableHandling,
  type TrafilaturacoreConfig,
} from '@markdownee/extraction';

import {
  CrawlerType,
  Deduplication,
  MarkdownDiscovery,
  ProxyRotation,
  type WaitUntil,
} from '@markdownee/schema';
import type {
  AdaptivePlaywrightCrawlerOptions,
  BaseHttpClient,
  CheerioCrawlerOptions,
  Configuration,
  CrawlingContext,
  Dictionary,
  HttpRequest,
  HttpResponse,
  PlaywrightCrawlingContext,
  PlaywrightHook,
  ProxyConfiguration,
  RedirectHandler,
  RequestProvider,
  ResponseTypes,
  SessionPoolOptions,
  StreamingHttpResponse,
} from 'crawlee';
import {
  AdaptivePlaywrightCrawler,
  CheerioCrawler,
  GotScrapingHttpClient,
  KeyValueStore,
  log,
  PlaywrightCrawler,
  playwrightUtils,
  Request,
  type SitemapRequestList,
} from 'crawlee';
import type { BrowserContext, Page } from 'playwright';
import { installCookieDefences } from './browser/cookies.js';
import { buildBrowserLaunchOptions } from './browser/launchOptions.js';
import type { ScrollConfig } from './browser/scroll.js';
import { RunCancellation } from './cancellation.js';
import {
  createAdaptiveHandler,
  createCheerioHandler,
  createHandler,
  DEFAULT_SELECTOR_TIMEOUT_SECS,
  type HandlerImageOptions,
} from './handler.js';
import { MARKDOWN_ACCEPT, OriginProbeBudget } from './markdown/discovery.js';
import { MarkdownRobotsGate } from './markdown/robots.js';
import type { KvsLike } from './sinks/storage.js';
import type { ExtractionResult, Sink } from './sinks/types.js';
import { CRAWL_ORIGIN_CONTEXT_KEY } from './sub-fetch-headers.js';

/**
 * Rendering-type predictor that always renders in a browser and never detects.
 *
 * Crawlee's own predictor cannot be trusted here. Detection compares the
 * plain-HTTP and browser renderings of a page, but this package reports results
 * through a sink instead of `pushData`, so `RequestHandlerResult.datasetItems` is
 * always empty, the default comparator compares `[]` with `[]`, and every site is
 * learned as static and afterwards served without a browser. Detection also runs
 * the request handler twice for a single request.
 *
 * `renderingTypeDetectionRatio: 0` does not switch detection off: Crawlee's
 * predictor returns a probability of `1` whenever its model holds no classifiers,
 * which is every cold start, ignoring the configured ratio. Replacing the
 * predictor is the only way to stop it.
 */
/**
 * Seconds allowed for scrolling when it is configured.
 *
 * Crawlee's `infiniteScroll` is bounded by `maxScrollHeight` rather than by time,
 * exactly as Apify's own scrapers use it, so this is what the request budget sets
 * aside for it rather than a limit imposed on it. A configured `waitForSecs`
 * lengthens the scroll by at least that idle wait, so the budget funds it on top
 * of this allowance rather than letting it eat the handler's own time.
 */
const SCROLL_ALLOWANCE_SECS = 10;

/**
 * Seconds the handler needs for everything that is not a configured wait:
 * capture, consent handling, extraction, rendering every requested format, and
 * the sink. This is Crawlee's own `requestHandlerTimeoutSecs` default, kept as the
 * base so a run that configures no wait behaves exactly as the library does.
 */
const BASE_HANDLER_TIMEOUT_SECS = 60;

/**
 * The request-handler timeout for a browser crawler, and the navigation timeout
 * inside it.
 *
 * Crawlee times navigation and the handler separately — the outer bound it
 * applies is `navigationTimeoutSecs + requestHandlerTimeoutSecs + 10` — so this
 * value is the handler's own budget, and every configured wait is spent inside it.
 * Setting it equal to `navigationTimeoutSecs`, as this package used to, made the
 * handler budget follow an unrelated knob and pushed it below Crawlee's own
 * default whenever a caller shortened navigation: a 25-second navigation timeout
 * left 25 seconds for a scroll, a 5-second settle, extraction and rendering
 * together, and a heavy page was killed mid-wait. Clamping each wait to whatever
 * was left at runtime was the previous answer to that, which silently degraded the
 * caller's configuration and produced a run of budget-arithmetic defects.
 *
 * The waits are bounded by their own configured values instead, and the budget is
 * raised to fit them — which is how firecrawl bounds the same work: it caps waits
 * at the schema boundary and raises the timeout where the work warrants it, rather
 * than squeezing waits at run time. `navigationTimeoutSecs` keeps the caller's
 * value, so navigation itself is unaffected.
 */
function browserRequestTimeouts(opts: {
  navigationTimeoutSecs?: number;
  waitForDynamicContentSecs?: number;
  waitForSelector?: string;
  softWaitForSelector?: string;
  scroll?: ScrollConfig;
}): { requestHandlerTimeoutSecs: number; navigationTimeoutSecs?: number } {
  const settleSecs = opts.waitForDynamicContentSecs ?? 0;
  // Zero falls back to the same bound the handler's selector waits use, because
  // Playwright reads a timeout of 0 as no timeout at all.
  const selectorSecs = settleSecs || DEFAULT_SELECTOR_TIMEOUT_SECS;
  // Each configured selector wait runs once and gets its own timeout.
  const selectorCount = (opts.waitForSelector ? 1 : 0) + (opts.softWaitForSelector ? 1 : 0);
  return {
    ...(opts.navigationTimeoutSecs !== undefined
      ? { navigationTimeoutSecs: opts.navigationTimeoutSecs }
      : {}),
    requestHandlerTimeoutSecs:
      BASE_HANDLER_TIMEOUT_SECS +
      settleSecs +
      selectorCount * selectorSecs +
      (opts.scroll ? SCROLL_ALLOWANCE_SECS + (opts.scroll.waitForSecs ?? 0) : 0),
  };
}

const ALWAYS_BROWSER_PREDICTOR: NonNullable<
  AdaptivePlaywrightCrawlerOptions['renderingTypePredictor']
> = {
  predict: () => ({ renderingType: 'clientOnly', detectionProbabilityRecommendation: 0 }),
  storeResult: () => {},
  initialize: async () => {},
};

/**
 * `AdaptivePlaywrightCrawler` that binds its HTTP-only branch to the configured proxy.
 *
 * Crawlee assigns `crawlingContext.proxyInfo` in exactly one place on this crawler's
 * inheritance chain — `BrowserCrawler._runRequestHandler`
 * (`@crawlee/browser@3.18.1` `internals/browser-crawler.js:241-248`). The adaptive
 * crawler overrides that method and, on a request its predictor calls static, invokes
 * `runRequestHandlerWithPlainHTTP` directly without reaching `super`
 * (`@crawlee/playwright@3.18.1` `internals/adaptive-playwright-crawler.js:213-216`).
 * That branch then fetches through `crawlingContext.sendRequest({})`, whose proxy is
 * resolved lazily from `() => crawlingContext.proxyInfo?.url`
 * (`@crawlee/basic@3.18.1` `internals/basic-crawler.js:1137`) — so with the field
 * unset the fetch simply has no proxy, and a caller who configured one has those
 * requests leave from the real egress IP. Measured before this fix: 14 of 20 pages
 * direct at `renderingTypeDetectionRatio: 0.1`. Nothing below that resolution is
 * scheme-dependent, so `https:` leaked identically.
 *
 * A pre-navigation hook cannot do this: the branch hands hooks a spread COPY of the
 * context (`:376-389`), so a hook's mutation never reaches the closure above. This
 * override is the writable path. Every concrete Crawlee crawler assigns `proxyInfo` in
 * its own request handler — `HttpCrawler` does it as its first statement — which is why
 * the adaptive branch omitting it is a defect rather than a design choice, and why
 * replicating it here is faithful rather than inventive.
 *
 * DELETE THIS AT THE CRAWLEE v4 MIGRATION. v4 fixes the leak by construction (the proxy
 * rides on `Session`, and the static branch runs a real `CheerioCrawler` pipeline) and
 * removes `runRequestHandlerWithPlainHTTP` along with the other privatized internals.
 * `noImplicitOverride` then turns that removal into a compile error here rather than a
 * silent re-leak, which is the point of writing it as an override.
 */
class ProxyBoundAdaptivePlaywrightCrawler extends AdaptivePlaywrightCrawler {
  protected override async runRequestHandlerWithPlainHTTP(
    crawlingContext: PlaywrightCrawlingContext,
    oldStateCopy?: Dictionary,
  ) {
    // The undefined test is load-bearing rather than defensive: on the DETECTION path
    // the browser leg has already run and set `proxyInfo`, and the HTTP leg has to
    // reuse that same proxy or the two renderings being compared are not comparable.
    if (this.proxyConfiguration && crawlingContext.proxyInfo === undefined) {
      // `BrowserCrawler` passes `{ request }` here; this deliberately does not. That
      // argument is inert for a plain proxy list — `newProxyInfo` ignores it and stays
      // sticky per session — but on a TIERED configuration it records the chosen tier
      // on the request. A failed HTTP-only run falls through to the browser handler,
      // whose own unconditional `newProxyInfo` would then read that record and charge
      // the tier an error (`proxy_configuration.js:263-265`). Escalation is usually a
      // property of the page rather than the proxy — a client-rendered shell trips the
      // extracted-text floor — so a tiered caller would watch a JavaScript-heavy domain
      // climb to its most expensive tier for a reason the proxy never caused. Declining
      // to participate in tier accounting is the conservative half of that trade; the
      // browser leg still does it exactly as before.
      crawlingContext.proxyInfo = await this.proxyConfiguration.newProxyInfo(
        crawlingContext.session?.id,
      );
    }
    return super.runRequestHandlerWithPlainHTTP(crawlingContext, oldStateCopy);
  }
}

export interface MarkdowneeCrawlerOptions {
  startUrls: string[];
  sink: Sink<ExtractionResult>;
  formats?: OutputFormat[];
  mode?: BoilerplateMode;
  /** Include or exclude detected user-comment sections. */
  commentHandling?: CommentHandling;
  /** `exclude` discards table subtrees including cell text. Default `include`. */
  tableHandling?: TableHandling;
  /**
   * Default `exclude`. The `save` MODE (download image bytes into the key-value
   * store — distinct from the `save` format-destination tokens) behaves as
   * `resolved-url` at the extraction boundary; the crawler's byte pipeline
   * consumes the resolved URLs.
   */
  imageHandling?: ImageHandling;
  /** Default `include`. `exclude` unwraps `<a>` while keeping the anchor text. */
  linkHandling?: LinkHandling;
  /** Generated output envelope. */
  outputLayout?: OutputLayout;
  /**
   * Long-edge pixel cap for images stored by the save image-handling mode
   * (never upscaled; 0 = uncapped). Consumed by the save byte pipeline; inert
   * outside `imageHandling: 'save'`.
   */
  maxImageEdge?: number;
  /**
   * Store SVG images rasterized to PNG (`true`, default) or as sanitized SVG
   * source (`false`) in the save image-handling mode. Consumed by the save byte
   * pipeline; inert outside `imageHandling: 'save'`.
   */
  rasterizeSvg?: boolean;
  /**
   * Key-value store receiving the image bytes in the save image-handling mode.
   * When omitted, the crawler opens the default Crawlee store bound to
   * `configuration` and references images as `kvs://{key}` (no public URL).
   * Inert outside `imageHandling: 'save'`.
   */
  imageKvs?: KvsLike;
  /**
   * Whether the run's `save` tokens include an `original-*` route — the save
   * image pipeline then also stores each image's pre-normalization bytes under
   * `images-{md5(sourceUrl)}-original.{ext}`. Inert outside
   * `imageHandling: 'save'`.
   */
  saveOriginalImages?: boolean;
  languageCode?: string;
  scroll?: ScrollConfig;
  cookieStrategy?: 'ghostery' | 'none';
  sessionPool?: boolean | SessionPoolOptions;
  maxRequestsPerCrawl?: number;
  maxRetries?: number;
  initialConcurrency?: number;
  maxConcurrency?: number;
  navigationTimeoutSecs?: number;
  /**
   * Navigation lifecycle event to wait for in `page.goto`.
   * Forwarded to Crawlee via `preNavigationHooks` → `gotoOptions.waitUntil`.
   * If undefined, Playwright's default of `'load'` applies.
   */
  waitUntil?: WaitUntil;
  headless?: boolean;
  crawlerType?: CrawlerType;
  /**
   * Opts back into Crawlee's rendering-type detection, which is off by default
   * here (see {@link ALWAYS_BROWSER_PREDICTOR}). Detection compares the plain-HTTP
   * and browser renderings of a page, but this package reports results through a
   * sink rather than `pushData`, so Crawlee compares two empty dataset lists,
   * always concludes the renderings are equal, and learns every site as static.
   * Setting this restores that behaviour along with the HTTP fast path.
   */
  renderingTypeDetectionRatio?: number;
  /**
   * Adaptive-only floor, in characters of extracted body text, below which an
   * HTTP-only run is escalated to a browser rerun. Guards against the adaptive
   * crawler committing an unhydrated shell for a client-rendered page. Only
   * reachable when `renderingTypeDetectionRatio` opts detection back in.
   */
  minHttpExtractionChars?: number;
  ignoreHttpsErrors?: boolean;
  bypassCSP?: boolean;
  initialCookies?: unknown[];
  extraHTTPHeaders?: Record<string, string>;
  userAgent?: string;
  selector?: string;
  maxCrawlDepth?: number;
  maxResults?: number;
  globs?: string[];
  exclude?: string[];
  keepUrlFragment?: boolean;
  proxyConfiguration?: ProxyConfiguration;
  /**
   * Proxy rotation strategy. Maps to Crawlee `sessionPoolOptions`.
   * recommended uses the default session reuse count; per-request retires the
   * session after one request (new browser context per request); until-failure
   * forces a single-session pool that stays on one proxy URL until the session
   * retires from errors. Has no effect when `proxyConfiguration` is undefined.
   */
  proxyRotation?: ProxyRotation;
  sessionPoolName?: string;
  maxSessionRotations?: number;
  requestQueue?: RequestProvider;
  requestList?: SitemapRequestList;
  /**
   * Crawlee Configuration for this crawler. When set, the crawler and its
   * default storages are bound to it instead of the mutable global config —
   * lets a run isolate its storage (e.g. a non-persisting in-memory client)
   * without affecting other crawls in the same process.
   */
  configuration?: Configuration;
  /** Optional run-scoped logger; leaves the process-wide logger unchanged. */
  log?: CheerioCrawlerOptions['log'];
  blockMedia?: boolean;
  /**
   * Whether the caller explicitly set `blockMedia` (vs inheriting the schema
   * default, which is `true`). Only used to decide whether to emit the
   * "blockMedia has no effect" warning on incompatible crawler types, so the
   * default does not produce a spurious warning on every cheerio/firefox run.
   */
  blockMediaExplicit?: boolean;
  respectRobotsTxt?: boolean;
  waitForDynamicContentSecs?: number;
  waitForSelector?: string;
  softWaitForSelector?: string;
  onFailedRequest?: (info: {
    url: string;
    loadedUrl: string | null;
    errorMessages: string[];
    retryCount: number;
  }) => Promise<void>;
  onSkippedUrl?: (url: string, reason: string) => void;
  deduplication?: Deduplication;
  /**
   * Whether, and how hard, to look for a Markdown representation the origin
   * publishes for a page and use it instead of extracting from the page HTML.
   * Defaults to `off`, which is a complete no-op: no header changes, no extra
   * requests, and byte-identical output to a build without the feature.
   */
  markdownDiscovery?: MarkdownDiscovery;
}

function toTrafilaturacoreConfig(opts: MarkdowneeCrawlerOptions): TrafilaturacoreConfig {
  return {
    ...DEFAULT_CONFIG,
    boilerplate: opts.mode ?? DEFAULT_CONFIG.boilerplate,
    commentHandling: opts.commentHandling ?? DEFAULT_CONFIG.commentHandling,
    tableHandling: opts.tableHandling ?? DEFAULT_CONFIG.tableHandling,
    imageHandling: opts.imageHandling ?? DEFAULT_CONFIG.imageHandling,
    linkHandling: opts.linkHandling ?? DEFAULT_CONFIG.linkHandling,
    outputLayout: opts.outputLayout ?? DEFAULT_CONFIG.outputLayout,
    targetLanguage:
      opts.languageCode !== undefined && opts.languageCode !== ''
        ? opts.languageCode
        : DEFAULT_CONFIG.targetLanguage,
  };
}

// From @apify/scraper-tools SESSION_MAX_USAGE_COUNTS (apify/actor-scraper).
const SESSION_MAX_USAGE_COUNTS = Object.freeze({
  recommended: undefined,
  'per-request': 1,
  'until-failure': 1000,
} as const);

/**
 * Resolve the handlers' save-mode image pipeline wiring. `undefined` outside
 * `imageHandling: 'save'` (the pipeline never runs). The destination store is
 * `imageKvs` when the caller provides one (the Apify Actor passes its — possibly
 * named — store, which also exposes public URLs); otherwise the default Crawlee
 * store bound to `configuration` is opened lazily, wrapped to hide its
 * `getPublicUrl` (local file-system stores fabricate misleading `file://` URLs),
 * so local references stay `kvs://{key}`.
 */
/**
 * The adaptive crawler's HTTP-only branch defines `page` as a getter that THROWS,
 * so `({ page }) => { if (page) ... }` fires it while destructuring and the guard
 * never runs: the hook throws, Crawlee abandons the remaining hooks, marks the HTTP
 * attempt failed and falls back to the browser — which also means rendering-type
 * detection can never conclude a page is static. Read it defensively instead.
 */
function optionalPage(ctx: unknown): Page | undefined {
  try {
    return (ctx as { page?: Page }).page;
  } catch {
    return undefined;
  }
}

/**
 * A cookie in the shape `BrowserContext.addCookies` accepts, intersected with
 * `_crHasCrossSiteAncestor`. Playwright's public typings never declare that field —
 * its own comment calls it non-standard, and it appears only in `lib/coreBundle.js` —
 * so deriving from the parameter alone would misdescribe the value this file builds,
 * which is the whole point of annotating it.
 */
type NormalizedCookie = Parameters<BrowserContext['addCookies']>[0][number] & {
  _crHasCrossSiteAncestor?: boolean;
};

/**
 * Playwright rejects a cookie carrying neither `url` nor a `domain`+`path` pair, and
 * that rejection fails the request. `initialCookies` is `unknown[]` at the schema
 * boundary, so a bare `{name, value}` is reachable from every consumer surface;
 * default it to the request URL rather than letting it abort the crawl.
 */
/**
 * The exact field set Playwright accepts on a cookie, transcribed from its
 * `scheme.SetNetworkCookie` (playwright-core 1.62.1 `lib/coreBundle.js:17318-17330`),
 * with each optional field's declared type. Returns `undefined` when any present field
 * has the wrong type, since Playwright would abort the whole request on it.
 *
 * Unknown keys are dropped rather than forwarded: Playwright ignores them, and passing
 * unvalidated caller data into the browser buys nothing.
 */
function projectDeclaredFields(raw: Record<string, unknown>): NormalizedCookie | undefined {
  if (typeof raw.name !== 'string' || typeof raw.value !== 'string') return undefined;
  const projected: Record<string, unknown> = { name: raw.name, value: raw.value };
  const optionals: [string, (value: unknown) => boolean][] = [
    ['expires', (value) => typeof value === 'number' && !Number.isNaN(value)],
    ['httpOnly', (value) => typeof value === 'boolean'],
    ['secure', (value) => typeof value === 'boolean'],
    ['sameSite', (value) => value === 'Strict' || value === 'Lax' || value === 'None'],
    // `partitionKey` is a scope RESTRICTION (CHIPS): it confines the cookie to one
    // top-level partition. It must be carried through, never quietly removed —
    // dropping it converts a partitioned cookie into an unpartitioned one, which is
    // sent in strictly more contexts than the caller asked for.
    // A partition key is a top-level SITE, so Chromium requires a parseable URL with a
    // host and refuses a bare `toplevelsite.com` with `Protocol error
    // (Storage.setCookies)`. It must also be non-empty, because Chromium gates on
    // `if (partitionKey)` (`coreBundle.js:38379`) and would silently omit a blank one,
    // landing the cookie unpartitioned. Measured against Chromium across schemes,
    // ports, paths and scheme-less values.
    ['partitionKey', (value) => typeof value === 'string' && isSiteUrl(value)],
    ['_crHasCrossSiteAncestor', (value) => typeof value === 'boolean'],
  ];
  for (const [key, isValid] of optionals) {
    const value = raw[key];
    // Absent and explicitly null are both omission; a wrong type is caller error.
    if (value === undefined || value === null) continue;
    if (!isValid(value)) return undefined;
    projected[key] = value;
  }
  // The one cast this projection needs: the loop above validates each key by a dynamic
  // table, which the compiler cannot follow back to the declared field types.
  return projected as NormalizedCookie;
}

/**
 * Schemes Chromium will take as a partition key, measured by feeding each through
 * `addCookies`. It is a scheme REGISTRY, not a structural property: `file:///tmp/x`
 * has no host and is accepted, while `custom-scheme://a.example` has one and is not.
 *
 * `chrome:` is also accepted by Chromium and is deliberately left out — it is a
 * browser-internal scheme, never a site a crawl should be partitioning against, and
 * the cost of excluding it is dropping a cookie nobody sends rather than aborting a
 * crawl. That is the only measured divergence from the engine.
 */
const PARTITION_KEY_SCHEMES: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'ws:',
  'wss:',
  'ftp:',
  'file:',
]);

/**
 * A top-level site, as Chromium accepts one.
 *
 * `URL.canParse` alone is not the rule: it admits the opaque schemes — `mailto:`,
 * `javascript:`, `about:`, `data:`, `urn:`, `tel:` — which Chromium refuses with
 * `Protocol error (Storage.setCookies)`, aborting the crawl. Nor is "has a host": that
 * rejected `file:` URLs the engine accepts.
 */
function isSiteUrl(candidate: string): boolean {
  if (candidate === '' || !URL.canParse(candidate)) return false;
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'blob:') return PARTITION_KEY_SCHEMES.has(parsed.protocol);
  // `blob:` is judged by what it WRAPS, and the wrapped URL is the PARSED pathname, not
  // a string slice. Chromium canonicalizes before deciding — it strips leading
  // whitespace and embedded CR/LF/tab — so `' blob:https://a.example/1'` and
  // `'b\nlob:https://a.example/1'` are the accepted blob URL to it, while a raw
  // `startsWith('blob:')` test saw neither and dropped the whole cookie.
  const inner = parsed.pathname;
  if (inner === '' || !URL.canParse(inner)) return false;
  // Nesting needs no special case: the inner scheme of `blob:blob:…` is still `blob:`,
  // which the registry refuses, exactly as Chromium does.
  return PARTITION_KEY_SCHEMES.has(new URL(inner).protocol);
}

/** A cookie asking to be confined to one CHIPS partition. */
function isPartitioned(raw: Record<string, unknown>): boolean {
  return raw.partitionKey !== undefined && raw.partitionKey !== null;
}

/**
 * Secure as Playwright computes it for an ALREADY-NORMALIZED cookie. For a url-form
 * cookie the scheme is authoritative and OVERWRITES any explicit flag — `copy.secure =
 * url3.protocol === 'https:'` (`coreBundle.js:13102`) — so `{url: 'http://…',
 * secure: true}` is stored insecure. Only a domain-form cookie keeps its own flag.
 */
function secureAfterNormalization(shaped: NormalizedCookie): boolean {
  const shapedUrl = shaped.url;
  if (typeof shapedUrl === 'string') {
    return URL.canParse(shapedUrl) && new URL(shapedUrl).protocol === 'https:';
  }
  return shaped.secure === true;
}

/** Playwright's own `expires` bound: -1, or a positive value no later than year 9999. */
const MAX_COOKIE_EXPIRES_SECONDS = 253402300799;

function validExpires(expires: unknown): boolean {
  if (expires === undefined || expires === null) return true;
  if (typeof expires !== 'number' || Number.isNaN(expires)) return false;
  // Playwright's asserts are truthiness-guarded, so 0 passes.
  if (!expires) return true;
  if (expires < 0) return expires === -1;
  return expires <= MAX_COOKIE_EXPIRES_SECONDS;
}

export function normalizeCookies(
  cookies: readonly unknown[],
  url: string,
  partitionsSupported = true,
): NormalizedCookie[] {
  // Playwright accepts exactly two shapes: a `url`, XOR a `domain` + `path` pair.
  // Anything else is rejected outright and FAILS the request. So rather than repairing
  // whatever arrives one combination at a time, this constructs one of the two valid
  // shapes, and refuses anything it cannot construct one from.
  //
  // `absent` and `malformed` are NOT the same thing, and conflating them leaks. An
  // absent scope legitimately defaults to the request's url; a scope that is present
  // but of the wrong type is caller error, and silently re-scoping it to the current
  // host sends the value somewhere the caller never named. Playwright rejects those
  // outright (`cookies[0].domain: expected string`), so they are dropped here.
  // Tagged, NOT string sentinels: a scope value is itself an arbitrary string, so
  // encoding the classification in the same channel collides with it. Returning the
  // bare words meant a cookie for the host literally named `absent` was reclassified
  // as having no scope and re-pointed at the crawl's own host.
  type Scope = { kind: 'absent' } | { kind: 'malformed' } | { kind: 'value'; value: string };
  const read = (value: unknown, valid?: (candidate: string) => boolean): Scope => {
    if (value === undefined || value === null) return { kind: 'absent' };
    if (typeof value !== 'string') return { kind: 'malformed' };
    if (value.trim() === '') return { kind: 'absent' };
    // Well-typed is not the same as well-formed. A url that does not parse and a path
    // that is not rooted are both rejected by Playwright, so they are caller error
    // too — and passing them through only moves the failure into the browser branch.
    return valid && !valid(value) ? { kind: 'malformed' } : { kind: 'value', value };
  };
  // Transcribed from Playwright's own validator (`rewriteCookies`, playwright-core
  // 1.62.1 `lib/coreBundle.js:13088-13103`) rather than inferred a rule at a time,
  // which is how the previous rounds of this function each found one more:
  //   url XOR (domain AND path); never url with domain; never url with path;
  //   url must parse and be neither `about:blank` nor a `data:` URL;
  //   expires must be -1 or a positive value no greater than 253402300799.
  const parses = (candidate: string): boolean =>
    URL.canParse(candidate) &&
    candidate !== 'about:blank' &&
    !candidate.toLowerCase().startsWith('data:');
  const rooted = (candidate: string): boolean => candidate.startsWith('/');
  return cookies.flatMap((cookie): NormalizedCookie[] => {
    const raw = cookie as Record<string, unknown>;
    const domain = read(raw.domain);
    const cookieUrl = read(raw.url, parses);
    const path = read(raw.path, rooted);
    if (
      domain.kind === 'malformed' ||
      cookieUrl.kind === 'malformed' ||
      path.kind === 'malformed' ||
      !validExpires(raw.expires)
    ) {
      return [];
    }
    // Project ONLY the fields Playwright declares, each type-checked. Spreading the
    // caller's other keys through unvalidated was a hole of its own: every one of them
    // is type-checked on arrival, so `expires: null`, `secure: 'yes'`, `httpOnly: 123`,
    // `sameSite: 'bogus'` and a non-string `name`/`value` each aborted the browser
    // request. Building the object instead of copying it closes that by construction.
    const rest = projectDeclaredFields(raw);
    if (!rest) return [];
    // Decide the final shape FIRST, then judge the partition against it. Judging the
    // raw input was wrong in both directions: it let `{url: 'http://…', secure: true,
    // partitionKey}` through — Playwright OVERWRITES `secure` from the url scheme
    // (`coreBundle.js:13102`; measured: that cookie stores as `secure: false`) so
    // Chromium then refused it — while dropping a scope-less partitioned cookie that
    // normalization was about to place on an https request url, where it is valid.
    // A domain beside a REAL url is ambiguous: two scopes, which Playwright refuses,
    // and resolving it either way would invent intent.
    const shaped =
      domain.kind === 'value'
        ? cookieUrl.kind === 'value'
          ? undefined
          : { ...rest, domain: domain.value, path: path.kind === 'value' ? path.value : '/' }
        : // url alone, never a path beside it.
          { ...rest, url: cookieUrl.kind === 'value' ? cookieUrl.value : url };
    if (!shaped) return [];
    if (isPartitioned(raw) && (!partitionsSupported || !secureAfterNormalization(shaped))) {
      // A partition that cannot be honoured means dropping the COOKIE, never the
      // partition: silently unpartitioning it widens its scope. CHIPS requires Secure,
      // and the Firefox backend discards `partitionKey` entirely
      // (`coreBundle.js:45473-45478`), so it could only arrive unpartitioned there.
      return [];
    }
    return [shaped];
  });
}

/**
 * Restate the transferable context options as request headers for the adaptive
 * crawler's HTTP-only branch, which never sees `launchContext`. `sendRequest`
 * forwards `request.headers`, and the session cookie jar is not an option here:
 * `GotScrapingHttpClient` nulls it, so a `session.setCookies()` call is dropped.
 */
/**
 * Serialize the initial cookies that RFC 6265 actually permits sending to `url`.
 *
 * The browser branch hands cookies to `page.context().addCookies`, which scopes them
 * by domain, path, `secure` and expiry. The HTTP-only branch has no cookie jar — the
 * adaptive crawler's `sendRequest` discards the session's — so the scoping has to be
 * applied here. Serializing the list unconditionally, as the first version of this
 * function did, sends a cookie scoped to `accounts.example.com/private` to any host
 * the crawl reaches, which leaks a credential across origins and makes the two
 * branches disagree on a security-relevant contract.
 *
 * Matching follows RFC 6265: §5.1.3 for the domain (host-only when the cookie was
 * given as a `url`, otherwise a suffix match on a dot boundary), §5.1.4 for the path,
 * plus the `secure` and expiry checks. Verified against Playwright's own
 * `context.cookies(url)` as the oracle.
 */
/**
 * The single, canonical reading of one initial cookie's scope.
 *
 * Every consumer of "is this cookie secure / where does it apply" must come through
 * here. An earlier version answered that question twice — once by parsing the URL and
 * once with a lexical `startsWith('https:')` — and the two disagreed on exactly the
 * inputs the URL parser normalizes away: `' https://…'`, `'\thttps://…'` and
 * `'ht\ntps://…'` all parse as https but fail a string prefix test, so a secure cookie
 * slipped past the redirect guard. One definition, parsed, removes that whole class.
 *
 * Returns `undefined` for a cookie that cannot be scoped at all, which is never sent.
 */
function cookieScope(
  cookie: Record<string, unknown>,
): { domain: string; path: string; hostOnly: boolean; secure: boolean } | undefined {
  const domain = typeof cookie.domain === 'string' ? cookie.domain : '';
  const secure = cookie.secure === true;
  // An empty or whitespace-only `url` is ABSENT, not a second scope — Playwright
  // accepts `{domain, path, url: ''}` and ignores the empty string. Treating it as a
  // real url silently dropped an otherwise valid authentication cookie.
  const scopeUrl = typeof cookie.url === 'string' && cookie.url.trim() !== '' ? cookie.url : '';
  if (domain) {
    // A cookie carrying BOTH a domain and a real url has no single scope, and
    // Playwright refuses it outright ("Cookie should have either url or domain"), so
    // the browser branch would never send it. Reading only the domain here would
    // silently invent a scope the other branch rejects — and would drop an https
    // url's secure flag, re-opening the downgrade this guard exists to close.
    if (scopeUrl) return undefined;
    return {
      domain,
      path: typeof cookie.path === 'string' ? cookie.path : '/',
      hostOnly: false,
      secure,
    };
  }
  // A `url`-form cookie is host-only and takes its scope from that URL, exactly as
  // Playwright treats it; `normalizeCookies` produces this form for bare entries.
  if (!scopeUrl) return undefined;
  try {
    const scope = new URL(scopeUrl);
    // The directory of the URL, keeping the trailing slash — `/private/x` scopes to
    // `/private/`, which matches `/private/page` but not `/private`. Measured against
    // Playwright rather than assumed; both the raw pathname and the slash-less
    // `/private` disagree with it in opposite directions.
    const scopePath = scope.pathname || '/';
    return {
      domain: scope.hostname,
      path: scopePath.slice(0, scopePath.lastIndexOf('/') + 1) || '/',
      hostOnly: true,
      // A cookie handed over as an https URL is a secure cookie.
      secure: secure || scope.protocol === 'https:',
    };
  } catch {
    return undefined;
  }
}

function cookiesForUrl(cookies: readonly unknown[], url: string): string {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return '';
  }
  const host = target.hostname.toLowerCase();
  const secureTarget = target.protocol === 'https:';
  const nowSeconds = Date.now() / 1000;

  const domainMatches = (domain: string, hostOnly: boolean): boolean => {
    const candidate = domain.replace(/^\./, '').toLowerCase();
    if (candidate === '') return false;
    if (hostOnly) return host === candidate;
    return host === candidate || host.endsWith(`.${candidate}`);
  };

  const pathMatches = (cookiePath: string): boolean => {
    const requestPath = target.pathname || '/';
    if (cookiePath === '' || cookiePath === '/') return true;
    if (requestPath === cookiePath) return true;
    if (!requestPath.startsWith(cookiePath)) return false;
    return cookiePath.endsWith('/') || requestPath.charAt(cookiePath.length) === '/';
  };

  return cookies
    .map((entry) => entry as Record<string, unknown>)
    .filter((cookie) => typeof cookie.name === 'string' && cookie.value !== undefined)
    .filter((cookie) => {
      const scope = cookieScope(cookie);
      if (!scope) return false;
      if (!domainMatches(scope.domain, scope.hostOnly) || !pathMatches(scope.path)) return false;
      if (scope.secure && !secureTarget) return false;
      // Playwright uses seconds since the epoch, with -1 (or absent) meaning a
      // session cookie, which never expires within a run.
      const expires = typeof cookie.expires === 'number' ? cookie.expires : -1;
      return !(expires >= 0 && expires <= nowSeconds);
    })
    .map((cookie) => `${String(cookie.name)}=${String(cookie.value)}`)
    .join('; ');
}

/**
 * The `Cookie` header for `url`, or `undefined` when no initial cookie is in scope.
 *
 * `originUrl` is the request that began the redirect chain, and defaults to `url`.
 * The distinction matters for a cookie given without a domain: `normalizeCookies`
 * synthesizes its scope from the url it is handed, so normalizing against the *hop*
 * would re-scope a bare `{name, value}` onto whatever host the chain reached and send
 * a credential to an unrelated origin. The browser branch normalizes once, against
 * the initial request, and lets the jar scope every later hop; this mirrors that.
 *
 * Exported for {@link createRescopingHttpClient} and its tests.
 */
export function httpBranchCookieHeader(
  url: string,
  initialCookies: readonly unknown[],
  originUrl: string = url,
): string | undefined {
  const normalized = normalizeCookies(initialCookies, originUrl);
  const sendable = normalized.filter((cookie) => {
    // A raw `Cookie:` header cannot express a partition, so emitting a CHIPS cookie
    // would send it outside the partition the caller confined it to.
    return cookie.partitionKey === undefined;
  });
  return cookiesForUrl(sendable, url) || undefined;
}

/**
 * The URL the crawl asked for, for one request {@link createRescopingHttpClient} is
 * about to send. This is the scope a cookie given without a `domain` is normalized
 * against, so getting it wrong re-points that credential at another host.
 *
 * A page fetch IS its own origin, so `request.url` answers for it. A sub-fetch is
 * not: its URL is a host the crawled page named, and normalizing against that
 * re-synthesizes a domain-less cookie onto that host and hands it to whatever the
 * host redirects to — measured, an off-host image answering `302` on its own host
 * received a cookie the caller had scoped to the page. Every sub-fetch therefore
 * declares the page's URL through {@link subFetchOriginContext}, and that declaration
 * wins here.
 *
 * `undefined` means "no origin this hook may trust", and its caller drops the header
 * rather than re-deriving one. Both the malformed cases reach it deliberately. A
 * declared origin that is not a string is caller error, and a `url` that is neither
 * string nor `URL` is unreachable by the declared type and kept for a caller that
 * violates it: falling back to the hop's own target for either is exactly the
 * re-scoping this function exists to prevent.
 */
function crawlOriginUrl(request: { url: string | URL; context?: unknown }): string | undefined {
  const { context } = request;
  if (typeof context === 'object' && context !== null && CRAWL_ORIGIN_CONTEXT_KEY in context) {
    const declared = (context as Record<string, unknown>)[CRAWL_ORIGIN_CONTEXT_KEY];
    return typeof declared === 'string' ? declared : undefined;
  }
  const { url } = request;
  return typeof url === 'string' ? url : url instanceof URL ? url.href : undefined;
}

/**
 * A `GotScrapingHttpClient` that re-derives the `Cookie` header on every redirect.
 *
 * got strips `cookie` only when the hostname or port changes
 * (`got@14.6.6/dist/source/core/index.js:676-684`), and an https -> http downgrade on
 * one host compares equal on both, because each serializes its default port as ''. A
 * statically-set header therefore survives a hop that leaves the cookie's scope —
 * measured against a local server, where `/private/start` 302 -> `/public` delivered
 * the `/private/`-scoped `sess=SECRET` to `/public`.
 *
 * A cookie jar does not fix it: got assigns `headers.cookie` from a jar only when the
 * jar returns a non-empty string (`core/index.js:1101-1105`), so a jar correctly
 * returning nothing for the new scope leaves the previous hop's header in place.
 * `hooks.beforeRedirect` is authoritative because it edits `updatedOptions.headers`.
 */
export function createRescopingHttpClient(initialCookies: readonly unknown[]): BaseHttpClient {
  const withHook = <TResponseType extends keyof ResponseTypes>(
    request: HttpRequest<TResponseType>,
  ): HttpRequest<TResponseType> => {
    // Captured per call, so every hop is scoped against the origin the crawl asked
    // for — the same origin the pre-navigation hook used.
    const originUrl = crawlOriginUrl(request);
    const beforeRedirect = (updatedOptions: {
      url?: URL | string;
      headers?: Record<string, unknown>;
    }): void => {
      const target = updatedOptions.url;
      const href = typeof target === 'string' ? target : target?.href;
      if (href === undefined) return;
      updatedOptions.headers ??= {};
      const headers = updatedOptions.headers;
      // No readable origin means no scope to normalize against, and falling back to
      // the hop's own target is precisely the re-scoping this hook prevents. Drop the
      // header rather than re-deriving one for a scope the caller never named.
      const header =
        originUrl === undefined
          ? undefined
          : httpBranchCookieHeader(href, initialCookies, originUrl);
      // Assign or delete — never leave the previous hop's value standing.
      if (header === undefined) delete headers.cookie;
      else headers.cookie = header;
    };
    const hooks = (request.hooks ?? {}) as Record<string, unknown>;
    const existing = (hooks.beforeRedirect ?? []) as unknown[];
    return { ...request, hooks: { ...hooks, beforeRedirect: [...existing, beforeRedirect] } };
  };

  return new (class extends GotScrapingHttpClient {
    override async sendRequest<TResponseType extends keyof ResponseTypes>(
      request: HttpRequest<TResponseType>,
    ): Promise<HttpResponse<TResponseType>> {
      return super.sendRequest(withHook(request));
    }

    override async stream(
      request: HttpRequest,
      handleRedirect?: RedirectHandler,
    ): Promise<StreamingHttpResponse> {
      return super.stream(withHook(request), handleRedirect);
    }
  })();
}

/**
 * The caller's transferable request identity — `extraHTTPHeaders`, `userAgent` and
 * whichever initial cookies are in scope — as headers for one target URL.
 *
 * `originUrl` is the URL the crawl asked for and `targetUrl` the request about to go
 * out. On a page fetch they are the same. On a sub-fetch they are not, and the
 * distinction is the whole point: `normalizeCookies` synthesizes a bare
 * `{name, value}`'s scope from the url it is handed, so normalizing against the
 * sub-fetch would re-point a credential at whatever host the page happened to
 * reference. Scoped against the page and then filtered by `cookiesForUrl`, a cookie
 * the caller confined to one host stays there while one the caller gave a wider
 * `domain` still reaches a sibling host — the same answer the browser branch's jar
 * gives.
 */
function callerTransferableHeaders(
  targetUrl: string,
  opts: Pick<MarkdowneeCrawlerOptions, 'extraHTTPHeaders' | 'userAgent'>,
  initialCookies: readonly unknown[] | undefined,
  originUrl: string,
): Record<string, string> {
  const cookieHeader = httpBranchCookieHeader(targetUrl, initialCookies ?? [], originUrl);
  return {
    ...(opts.extraHTTPHeaders ?? {}),
    ...(opts.userAgent ? { 'user-agent': opts.userAgent } : {}),
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
  };
}

export function applyHttpBranchHeaders(
  request: { url: string; headers?: Record<string, string> },
  opts: MarkdowneeCrawlerOptions,
  initialCookies?: readonly unknown[],
): void {
  // `cookiesForUrl` scopes for THIS url; `createRescopingHttpClient` re-derives the
  // header on every later hop, which is what makes sending `secure` cookies here
  // safe — the scope test runs against the actual hop rather than the first one.
  // Same-host PATH scope is deliberately not restricted on a single hop:
  // RFC 6265 §8.5 states the Path attribute is not a security boundary.
  // `httpBranchCookieHeader` normalizes FIRST, exactly as the browser branch does
  // before `addCookies`, and applies the same scope reading the redirect hook uses,
  // so the first hop and every later one cannot disagree.
  const transferable = callerTransferableHeaders(request.url, opts, initialCookies, request.url);
  request.headers = {
    ...(request.headers ?? {}),
    ...transferable,
    ...(transferable.cookie
      ? { cookie: [request.headers?.cookie, transferable.cookie].filter(Boolean).join('; ') }
      : {}),
  };
}

function buildImageOptions(opts: MarkdowneeCrawlerOptions): HandlerImageOptions | undefined {
  if (opts.imageHandling !== 'save') return undefined;
  let kvsPromise: Promise<KvsLike> | undefined;
  const getKvs = (): Promise<KvsLike> => {
    kvsPromise ??= opts.imageKvs
      ? Promise.resolve(opts.imageKvs)
      : KeyValueStore.open(
          null,
          opts.configuration ? { config: opts.configuration } : undefined,
        ).then(
          (store): KvsLike => ({
            setValue: (key, value, options) => store.setValue(key, value, options),
          }),
        );
    return kvsPromise;
  };
  return {
    getKvs,
    maxImageEdge: opts.maxImageEdge ?? 1568,
    rasterizeSvg: opts.rasterizeSvg ?? true,
    saveOriginal: opts.saveOriginalImages ?? false,
  };
}

export function createMarkdowneeCrawler(
  opts: MarkdowneeCrawlerOptions,
): CheerioCrawler | AdaptivePlaywrightCrawler | PlaywrightCrawler {
  const crawlerType = opts.crawlerType ?? CrawlerType.PlaywrightAdaptive;
  // Firefox's Playwright adapter silently discards `partitionKey`, so a partitioned
  // cookie cannot be honoured on that backend and must not be sent unpartitioned.
  const partitionsSupported = crawlerType !== CrawlerType.PlaywrightFirefox;

  if (
    opts.blockMedia &&
    opts.blockMediaExplicit &&
    crawlerType !== CrawlerType.PlaywrightChromium &&
    crawlerType !== CrawlerType.PlaywrightAdaptive
  ) {
    (opts.log ?? log).warning(
      `blockMedia has no effect with crawlerType: ${crawlerType}. It only works with playwright-chromium and playwright-adaptive.`,
    );
  }

  const cookieStrategy = opts.cookieStrategy ?? 'ghostery';
  // Consent-DOM stripping is gated on cookie handling being enabled. It is a
  // content-cleanup concern (remove server-rendered consent text before
  // extraction), distinct from ghostery's network/cosmetic blocking, and must
  // run on every crawler type — including cheerio, where the idnes consent-or-pay
  // disclaimer reproduces over raw HTTP with no browser involved.
  const stripConsent = cookieStrategy === 'ghostery';
  const formats = opts.formats ?? ['markdown'];
  const deduplication = opts.deduplication ?? Deduplication.Standard;
  const seenCanonicals = new Set<string>();
  const seenContentHashes = new Set<string>();
  const images = buildImageOptions(opts);
  const markdownDiscovery = opts.markdownDiscovery ?? MarkdownDiscovery.Off;
  const marksDown = markdownDiscovery !== MarkdownDiscovery.Off;
  // One budget per crawler, so an origin that has repeatedly proved it publishes
  // no `.md` sibling stops being probed for the rest of the run.
  const markdownBudget = new OriginProbeBudget();
  /**
   * One cancellation registry per crawler, wired to the failure hooks below.
   * Crawlee's request-handler timeout rejects the promise it raced the handler
   * in without interrupting the handler, so without this a request the crawler
   * has already failed keeps fetching and still reaches the sink — one URL
   * producing both a failed record and a success record. See
   * {@link RunCancellation}.
   */
  const cancellation = new RunCancellation();
  /**
   * The failure hooks every crawler type installs. Crawlee calls exactly one of
   * them for a failed request, with the same crawling context the handler was
   * given, immediately after the timeout rejection: `errorHandler` when the
   * request will be retried, `failedRequestHandler` when it will not. Neither
   * may throw — Crawlee tags an exception raised in a user handler as a
   * secondary error and terminates the crawl — and `cancel` is written so it
   * cannot. `failedRequestHandler` is installed unconditionally rather than only
   * when the caller wants failure records, because cancellation does not depend
   * on that; Crawlee logs the failure either way.
   */
  const failureHooks = {
    errorHandler: async ({ id }: CrawlingContext): Promise<void> => {
      cancellation.cancel(id);
    },
    failedRequestHandler: async ({ id, request }: CrawlingContext, error: Error): Promise<void> => {
      cancellation.cancel(id);
      await opts.onFailedRequest?.({
        url: request.url,
        loadedUrl: request.loadedUrl ?? null,
        errorMessages: [...(request.errorMessages ?? []), error.message],
        retryCount: request.retryCount,
      });
    },
  };
  /**
   * One robots.txt gate per crawler, and only when the run respects robots.txt.
   * Discovery fetches are never queued, so Crawlee's own enforcement never sees
   * them — see {@link MarkdownRobotsGate}.
   *
   * The proxy each lookup rides is supplied per call by the handler, from the
   * context of the request that provoked it. All the gate is told here is whether
   * this run configured a proxy at all, so that a lookup reaching it without one
   * is reported rather than passing silently for a direct fetch.
   */
  const markdownRobots =
    marksDown && opts.respectRobotsTxt === true
      ? new MarkdownRobotsGate(opts.proxyConfiguration !== undefined)
      : undefined;
  /**
   * This crawler's HTTP client, named here rather than left to Crawlee to
   * default, because the Cheerio handler needs `stream()` on the very client the
   * crawl rides: a discovery fetch has to be able to stop reading an oversize
   * body mid-transfer, and `context.sendRequest` only ever resolves with one
   * already buffered. `new GotScrapingHttpClient()` is exactly what Crawlee
   * assigns when the option is absent, so naming it changes nothing for a run
   * with no initial cookies.
   */
  const httpClient: BaseHttpClient =
    opts.initialCookies && opts.initialCookies.length > 0
      ? createRescopingHttpClient(opts.initialCookies)
      : new GotScrapingHttpClient();
  /** The fields every handler needs for this feature, or nothing when it is off. */
  const markdownHandlerOpts = marksDown
    ? {
        markdownDiscovery,
        markdownBudget,
        ...(markdownRobots !== undefined ? { markdownRobots } : {}),
        ...(opts.outputLayout !== undefined ? { outputLayout: opts.outputLayout } : {}),
      }
    : {};
  /** Whether this path's own page fetch should carry the Markdown Accept. */
  const negotiatesOnPageFetch =
    markdownDiscovery === MarkdownDiscovery.Negotiate ||
    markdownDiscovery === MarkdownDiscovery.Probe;

  /**
   * What a handler's sub-fetches — image bytes, an advertised Markdown alternate, a
   * re-fetch of a mistyped body — must merge beneath their own headers. Crawlee's
   * `sendRequest` spreads a fetcher's `headers` override last over the origin
   * request's, so without this every one of them goes out with got-scraping's
   * fabricated User-Agent and none of the caller's credentials, behind a page fetch
   * that carried all three. Built from the same helper as the page fetch so the two
   * cannot drift, and re-scoped per target URL rather than copied, so a cookie the
   * caller confined to the page's host never rides an off-host image request.
   */
  const subFetchHeaders = (targetUrl: string, pageUrl: string): Record<string, string> =>
    callerTransferableHeaders(targetUrl, opts, opts.initialCookies, pageUrl);

  if (crawlerType === CrawlerType.Cheerio) {
    const handler = createCheerioHandler({
      extractionConfig: toTrafilaturacoreConfig(opts),
      sink: opts.sink,
      formats,
      maxResults: opts.maxResults,
      selector: opts.selector,
      maxCrawlDepth: opts.maxCrawlDepth,
      globs: opts.globs,
      exclude: opts.exclude,
      keepUrlFragment: opts.keepUrlFragment,
      onSkippedUrl: opts.onSkippedUrl,
      // The one wait option this crawler can honour. It runs no JavaScript, so
      // there is nothing to wait for, but the required selector is a validation
      // contract every crawler type owes: the handler enforces it against the
      // served document. `softWaitForSelector`, `scroll` and
      // `waitForDynamicContentSecs` stay omitted — the first cannot fail a
      // request, and the other two are the browser-only behaviour SPEC.md
      // excludes from Cheerio.
      waitForSelector: opts.waitForSelector,
      stripConsent,
      deduplication,
      seenCanonicals,
      seenContentHashes,
      images,
      cancellation,
      subFetchHeaders,
      httpClient,
      ...markdownHandlerOpts,
    });

    const cheerioSessionPoolOpts = {
      ...(typeof opts.sessionPool === 'object' ? opts.sessionPool : {}),
      ...(opts.sessionPoolName ? { persistStateKey: opts.sessionPoolName } : {}),
    };

    const cheerioPreHooks: NonNullable<CheerioCrawlerOptions['preNavigationHooks']> = [];
    // The three transferable options, applied through the SAME helper the adaptive
    // HTTP branch uses, so the two HTTP paths cannot drift apart. It writes
    // `ctx.request.headers` rather than `gotOptions.headers`, which is deliberate and
    // was measured: `HttpCrawler._getRequestOptions` merges both into the page fetch
    // request-first, and `request.headers` ALSO reaches `ctx.sendRequest`, which
    // `gotOptions.headers` does not — so writing the got channel alone would leave
    // every sub-fetch unauthenticated behind a page fetch that looked fixed. Crawlee
    // then merges the `cookie` set here with any session cookie and re-emits a single
    // `Cookie` header, so one casing is written and no duplicate goes out.
    if (
      opts.userAgent ||
      (opts.extraHTTPHeaders && Object.keys(opts.extraHTTPHeaders).length > 0) ||
      (opts.initialCookies && opts.initialCookies.length > 0)
    ) {
      cheerioPreHooks.push((ctx): void => {
        applyHttpBranchHeaders(ctx.request, opts, opts.initialCookies);
      });
    }
    // The Markdown `Accept`, last so it wins over a caller-supplied one exactly as it
    // does on the adaptive branch. Set lowercase, on `gotOptions.headers`, and with
    // the generator left on: got-scraping merges the caller's headers over the
    // generated ones and the caller wins, which was re-measured against the installed
    // 4.2.1 rather than assumed.
    if (negotiatesOnPageFetch) {
      cheerioPreHooks.push((_ctx, gotOptions): void => {
        gotOptions.headers = { ...(gotOptions.headers ?? {}), accept: MARKDOWN_ACCEPT };
      });
    }

    const crawler = new CheerioCrawler(
      {
        ...(opts.log ? { log: opts.log } : {}),
        useSessionPool: opts.sessionPool !== false,
        ...(Object.keys(cheerioSessionPoolOpts).length > 0
          ? { sessionPoolOptions: cheerioSessionPoolOpts }
          : {}),
        maxRequestsPerCrawl:
          opts.maxRequestsPerCrawl && opts.maxRequestsPerCrawl > 0
            ? opts.maxRequestsPerCrawl
            : undefined,
        maxRequestRetries: opts.maxRetries ?? 3,
        maxSessionRotations: opts.maxSessionRotations ?? 10,
        ...(opts.initialConcurrency ? { minConcurrency: opts.initialConcurrency } : {}),
        ...(opts.maxConcurrency !== undefined ? { maxConcurrency: opts.maxConcurrency } : {}),
        ...(opts.navigationTimeoutSecs !== undefined
          ? { requestHandlerTimeoutSecs: opts.navigationTimeoutSecs }
          : {}),
        ...(opts.respectRobotsTxt !== undefined
          ? { respectRobotsTxtFile: opts.respectRobotsTxt }
          : {}),
        proxyConfiguration: opts.proxyConfiguration,
        requestQueue: opts.requestQueue,
        ...(opts.requestList !== undefined ? { requestList: opts.requestList } : {}),
        // The two HTML types are already in Crawlee's five-type default, so this
        // line only ever does anything when the Markdown types are added to it.
        // The widening is gated on the option rather than unconditional: without
        // the type admitted a Markdown response is a hard request FAILURE, not a
        // skip ("served Content-Type text/markdown, but only … are allowed"), and
        // with it admitted every `text/plain` response is admitted too — which an
        // `off` run has no reason to accept, and which is what keeps `off`
        // byte-identical to a build without this feature.
        //
        // `text/plain` has to be in the set even though it is not a Markdown
        // type: one origin family serves Markdown under it, and a `406`/`415`
        // refusal body is commonly typed `text/plain` — without it that refusal
        // fails the request instead of arriving as a fallback signal.
        //
        // Gated on the rung that actually sends the header, not merely on the
        // option being on. At `alternate` the page fetch is an ordinary HTML
        // request, so widening the accepted types there would admit every
        // `text/plain` response and turn a genuine 406/415 page into a success —
        // two behaviour changes bought for a rung that never negotiates.
        additionalMimeTypes: negotiatesOnPageFetch
          ? ['text/html', 'application/xhtml+xml', 'text/markdown', 'text/x-markdown', 'text/plain']
          : ['text/html', 'application/xhtml+xml'],
        // Treat a negotiation refusal as a response to inspect rather than an
        // error to retry — again only on the rung that asked. Every other status,
        // and every other rung, keeps Crawlee's own error handling untouched.
        ...(negotiatesOnPageFetch ? { ignoreHttpErrorStatusCodes: [406, 415] } : {}),
        ...(cheerioPreHooks.length > 0 ? { preNavigationHooks: cheerioPreHooks } : {}),
        // With initial cookies this is the re-scoping client: `GotScrapingHttpClient`
        // forces `cookieJar: undefined`, so the `Cookie` header the hook above sets for
        // the first hop would otherwise ride the whole redirect chain unchanged.
        // Measured: a `/private/start` -> `/public` hop on one host delivered a
        // `/private/`-scoped cookie to `/public`. Without them it is the plain client
        // Crawlee would have built itself, passed rather than defaulted so that the
        // handler's Markdown discovery can stream off this same client. `httpClient` is
        // declared on `BasicCrawler.optionsShape`, which `HttpCrawler.optionsShape`
        // spreads, so `ow.object.exactShape` accepts it here — unlike
        // `ignoreHttpErrorStatusCodes` on the adaptive crawler.
        httpClient,
        ...failureHooks,
      },
      opts.configuration,
    );
    crawler.router.addDefaultHandler(handler);
    return crawler;
  }

  const launcher = crawlerType === 'playwright-firefox' ? 'firefox' : 'chromium';

  // The name alone is not enough: `launchContext.launcher` takes the Playwright
  // browser *object*, and when it is absent Crawlee's `PlaywrightLauncher` falls
  // back to `playwright.chromium` — which made `playwright-firefox` silently
  // launch Chromium. Resolved here, past the cheerio early-return and with a
  // sync require, so cheerio runs never load Playwright and this factory stays
  // synchronous; Crawlee itself defers the same require to this exact point.
  const playwright = createRequire(import.meta.url)('playwright') as typeof import('playwright');
  const launcherBrowser = playwright[launcher];

  const launchOptions = buildBrowserLaunchOptions({
    launcher,
    ignoreHttpsErrors: opts.ignoreHttpsErrors,
  });

  const useSessionPool = opts.sessionPool !== false;
  const userSessionPoolOptions =
    typeof opts.sessionPool === 'object' ? opts.sessionPool : undefined;

  const rotation = opts.proxyRotation ?? ProxyRotation.Recommended;
  const maxUsageCount = SESSION_MAX_USAGE_COUNTS[rotation];
  const rotationSessionPoolOptions = {
    sessionOptions: {
      ...(userSessionPoolOptions?.sessionOptions ?? {}),
      ...(maxUsageCount !== undefined ? { maxUsageCount } : {}),
    },
    ...(rotation === ProxyRotation.UntilFailure ? { maxPoolSize: 1 } : {}),
  };

  const sessionPoolOptions = {
    ...(userSessionPoolOptions ? { ...userSessionPoolOptions } : {}),
    ...rotationSessionPoolOptions,
    ...(opts.sessionPoolName ? { persistStateKey: opts.sessionPoolName } : {}),
  };

  // Browser-context options ride in `launchContext.launchOptions`, NOT in a
  // `contextOptions` key: Crawlee validates the launcher with `ow.object.exactShape`
  // and `contextOptions` is not in the shape, so attaching it aborted every Playwright
  // crawl before its first request. `PlaywrightPlugin._launch` passes `launchOptions`
  // straight to `launchPersistentContext`, which takes launch AND context options in
  // one bag, so this is the slot Playwright actually reads. `launchContextOptions`
  // passes validation but is then dropped by `BrowserPlugin`'s constructor — it is a
  // dead option, do not reach for it.
  const contextLaunchOptions = {
    ...launchOptions,
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    ...(opts.bypassCSP ? { bypassCSP: true } : {}),
    ...(opts.extraHTTPHeaders && Object.keys(opts.extraHTTPHeaders).length > 0
      ? { extraHTTPHeaders: opts.extraHTTPHeaders }
      : {}),
  };

  const baseOptions = {
    ...(opts.log ? { log: opts.log } : {}),
    headless: opts.headless ?? true,
    ...browserRequestTimeouts(opts),
    launchContext: {
      launcher: launcherBrowser,
      launchOptions: contextLaunchOptions,
      // Also top-level, and not redundant: this is the switch that sets
      // `useFingerprints = false`. Without it Crawlee's fingerprint pre-launch hook
      // runs last and overwrites `launchOptions.userAgent` with a generated one.
      ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    },
    useSessionPool,
    persistCookiesPerSession: useSessionPool,
    sessionPoolOptions,
    maxRequestsPerCrawl:
      opts.maxRequestsPerCrawl && opts.maxRequestsPerCrawl > 0
        ? opts.maxRequestsPerCrawl
        : undefined,
    maxRequestRetries: opts.maxRetries ?? 3,
    maxSessionRotations: opts.maxSessionRotations ?? 10,
    ...(opts.initialConcurrency ? { minConcurrency: opts.initialConcurrency } : {}),
    ...(opts.maxConcurrency !== undefined ? { maxConcurrency: opts.maxConcurrency } : {}),
    ...(opts.respectRobotsTxt !== undefined ? { respectRobotsTxtFile: opts.respectRobotsTxt } : {}),
    proxyConfiguration: opts.proxyConfiguration,
    requestQueue: opts.requestQueue,
    ...(opts.requestList !== undefined ? { requestList: opts.requestList } : {}),
  };

  if (crawlerType === CrawlerType.PlaywrightAdaptive) {
    const adaptivePreHooks: AdaptivePlaywrightCrawlerOptions['preNavigationHooks'] = [];
    const waitUntil = opts.waitUntil;
    if (waitUntil !== undefined) {
      adaptivePreHooks.push(async (_ctx, gotoOptions) => {
        if (gotoOptions) gotoOptions.waitUntil = waitUntil;
      });
    }
    // Cookies cannot ride in `launchOptions` — `launchPersistentContext` has no
    // `storageState` parameter and silently ignores one — so they go through the
    // hook Crawlee documents for exactly this. First in the list, so it runs before
    // the hooks below touch the page.
    if (opts.initialCookies && opts.initialCookies.length > 0) {
      const initialCookies = opts.initialCookies;
      adaptivePreHooks.push(async (ctx) => {
        const page = optionalPage(ctx);
        if (page) {
          await page
            .context()
            .addCookies(normalizeCookies(initialCookies, ctx.request.url, partitionsSupported));
          return;
        }
        applyHttpBranchHeaders(ctx.request, opts, initialCookies);
      });
    }
    if (
      opts.userAgent ||
      (opts.extraHTTPHeaders && Object.keys(opts.extraHTTPHeaders).length > 0)
    ) {
      // The HTTP-only branch never sees `launchContext`, so the three transferable
      // values have to be restated as request headers there.
      adaptivePreHooks.push(async (ctx) => {
        if (optionalPage(ctx)) return;
        applyHttpBranchHeaders(ctx.request, opts);
      });
    }
    // The ordered Accept, set on the request itself so the HTTP-only branch's own
    // fetch carries it. That is the one channel this hook has — it receives no
    // `sendRequest`, and reading `page` here would abort the HTTP attempt and
    // re-run the whole request in a browser, which is precisely the cost the
    // branch exists to avoid. Measured: the header reaches the origin unmodified,
    // and the served Markdown then arrives on `context.response` at no extra
    // request. The browser branch is deliberately skipped: Chromium ignores a set
    // `Accept` on main-frame navigation anyway, and its handler fetches through
    // `page.request` instead.
    if (negotiatesOnPageFetch) {
      adaptivePreHooks.push(async (ctx) => {
        if (optionalPage(ctx)) return;
        ctx.request.headers = { ...(ctx.request.headers ?? {}), accept: MARKDOWN_ACCEPT };
      });
    }
    if (opts.blockMedia) {
      adaptivePreHooks.push(async (ctx) => {
        const page = optionalPage(ctx);
        if (page) await playwrightUtils.blockRequests(page);
      });
    }
    if (cookieStrategy === 'ghostery') {
      adaptivePreHooks.push(async (ctx) => {
        const page = optionalPage(ctx);
        if (page) await installCookieDefences(page);
      });
    }

    const adaptiveHandler = createAdaptiveHandler({
      extractionConfig: toTrafilaturacoreConfig(opts),
      sink: opts.sink,
      scroll: opts.scroll,
      formats,
      maxResults: opts.maxResults,
      selector: opts.selector,
      maxCrawlDepth: opts.maxCrawlDepth,
      globs: opts.globs,
      exclude: opts.exclude,
      keepUrlFragment: opts.keepUrlFragment,
      onSkippedUrl: opts.onSkippedUrl,
      waitForDynamicContentSecs: opts.waitForDynamicContentSecs,
      waitForSelector: opts.waitForSelector,
      softWaitForSelector: opts.softWaitForSelector,
      stripConsent,
      deduplication,
      seenCanonicals,
      seenContentHashes,
      images,
      cancellation,
      subFetchHeaders,
      // Unconditionally, not with the Markdown options: the adaptive HTTP-only
      // image fallback rides this client so its redirects are re-scoped per hop,
      // and it must do so on a run with Markdown discovery off.
      httpClient,
      ...markdownHandlerOpts,
      ...(opts.minHttpExtractionChars !== undefined
        ? { minHttpExtractionChars: opts.minHttpExtractionChars }
        : {}),
    });
    const adaptiveCrawler = new ProxyBoundAdaptivePlaywrightCrawler(
      {
        ...baseOptions,
        preventDirectStorageAccess: false,
        // No `ignoreHttpErrorStatusCodes` here, unlike the Cheerio crawler.
        // `AdaptivePlaywrightCrawler` validates against `PlaywrightCrawlerOptions`
        // with `ow.object.exactShape`, which has no such member, so passing it
        // throws at CONSTRUCTION — on the default crawler type, at `negotiate` and
        // `probe`, before a single request. The adaptive HTTP-only branch does not
        // need it either: it already surfaces a refusal as a response rather than
        // an error, which is why that refusal is gated on status in the handler.
        renderingTypeDetectionRatio: opts.renderingTypeDetectionRatio ?? 0.1,
        // Detection stays off unless the caller asks for a positive ratio. The
        // check must accept 0 as well as undefined: the input schema defaults
        // this field to 0 and every product surface forwards it, so a guard on
        // undefined alone would leave the predictor uninstalled everywhere.
        ...(!opts.renderingTypeDetectionRatio
          ? { renderingTypePredictor: ALWAYS_BROWSER_PREDICTOR }
          : {}),
        ...(adaptivePreHooks.length > 0 ? { preNavigationHooks: adaptivePreHooks } : {}),
        // The HTTP-only branch has no cookie jar — `GotScrapingHttpClient` forces
        // `cookieJar: undefined` — so with initial cookies the `Cookie` header set by
        // the hook above would otherwise ride the whole redirect chain unchanged.
        // Without them this is the plain client Crawlee would have built itself.
        // `httpClient` is a validated `BasicCrawlerOptions` field that the adaptive
        // crawler accepts.
        httpClient,
        ...failureHooks,
      },
      opts.configuration,
    );
    adaptiveCrawler.router.addDefaultHandler(adaptiveHandler);
    return adaptiveCrawler;
  }

  const preNavigationHooks: PlaywrightHook[] = [];
  const waitUntil = opts.waitUntil;
  if (waitUntil !== undefined) {
    preNavigationHooks.push(async (_ctx, gotoOptions) => {
      if (gotoOptions) gotoOptions.waitUntil = waitUntil;
    });
  }
  if (opts.initialCookies && opts.initialCookies.length > 0) {
    const initialCookies = opts.initialCookies;
    preNavigationHooks.push(async ({ page, request }) => {
      await page
        .context()
        .addCookies(normalizeCookies(initialCookies, request.url, partitionsSupported));
    });
  }
  // Not on Firefox: `blockRequests` opens a CDP session, which only Chromium has.
  // While `playwright-firefox` silently launched Chromium the hook happened to
  // work; with the real Firefox launcher every page would attempt the session and
  // Crawlee would log its incompatibility warning per navigation. The schema
  // documents blockMedia as Chromium-only and the warning above already says so.
  if (opts.blockMedia && crawlerType !== CrawlerType.PlaywrightFirefox) {
    preNavigationHooks.push(async ({ page }) => playwrightUtils.blockRequests(page));
  }
  if (cookieStrategy === 'ghostery') {
    preNavigationHooks.push(async ({ page }) => installCookieDefences(page));
  }

  const handler = createHandler({
    extractionConfig: toTrafilaturacoreConfig(opts),
    sink: opts.sink,
    scroll: opts.scroll,
    formats,
    maxResults: opts.maxResults,
    selector: opts.selector,
    maxCrawlDepth: opts.maxCrawlDepth,
    globs: opts.globs,
    exclude: opts.exclude,
    keepUrlFragment: opts.keepUrlFragment,
    onSkippedUrl: opts.onSkippedUrl,
    waitForDynamicContentSecs: opts.waitForDynamicContentSecs,
    waitForSelector: opts.waitForSelector,
    softWaitForSelector: opts.softWaitForSelector,
    stripConsent,
    deduplication,
    seenCanonicals,
    seenContentHashes,
    images,
    cancellation,
    ...markdownHandlerOpts,
  });

  const crawler = new PlaywrightCrawler(
    {
      ...baseOptions,
      ...(preNavigationHooks.length > 0 ? { preNavigationHooks } : {}),
      ...failureHooks,
    },
    opts.configuration,
  );
  crawler.router.addDefaultHandler(handler);
  return crawler;
}

export function buildRequests(startUrls: string[], keepUrlFragment = false): Request[] {
  return startUrls.map((url) => new Request({ url, keepUrlFragment: keepUrlFragment }));
}
