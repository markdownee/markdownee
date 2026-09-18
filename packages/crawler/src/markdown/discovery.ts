import { looksLikeMarkdown, stripFrontMatter } from '@markdownee/extraction';
import { MarkdownDiscovery, MarkdownMechanism } from '@markdownee/schema';

/**
 * Finding a Markdown representation an origin publishes for a page.
 *
 * Everything here is fetch-side and lives in this package by design: the
 * extraction engine never fetches (`@/directives/dev/security.md`). Every byte a
 * function here returns is untrusted third-party input and is validated at this
 * boundary before any consumer sees it.
 */

/**
 * The `Accept` this engine sends when it is asking for Markdown.
 *
 * Deliberately an ordered q-value list rather than a bare type, and the order is
 * the whole point: measured against the negotiating origins, an `Accept` biased
 * the other way — `text/markdown;q=0.9, text/html;q=1.0` — silently returns HTML
 * with no error and no signal. `text/x-markdown` earns its place because it is
 * honoured by every origin tested even though IANA never registered it, and it
 * flips the answer on at least one origin when sent alone; it rides below
 * `text/markdown` and is never emitted by this engine. `text/plain` is last
 * before the wildcard because exactly one origin family (Mintlify) serves
 * Markdown under it while others answer HTML — which is why the body is sniffed
 * rather than trusted.
 *
 * Lowercase, because got-scraping lowercases header names and a capitalised
 * duplicate would collide.
 */
export const MARKDOWN_ACCEPT =
  'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1';

/**
 * Bytes of a served body this engine will consider.
 *
 * Two independent measurements set this, and the tighter one won.
 *
 * **Render time.** `marked.parse` is synchronous, so a slow parse is not
 * preemptible — a handler timeout is a timer and cannot interrupt it, and a run
 * was measured holding the event loop for 77 s against its own 60 s budget
 * without being killed. The old 5 MB ceiling put roughly an hour of frozen
 * process within reach of one attacker-chosen page. A byte count is a blunt
 * instrument against a cost that tracks one construct rather than size, so the
 * quadratic that motivated this number is now bounded where it lives, at
 * {@link MAX_MARKDOWN_TASK_ITEMS}; this ceiling keeps every cost that does scale
 * with size.
 *
 * **Expansion.** The worst construct measured, `> -`, expands 9.60x on the way
 * to HTML, and the engine rejects HTML above `DEFAULT_MAX_INPUT_BYTES`
 * (10,485,760). 5 MB of it derived 48 MB and was refused; 256 KB derives at most
 * 2.52 MB and is always inside the ceiling.
 *
 * The cost of the bound is nil on real pages: across 617 Markdown bodies
 * captured from live origins the median is 6.5 KB, the 90th percentile 35 KB and
 * the largest 138 KB. A body over the cap is not an error — it is a page
 * extracted from HTML, exactly as the `off` default extracts it.
 *
 * **Where it is applied.** Twice, and the first application is the one that
 * bounds cost. A fetcher reading a response stream stops at this many bytes and
 * destroys the transfer, so an origin cannot make the crawler download a size it
 * chose; {@link acceptMarkdownResponse} then applies it again to the decoded
 * body, which is what a caller holding a response it did not stream — the page
 * fetch's own body — is judged by. Both count to the same ceiling, so a body at
 * the boundary is treated identically whichever way it arrived.
 */
export const MAX_MARKDOWN_BYTES = 256_000;

/**
 * GFM task-list items a served body may carry.
 *
 * `marked` 18.0.10 renders them in O(n²), and it is npm `latest`. Its list
 * tokenizer splits one loop into two passes so `list.loose` is finalized before
 * checkboxes are placed — upstream PR #4046, fixing a checkbox that escaped its
 * paragraph in issue #4045 — and the checkbox pass keeps a backward
 * `lexer.inlineQueue` scan that terminated at the last entry while it ran
 * interleaved and now traverses N-k of them. Every release through 18.0.9 is
 * linear, `master` still carries the rescan, and nothing upstream reports it, so
 * there is no fixed release to wait for and no version to pin to that does not
 * hand back the defect #4046 fixed.
 *
 * Measured on 18.0.10, `- [ ] a` repeated:
 *
 * | items | body | render |
 * | ----: | ----: | -----: |
 * | 4,000 | 32 KB | 100 ms |
 * | 8,000 | 64 KB | 382 ms |
 * | 16,000 | 128 KB | 1,468 ms |
 * | 32,000 | 256 KB | 5,772 ms |
 *
 * The same 200 KB as a plain `- a` list renders in 82 ms, so the cost is the
 * construct and not the size, and {@link MAX_MARKDOWN_BYTES} cannot reach it
 * without also refusing ordinary prose. 4,000 holds the worst case near 100 ms
 * and clears real traffic by a wide margin: the largest of the 617 bodies
 * captured from live origins is 138 KB, which would have to be nothing but
 * checkbox lines to reach 17,000 items.
 */
const MAX_MARKDOWN_TASK_ITEMS = 4_000;

/** Advertised alternates examined for one page, newest-first in document order. */
const MAX_ALTERNATE_CANDIDATES = 3;

/** Content types whose body may be Markdown. `text/plain` always needs the sniff. */
const MARKDOWN_CONTENT_TYPE = /^\s*text\/(?:markdown|x-markdown|plain)\s*(?:;|$)/i;

/** One page's Markdown bytes and where they came from. */
export interface ServedMarkdownSource {
  /** The served body, front matter removed. */
  markdown: string;
  /** Allowlisted scalars read out of that front matter. */
  frontMatter: { title?: string; description?: string; image?: string };
  mechanism: MarkdownMechanism;
  /** The URL the bytes were fetched from. */
  url: string;
}

/** One HTTP response, reduced to what the validation rules need. */
export interface MarkdownResponse {
  statusCode: number;
  contentType: string;
  body: string;
}

/** The HTTP channel a crawler path lends this module. Never touches a browser page. */
export type MarkdownFetcher = (url: string) => Promise<MarkdownResponse | undefined>;

/** Decode a body Crawlee may hand over as a `Buffer`. */
export function decodeBody(body: unknown): string | undefined {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return undefined;
}

/** Whether a `content-type` may carry Markdown. The body still has to prove it. */
export function isMarkdownContentType(contentType: string | undefined): boolean {
  return contentType !== undefined && MARKDOWN_CONTENT_TYPE.test(contentType);
}

/**
 * How many GFM task-list items a body carries, counted no further than `limit`.
 *
 * Its own cost has to stay linear or it becomes the next hazard, and the `^`
 * anchor under `m` is what keeps it so: a match is only ever attempted at a line
 * start, so the leading indent run is walked once per line instead of from every
 * offset. Measured at 1.2 ms over 32,000 items, and 1.0 ms over a single 256 KB
 * line of spaces. The indent is deliberately unbounded — capping it at a fixed
 * width was measured letting a task list indented past that width evade the
 * count entirely, which is the one failure this gate cannot afford. The pattern
 * is built per call rather than shared, so no `lastIndex` outlives a body.
 *
 * The raw body is counted, front matter and fenced code included. That
 * over-counts a document that merely *shows* checkbox lines, which is the safe
 * direction to be wrong in: refusing one costs that page its Markdown
 * representation, and the page itself is still extracted from its HTML.
 */
function taskListItemCount(body: string, limit: number): number {
  const pattern = /^[ \t]*(?:[*+-]|\d{1,9}[.)])[ \t]+\[[ xX]\][ \t]+\S/gm;
  let count = 0;
  while (pattern.exec(body) !== null) {
    if (++count > limit) return count;
  }
  return count;
}

/**
 * Accept a response as this page's Markdown, or reject it.
 *
 * Five independent gates, in this order, because each one is the only thing that
 * catches its own failure. Every one of them but the task-list bound fired
 * against a live origin; that one is a bound on a dependency's cost rather than
 * a response to an origin:
 *
 * - **Status.** A refusal body must never reach extraction. Origins answer `406`
 *   (DBpedia), `415` (the GitHub API) and plain `404` for a missing `.md`
 *   sibling — and one of those 404 bodies measured 1,004,391 bytes of
 *   `text/plain`.
 * - **Content type.** Never the request, never `Vary`: origins ignore `Accept`
 *   and answer `200 text/html` with no signal at all, and one advertises
 *   `Vary: Accept` while serving HTML regardless.
 * - **Size.** Untrusted input is bounded here as everywhere else.
 * - **Task-list density.** Size does not bound render time on its own, because
 *   `marked`'s task-list tokenizer is quadratic in the number of items rather
 *   than in bytes. See {@link MAX_MARKDOWN_TASK_ITEMS}.
 * - **Body, sniffed after the front matter is stripped.** The type is a claim,
 *   not a fact: one origin negotiates correctly and returns a YAML block
 *   followed by a literal `<!DOCTYPE html>` under `text/markdown`.
 */
export function acceptMarkdownResponse(
  response: MarkdownResponse | undefined,
): { markdown: string; frontMatter: ServedMarkdownSource['frontMatter'] } | undefined {
  if (response === undefined) return undefined;
  if (response.statusCode < 200 || response.statusCode >= 300) return undefined;
  if (!isMarkdownContentType(response.contentType)) return undefined;
  if (Buffer.byteLength(response.body, 'utf8') > MAX_MARKDOWN_BYTES) return undefined;
  if (taskListItemCount(response.body, MAX_MARKDOWN_TASK_ITEMS) > MAX_MARKDOWN_TASK_ITEMS) {
    return undefined;
  }
  const { body, frontMatter } = stripFrontMatter(response.body);
  if (!looksLikeMarkdown(body)) return undefined;
  return { markdown: body, frontMatter };
}

/** One HTML attribute value, quoted with `"` or `'` or bare. */
function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i'),
  );
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3];
}

/**
 * Resolve one advertised href against the page, and refuse it unless it is safe
 * to fetch.
 *
 * The href is authored by the page being crawled, so it is attacker-controlled.
 * `docs.deno.com` publishes `href="//runtime/index.md"` — protocol-relative,
 * which resolves to the host `runtime`, not to the site — so a client that
 * followed advertised alternates without this check would issue requests to
 * whatever host a page names, from inside a crawler that carries session cookies
 * and a proxy. Same-origin and `http(s)` are both required.
 */
function safeAlternateUrl(href: string, loadedUrl: string): string | undefined {
  let resolved: URL;
  let base: URL;
  try {
    base = new URL(loadedUrl);
    resolved = new URL(href, base);
  } catch {
    return undefined;
  }
  if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return undefined;
  if (resolved.origin !== base.origin) return undefined;
  // `URL.origin` does not carry userinfo, so an href of
  // `http://user:pass@same-host/x.md` passes the origin check while making the
  // page author choose what `Authorization` header this crawler sends — and the
  // credentials would then be written into the record's `markdownSource.url`.
  if (resolved.username !== '' || resolved.password !== '') return undefined;
  return resolved.toString();
}

/**
 * Same-origin Markdown alternates a page advertises, in the order it advertises
 * them.
 *
 * Both carriers are read. The HTML `<head>` is the common one; the `Link:`
 * response header is rarer but live (`www.prisma.io/docs` sends
 * `</docs.md>; rel="alternate"; type="text/markdown"`), and a detector that
 * reads only the head is structurally blind to it.
 *
 * Attribute values are parsed quote-tolerantly because `docs.apify.com` emits
 * the tag with no quotes at all. Nothing but `rel`, `type` and `href` is read:
 * `wordpress.org` carries an imperative addressed to a reading agent in a
 * `data-llm-hint` attribute of this very tag.
 */
export function advertisedMarkdownAlternates(
  html: string | undefined,
  linkHeader: string | undefined,
  loadedUrl: string,
): string[] {
  const found: string[] = [];
  const add = (href: string | undefined): void => {
    if (href === undefined) return;
    const safe = safeAlternateUrl(href, loadedUrl);
    if (safe !== undefined && !found.includes(safe)) found.push(safe);
  };

  for (const tag of html?.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attribute(tag, 'rel');
    const type = attribute(tag, 'type');
    if (rel === undefined || type === undefined) continue;
    if (!/(^|\s)alternate(\s|$)/i.test(rel)) continue;
    if (!/^text\/(?:x-)?markdown\b/i.test(type)) continue;
    add(attribute(tag, 'href'));
  }

  for (const part of (linkHeader ?? '').split(/,(?=\s*<)/)) {
    if (!/rel\s*=\s*"?[^";]*\balternate\b/i.test(part)) continue;
    if (!/type\s*=\s*"?text\/(?:x-)?markdown/i.test(part)) continue;
    add(part.match(/<([^>]+)>/)?.[1]);
  }

  return found.slice(0, MAX_ALTERNATE_CANDIDATES);
}

/**
 * The `.md` sibling of a page URL, or `undefined` when there is nothing to try.
 *
 * A directory URL takes `index.md` rather than an appended `.md`, which is what
 * `developers.cloudflare.com/fundamentals/` and `docs.deno.com/runtime/` both
 * serve. Query and fragment are dropped: no origin measured varies the Markdown
 * representation on them, and carrying them produces URLs that 404.
 */
export function siblingMarkdownUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  parsed.search = '';
  parsed.hash = '';
  const path = parsed.pathname;
  if (path.endsWith('.md')) return undefined;
  parsed.pathname = path.endsWith('/') ? `${path}index.md` : `${path}.md`;
  return parsed.toString();
}

/** Rung ordering, cheapest first, so a comparison reads as "at least this rung". */
const RUNG_ORDER: Record<MarkdownDiscovery, number> = {
  [MarkdownDiscovery.Off]: 0,
  [MarkdownDiscovery.Alternate]: 1,
  [MarkdownDiscovery.Negotiate]: 2,
  [MarkdownDiscovery.Probe]: 3,
};

/** Whether `rung` reaches at least as far as `required`. */
export function reaches(rung: MarkdownDiscovery, required: MarkdownDiscovery): boolean {
  return RUNG_ORDER[rung] >= RUNG_ORDER[required];
}

/**
 * Per-origin memory of speculative misses, so the expensive rung stops paying on
 * an origin that has repeatedly proved it publishes nothing.
 *
 * Measured, this is the difference between a bounded cost and a doubled crawl:
 * on the news corpus this repository is regression-tested against, `probe`
 * spends one extra request on every one of 24 pages and wins none of them. Three
 * consecutive misses is enough evidence for one run; it is deliberately not
 * persisted, so a later run re-checks.
 *
 * It governs EVERY speculative fetch, not just the sibling probe. Budgeting the
 * sibling alone left the two cheaper rungs unbounded, and both were measured
 * running away: 24 pages each advertising three dead alternates spent 72
 * fetches, and on a browser path the negotiate re-fetch doubled the request
 * count of every page of a site that publishes no Markdown at all, forever.
 */
export class OriginProbeBudget {
  private readonly misses = new Map<string, number>();

  /**
   * Origins remembered at once. A crawl that spans hosts writes one entry per
   * origin and a miss is never forgotten, so an unbounded map is retained state
   * an input controls: a million origins measured 159 MB of heap. The oldest
   * entry is dropped when the cap is reached, which costs that origin nothing
   * but a fresh budget.
   */
  private static readonly MAX_ORIGINS = 10_000;

  constructor(private readonly maxMisses = 3) {}

  private static origin(url: string): string | undefined {
    try {
      return new URL(url).origin;
    } catch {
      return undefined;
    }
  }

  /**
   * Claim one speculative fetch against this URL's origin, or refuse.
   *
   * The charge lands BEFORE the fetch is awaited, not after it misses. Counting
   * afterwards let every request already in flight read the same pre-miss total:
   * measured at `maxConcurrency: 10`, a budget of three admitted five probes.
   * {@link recordHit} refunds the origin's whole record, so an origin that does
   * publish Markdown is never charged for having been asked.
   */
  reserve(url: string): boolean {
    const origin = OriginProbeBudget.origin(url);
    if (origin === undefined) return false;
    const spent = this.misses.get(origin) ?? 0;
    if (spent >= this.maxMisses) return false;
    if (spent === 0 && this.misses.size >= OriginProbeBudget.MAX_ORIGINS) {
      const oldest = this.misses.keys().next();
      if (!oldest.done) this.misses.delete(oldest.value);
    }
    this.misses.set(origin, spent + 1);
    return true;
  }

  /** A hit clears the origin's record: it demonstrably does publish Markdown. */
  recordHit(url: string): void {
    const origin = OriginProbeBudget.origin(url);
    if (origin !== undefined) this.misses.delete(origin);
  }
}

/** Everything one page's Markdown resolution needs from its crawler path. */
export interface ResolveMarkdownOptions {
  rung: MarkdownDiscovery;
  /** The requested URL. */
  url: string;
  /** The URL actually loaded, which advertised hrefs resolve against. */
  loadedUrl: string;
  /** The page HTML, when this path already holds it. */
  html?: string;
  /** The page response's `Link:` header, when this path can read one. */
  linkHeader?: string;
  /** The page response itself, when it may already be the Markdown. */
  pageResponse?: MarkdownResponse;
  /**
   * Whether the page fetch already carried {@link MARKDOWN_ACCEPT}. When it did
   * and came back as something else, the origin has already answered and asking
   * again with the same header would only spend a request to be told twice.
   */
  alreadyNegotiated: boolean;
  /**
   * This path's HTTP channel. Absent on the adaptive HTTP-only branch, where the
   * only channels are a `page` that throws — escalating the request into a
   * browser render and destroying the saving the branch exists for — and a
   * `sendRequest` the restricted context does not expose.
   */
  fetch?: MarkdownFetcher;
  /**
   * Abandons this resolution when the crawler has already failed the request it
   * belongs to. Called between candidates rather than inside the `attempt` closure,
   * whose `catch` treats every fetch failure as one more non-fatal miss and
   * would swallow the cancellation along with them.
   */
  checkCancelled?: () => void;
  /**
   * Whether this crawl's robots policy permits fetching a URL. Absent when the
   * run does not respect robots.txt at all.
   *
   * Discovery cannot inherit Crawlee's own enforcement: that filters the request
   * QUEUE, and none of these fetches is ever queued. Without this gate a run
   * configured to respect robots.txt was measured fetching a `Disallow:`d
   * alternate and a `Disallow:`d `.md` sibling, on both the HTTP and the browser
   * channel, and emitting their bodies as page content.
   */
  allowedByRobots?: (url: string) => Promise<boolean>;
  budget: OriginProbeBudget;
  log: { debug: (message: string) => void; warning: (message: string) => void };
}

/**
 * Resolve one page's Markdown representation, cheapest mechanism first, or
 * `undefined` when the caller should extract from HTML as usual.
 *
 * The order is the cost ladder: a response already in hand, then a link the page
 * already advertised, then a second fetch of the same URL, then a speculative
 * sibling. Every failure is non-fatal — a page that yields nothing here is
 * simply extracted the ordinary way.
 */
export async function resolveServedMarkdown(
  opts: ResolveMarkdownOptions,
): Promise<ServedMarkdownSource | undefined> {
  if (opts.rung === MarkdownDiscovery.Off) return undefined;

  const accepted = acceptMarkdownResponse(opts.pageResponse);
  if (accepted !== undefined) {
    opts.budget.recordHit(opts.url);
    return { ...accepted, mechanism: MarkdownMechanism.Response, url: opts.url };
  }

  const attempt = async (
    candidate: string,
    mechanism: MarkdownMechanism,
  ): Promise<ServedMarkdownSource | undefined> => {
    if (opts.fetch === undefined) return undefined;
    if (opts.allowedByRobots !== undefined && !(await opts.allowedByRobots(candidate))) {
      opts.log.debug(`robots.txt disallows Markdown candidate ${candidate}; skipping it`);
      return undefined;
    }
    if (!opts.budget.reserve(candidate)) return undefined;
    let response: MarkdownResponse | undefined;
    try {
      response = await opts.fetch(candidate);
    } catch (error) {
      // Bounded and non-fatal, exactly as an image download failure is: a page
      // that cannot be discovered is a page extracted from HTML, not a failure.
      opts.log.debug(`Could not use Markdown candidate ${candidate}: ${String(error)}`);
      return undefined;
    }
    const body = acceptMarkdownResponse(response);
    if (body === undefined) return undefined;
    return { ...body, mechanism, url: candidate };
  };

  for (const href of advertisedMarkdownAlternates(opts.html, opts.linkHeader, opts.loadedUrl)) {
    opts.checkCancelled?.();
    const resolved = await attempt(href, MarkdownMechanism.Alternate);
    if (resolved !== undefined) {
      opts.budget.recordHit(opts.url);
      return resolved;
    }
  }

  if (reaches(opts.rung, MarkdownDiscovery.Negotiate) && !opts.alreadyNegotiated) {
    opts.checkCancelled?.();
    const resolved = await attempt(opts.url, MarkdownMechanism.Negotiated);
    if (resolved !== undefined) {
      opts.budget.recordHit(opts.url);
      return resolved;
    }
  }

  if (reaches(opts.rung, MarkdownDiscovery.Probe)) {
    const sibling = siblingMarkdownUrl(opts.url);
    if (sibling !== undefined) {
      opts.checkCancelled?.();
      const resolved = await attempt(sibling, MarkdownMechanism.Sibling);
      if (resolved !== undefined) {
        opts.budget.recordHit(opts.url);
        return resolved;
      }
    }
  }

  return undefined;
}
