import { gotScraping, RobotsTxtFile } from 'crawlee';

/**
 * The channel the gate reports on — an unexpectedly absent proxy, and a lookup it
 * could not reach. Crawlee's `log` satisfies it.
 */
interface RobotsGateLog {
  warning(message: string): void;
}

/**
 * RFC 9309 §2.3.1.3: a robots.txt the server reports "unavailable" leaves the
 * crawler free to access anything. An empty file is how that is said in the
 * format itself — no groups, so no rule ever matches.
 */
const UNAVAILABLE = '';

/**
 * RFC 9309 §2.3.1.4: a robots.txt that is unreachable is undefined, and the
 * crawler MUST assume complete disallow.
 */
const UNREACHABLE = 'User-agent: *\nDisallow: /\n';

/**
 * Whether a rejection is got giving up on a redirect chain rather than failing to
 * reach the host. Matched by code rather than by class: `got-scraping`'s error
 * types are not re-exported through `crawlee`, so `instanceof` is not available
 * to this package.
 */
function isRedirectLimit(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_TOO_MANY_REDIRECTS'
  );
}

/**
 * A robots.txt gate for the discovery fetches Crawlee never sees.
 *
 * Crawlee enforces `respectRobotsTxtFile` against the request QUEUE. None of the
 * fetches this feature makes is ever queued — they go out through
 * `context.sendRequest` and `page.request.get` — so without this a run
 * configured to respect robots.txt was measured fetching a `Disallow:`d
 * advertised alternate and a `Disallow:`d `.md` sibling, on both channels, and
 * emitting their bodies as page content.
 *
 * A lookup is classified by RFC 9309 rather than by whether it threw. A served
 * file supplies its rules; a status reporting the file UNAVAILABLE allows
 * everything (§2.3.1.3); a file left undefined by a server or network error
 * assumes complete disallow (§2.3.1.4). The gate used to allow everything in
 * all three cases, which is what Crawlee's own enforcement does and which the
 * standard's rule for an ABSENT robots.txt covers — but not its rule for an
 * UNREACHABLE one, where the requirement is the opposite.
 *
 * One `robots.txt` per origin per crawl, fetched at most once even under
 * concurrency because the in-flight promise is what gets cached. That includes
 * the complete-disallow verdict: §2.4 licenses holding an unreachable result
 * longer than a fetched one, not for less time, and re-asking an origin that is
 * already answering 5xx once per candidate is the amplification the memoization
 * exists to prevent. Being held out costs the origin its served-Markdown
 * representation for the run, not its pages — a refused candidate is extracted
 * from HTML the ordinary way.
 *
 * The lookup is made here rather than through `RobotsTxtFile.find`, because
 * `find` cannot report the one thing this class has to know. It calls
 * `gotScraping`, which ships `throwHttpErrors: false`, so a 5xx resolves like a
 * 200 and its error page is parsed as rules — yielding no rules, hence an allow.
 * Its 404 branch never runs, and the status is discarded before it returns.
 * Fetching here keeps `RobotsTxtFile.from`, the same constructor `find` ends in,
 * so a served robots.txt is parsed exactly as before.
 *
 * The lookup rides the proxy of the request that provoked it. That URL is
 * supplied per call rather than held on the gate, because the gate is one per
 * crawler while the proxy is per session: the caller passes the value its own
 * crawling context already resolved, which is the identical URL the discovery
 * fetch this lookup authorises travels on, so an origin is consulted from the
 * address it is then crawled from. Reading the resolved value is deliberate —
 * allocating a fresh one through `ProxyConfiguration.newUrl()` advances the
 * round-robin cursor and, on a tiered configuration, flattens every tier, so a
 * robots lookup would silently perturb proxy assignment for the rest of the run.
 * Since the file is fetched once per origin, whichever request reaches an origin
 * first fixes which proxy that origin's lookup used.
 */
export class MarkdownRobotsGate {
  private readonly files = new Map<string, Promise<RobotsTxtFile>>();

  /**
   * @param proxyConfigured whether the run configured a proxy at all. Only used
   * to decide whether an absent per-call `proxyUrl` is expected or is an anomaly
   * worth reporting: silence is what let this lookup leave outside a configured
   * proxy unnoticed in the first place.
   */
  constructor(private readonly proxyConfigured = false) {}

  async allows(url: string, proxyUrl?: string, log?: RobotsGateLog): Promise<boolean> {
    let origin: string;
    try {
      const parsed = new URL(url);
      // Discovery only ever offers an `http(s)` candidate — both
      // `advertisedMarkdownAlternates` and `siblingMarkdownUrl` reject any other
      // scheme — and the scheme has to be checked anyway: `URL.origin` is the
      // literal string `"null"` for every other scheme, which would make the
      // robots.txt URL relative. `robots-parser` then relates no rule to the
      // candidate and measures as allowed — a complete disallow that silently
      // permits. Refuse instead, matching what discovery would do with it.
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
      origin = parsed.origin;
    } catch {
      return false;
    }
    let file = this.files.get(origin);
    if (file === undefined) {
      if (this.proxyConfigured && proxyUrl === undefined) {
        // Every path that reaches this gate has `proxyInfo` assigned before the
        // handler runs — `@crawlee/http` `http-crawler.js:300`, `@crawlee/browser`
        // `browser-crawler.js:243-246` — so an absent value means something
        // upstream changed. The lookup still goes out, because refusing it here
        // would assume a disallow for a reason the standard says nothing about.
        log?.warning(
          `No resolved proxy is available for ${origin}/robots.txt despite this run's proxy configuration`,
        );
      }
      file = this.load(`${origin}/robots.txt`, proxyUrl, log);
      this.files.set(origin, file);
    }
    return (await file).isAllowed(url);
  }

  /**
   * Fetch one origin's robots.txt and turn whatever came back into a policy.
   *
   * CRAWLEE v4 MIGRATION: this must keep issuing the request through a
   * proxy-capable client. `gotScraping` proxies on its own; Crawlee v4's
   * `BaseHttpClient` defaults to `FetchHttpClient`, whose own docstring says it
   * does not support proxying, so swapping in `sendRequest` without naming an
   * `ImpitHttpClient` re-leaks the lookup silently. It must also keep reading the
   * response status — that is the whole reason this does not call
   * `RobotsTxtFile.find`.
   */
  private async load(
    url: string,
    proxyUrl: string | undefined,
    log: RobotsGateLog | undefined,
  ): Promise<RobotsTxtFile> {
    let status: number;
    let body: string;
    try {
      const response = await gotScraping({ url, proxyUrl, method: 'GET', responseType: 'text' });
      status = response.statusCode;
      body = response.body;
    } catch (error) {
      // §2.3.1.2 ends an unresolved redirect chain at "unavailable", not at
      // unreachable, so this one rejection is an allow. Everything else here is
      // a network error: DNS, refused, reset, timed out, or the proxy failing —
      // and proxying the lookup is what added those last modes.
      if (isRedirectLimit(error)) return RobotsTxtFile.from(url, UNAVAILABLE, proxyUrl);
      return this.unreachable(url, String(error), proxyUrl, log);
    }
    if (status >= 200 && status < 300) return RobotsTxtFile.from(url, body, proxyUrl);
    // A redirect surfacing unfollowed is the same unresolved chain as above.
    // 429 is the one 4xx held back from §2.3.1.3, matching Google's crawler:
    // "all 4xx errors, except 429". The section's rule is MAY, so declining to
    // read a rate-limit as licence for more speculative fetches stays conformant.
    if (status >= 300 && status < 500 && status !== 429) {
      return RobotsTxtFile.from(url, UNAVAILABLE, proxyUrl);
    }
    return this.unreachable(url, `HTTP ${status}`, proxyUrl, log);
  }

  private unreachable(
    url: string,
    reason: string,
    proxyUrl: string | undefined,
    log: RobotsGateLog | undefined,
  ): RobotsTxtFile {
    // Crawlee logs its own robots.txt failures; this gate once swallowed them,
    // so a run whose enforcement had stopped working emitted nothing at all.
    log?.warning(
      `Could not load ${url} (${reason}); Markdown discovery will treat this origin as disallowed`,
    );
    return RobotsTxtFile.from(url, UNREACHABLE, proxyUrl);
  }
}
