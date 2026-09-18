/**
 * A sub-fetch is any request a handler makes beside the page fetch: an image
 * download, an advertised Markdown alternate, a re-fetch of a mistyped body.
 * None of them inherits what the caller configured, by either of two routes.
 * A fetcher riding `ctx.sendRequest` states headers of its own, and Crawlee
 * spreads that override LAST over `headers: originRequest.headers`
 * (`@crawlee/basic/internals/send-request.js:25-34`), so passing any header at
 * all replaces the caller's rather than adding to them. A fetcher calling the
 * HTTP client directly — the bounded Markdown transfer does, because only
 * `stream()` can bound it — never sees an origin request to inherit from at
 * all. These types carry the caller's transferable identity to both.
 */

/**
 * The caller's `userAgent`, `extraHTTPHeaders` and in-scope initial cookies, as
 * headers for one sub-fetch URL, with the page's own URL already bound.
 */
export type SubFetchHeaders = ((targetUrl: string) => Record<string, string>) & {
  /** The URL the crawl asked for — see {@link subFetchOriginContext}. */
  readonly pageUrl: string;
};

/**
 * The unbound form a crawler hands its handlers. `pageUrl` is the URL the crawl
 * asked for, which is what a cookie given without a domain is scoped against —
 * scoping it against the sub-fetch instead would re-point a bare credential at
 * whatever host the page happened to reference.
 */
export type SubFetchHeadersFor = (targetUrl: string, pageUrl: string) => Record<string, string>;

/**
 * The `got` `context` key under which a sub-fetch declares the URL the crawl asked
 * for. `createRescopingHttpClient`'s `beforeRedirect` hook reads it in preference to
 * the request's own URL.
 *
 * It rides `context` rather than a field of its own because got REJECTS an unknown
 * top-level option outright (`Unexpected option: <key>`,
 * `got@14.6.6/dist/source/core/options.js:475`), and a run with no initial cookies
 * sends its sub-fetches through a plain `GotScrapingHttpClient` that would never
 * strip a private field before got saw it. `context` is got's own slot for user data
 * and got-scraping only ADDS its custom options to it
 * (`got-scraping@4.2.1/dist/index.js:613-629`), so nothing here is overwritten and
 * nothing reaches the wire.
 */
export const CRAWL_ORIGIN_CONTEXT_KEY = 'markdowneeCrawlOrigin';

/** Bind {@link SubFetchHeadersFor} to the page one request is handling. */
export function bindSubFetchHeaders(
  build: SubFetchHeadersFor | undefined,
  pageUrl: string,
): SubFetchHeaders | undefined {
  if (build === undefined) return undefined;
  return Object.assign((targetUrl: string) => build(targetUrl, pageUrl), { pageUrl });
}

/**
 * The request fields a sub-fetch merges BESIDE its headers, pinning the cookie scope
 * of every redirect it follows to the page rather than to the sub-fetch's own host.
 *
 * The headers alone are not enough. They are correct for the first hop, but got
 * strips `cookie` only when the hostname or port changes, so a sub-fetch that
 * redirects within the host the page named is decided entirely by the redirect hook
 * — which, without this, normalizes a domain-less cookie onto that host and hands
 * the credential to its redirect target. Merge both wherever `subFetchHeaders` is
 * merged; there is no request that wants one and not the other.
 */
export function subFetchOriginContext(headers: SubFetchHeaders | undefined): {
  context?: Record<string, string>;
} {
  if (headers === undefined) return {};
  return { context: { [CRAWL_ORIGIN_CONTEXT_KEY]: headers.pageUrl } };
}
