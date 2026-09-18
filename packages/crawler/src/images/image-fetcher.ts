import type { BaseHttpClient, CheerioCrawlingContext } from 'crawlee';
import { GotScrapingHttpClient } from 'crawlee';
import type { Page } from 'playwright';
import { type SubFetchHeaders, subFetchOriginContext } from '../sub-fetch-headers.js';

/** Downloaded image bytes plus the response's content type (when reported). */
export interface FetchedImage {
  body: Buffer;
  contentType?: string;
}

/**
 * Downloads one image URL for the save image-handling mode. Resolves `null` on
 * any failure (network error, HTTP >= 400, timeout) — per-image failures are
 * non-fatal; the pipeline leaves that `<img>`'s resolved URL in place.
 */
export type ImageFetcher = (url: string) => Promise<FetchedImage | null>;

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch through the live Playwright page's request context — same session,
 * cookies, and proxy as the page itself, with the page URL as referer (so
 * referer-gated CDNs serve the bytes they served the page).
 */
export function playwrightImageFetcher(page: Page, refererUrl: string): ImageFetcher {
  return async (url) => {
    try {
      const response = await page.request.get(url, {
        headers: { referer: refererUrl },
        timeout: FETCH_TIMEOUT_MS,
      });
      if (!response.ok()) return null;
      const body = await response.body();
      return { body, contentType: response.headers()['content-type'] };
    } catch {
      return null;
    }
  };
}

/**
 * Fetch through Crawlee's `sendRequest` (got-scraping) — the cheerio crawler's
 * own HTTP client, sharing its session and proxy.
 *
 * The caller's transferable headers are merged BENEATH this fetcher's own, and
 * merged rather than inherited: `sendRequest` spreads an override last over
 * `headers: originRequest.headers`, so passing `referer` alone replaced the
 * caller's `user-agent`, `extraHTTPHeaders` and cookie with got-scraping's
 * fabricated Chrome set — measured, on a same-host image behind a page fetch that
 * carried all three. `referer` stays authoritative for the sub-fetch.
 */
export function sendRequestImageFetcher(
  sendRequest: CheerioCrawlingContext['sendRequest'],
  refererUrl: string,
  subFetchHeaders?: SubFetchHeaders,
): ImageFetcher {
  return async (url) => {
    try {
      const response = await sendRequest<Buffer>({
        url,
        responseType: 'buffer',
        headers: { ...subFetchHeaders?.(url), referer: refererUrl },
        // Pins the cookie scope of any redirect this image follows to the page, not
        // to the host the page named it on.
        ...subFetchOriginContext(subFetchHeaders),
      });
      if (response.statusCode >= 400) return null;
      const body = response.body;
      if (!Buffer.isBuffer(body)) return null;
      return { body, contentType: responseContentType(response) };
    } catch {
      return null;
    }
  };
}

/**
 * Content type of a `sendRequest` response. Crawlee 3.17 resolves to a raw
 * `IncomingMessage`-like object whose `headers` map is NOT populated (only
 * `rawHeaders` is), despite the got `Response` typing — read both, defensively.
 */
function responseContentType(response: {
  headers?: Record<string, unknown>;
  rawHeaders?: unknown;
}): string | undefined {
  const direct = response.headers?.['content-type'];
  if (typeof direct === 'string') return direct;
  const raw = response.rawHeaders;
  if (Array.isArray(raw)) {
    for (let i = 0; i + 1 < raw.length; i += 2) {
      if (String(raw[i]).toLowerCase() === 'content-type') return String(raw[i + 1]);
    }
  }
  return undefined;
}

/**
 * Fallback for the adaptive crawler's HTTP-only mode, whose restricted handler
 * context exposes no `sendRequest` and no usable `page`. It has no crawler HTTP
 * channel to ride, but it does not need one to be proxied: that context does
 * carry the proxy the run resolved for the request, and `GotScrapingHttpClient`
 * — the client Crawlee itself uses, already a dependency of this package —
 * takes that URL per call. Sends the page URL as referer.
 *
 * Passing `proxyUrl` is what keeps these bytes inside a configured proxy; with
 * none configured the caller passes `undefined` and the request goes direct, as
 * it always did. The resolved value must come from the context rather than from
 * `ProxyConfiguration.newUrl()`, which mutates: allocating here would advance
 * the round-robin cursor and perturb proxy assignment for the rest of the run.
 *
 * These requests now carry got-scraping's generated browser-like headers, which
 * plain `fetch` did not send. That is the same shape the cheerio branch's image
 * bytes have always had, since they go through `sendRequest`.
 *
 * This branch has no origin request to inherit from at all, so the caller's
 * transferable headers have to be handed in the same way the cheerio branch merges
 * them; without them a run's `userAgent`, `extraHTTPHeaders` and cookies stop at the
 * page fetch that named the image.
 *
 * `httpClient` is the crawl's own client, and riding it rather than allocating one is
 * what makes the scope pin below live: with initial cookies that client is
 * `createRescopingHttpClient`, whose `beforeRedirect` hook re-derives the `Cookie`
 * header on every hop. Allocating a plain client here installed no hook, so these
 * sub-fetches followed redirects with got's own stripping as their only guard — and
 * got compares hostname and port only, so a same-host hop out of the cookie's path,
 * or an `https -> http` downgrade with both endpoints on their scheme's default port,
 * carried the credential forward.
 */
function proxyAwareImageFetcher(
  refererUrl: string,
  proxyUrl?: string,
  subFetchHeaders?: SubFetchHeaders,
  httpClient?: BaseHttpClient,
): ImageFetcher {
  // The hook and the pin it reads are inseparable, and this is the seam where they
  // could come apart: the hook ASSIGNS the header it derives rather than merely
  // filtering the previous hop's, so a rescoping client given no origin to normalize
  // against would synthesize a domain-less cookie onto the image's own host and hand
  // it to whatever that host redirects to — a credential on a hop that today carries
  // none. Without `subFetchHeaders` there is no pin to set, so ride a plain client.
  const client =
    subFetchHeaders === undefined
      ? new GotScrapingHttpClient()
      : (httpClient ?? new GotScrapingHttpClient());
  return async (url) => {
    try {
      const response = await client.sendRequest<'buffer'>({
        url,
        responseType: 'buffer',
        headers: { ...subFetchHeaders?.(url), referer: refererUrl },
        // Same scope pin as the `sendRequest` fetcher, and live here now that this
        // fetcher rides the crawl's own client: the redirect hook reads it in
        // preference to the hop's own URL, so every hop is scoped against the page.
        ...subFetchOriginContext(subFetchHeaders),
        // A failure is reported as a status here and judged below, matching
        // `sendRequestImageFetcher`; per-image failures stay non-fatal either way.
        throwHttpErrors: false,
        timeout: { request: FETCH_TIMEOUT_MS },
        ...(proxyUrl === undefined ? {} : { proxyUrl }),
      });
      if (response.statusCode >= 400) return null;
      const body = response.body;
      if (!Buffer.isBuffer(body)) return null;
      return { body, contentType: responseContentType(response) };
    } catch {
      return null;
    }
  };
}

/**
 * Adaptive crawler fetcher — follows whichever handler ran. In a browser run
 * `context.page` is a live Page (fetch through it, inheriting its proxy); in an
 * HTTP-only run the `page` getter throws (caught here, deliberately NOT
 * propagated — propagation would escalate the whole request to a browser
 * re-run), so the fallback runs instead, carrying `context.proxyInfo`.
 *
 * The fetcher is built once per page rather than per image: the byte pipeline
 * calls the returned closure from concurrency-bounded workers, and the fallback
 * resolves a client once.
 */
export function adaptiveImageFetcher(
  context: { page: Page; proxyInfo?: { url: string } },
  refererUrl: string,
  subFetchHeaders?: SubFetchHeaders,
  httpClient?: BaseHttpClient,
): ImageFetcher {
  let page: Page | undefined;
  try {
    page = context.page;
  } catch {
    page = undefined;
  }
  return page
    ? playwrightImageFetcher(page, refererUrl)
    : proxyAwareImageFetcher(refererUrl, context.proxyInfo?.url, subFetchHeaders, httpClient);
}
