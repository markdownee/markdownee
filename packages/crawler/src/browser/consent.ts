import type { CheerioAPI } from 'crawlee';
import type { Page } from 'playwright';

/**
 * Consent / CMP handling, isolated from the request handlers.
 *
 * Two distinct concerns live here:
 * - **Stripping** residual consent/CMP containers from captured HTML before
 *   extraction ({@link CONSENT_SELECTORS}, {@link stripConsentFromCheerio},
 *   {@link stripConsentFromPage}) — for inline banners overlaid on a served
 *   article.
 * - **Accepting a content-replacing wall** that was served *instead of* the
 *   article ({@link acceptConsentWall} and the {@link recoverConsentWallOnPage} /
 *   {@link recoverConsentWallAdaptive} orchestrators the handlers call) — e.g.
 *   idnes.cz's server-side 302 to its Didomi consent-or-pay page.
 *
 * Security: scraped content is untrusted. Every page-context function below is a
 * static closure operating on a fixed, in-code selector/API list — page input is
 * never built into a selector and never `eval`d.
 */

/**
 * Consent / CMP container selectors removed from the DOM before extraction.
 *
 * Ghostery's network/cosmetic blocking hides live banners but never removes the
 * server-rendered consent text from the HTML the extractor parses, so on
 * consent-or-pay pages (e.g. idnes.cz) the engine selects the disclaimer as
 * "main content". Stripping these known-CMP containers before extraction stops
 * that leak. The list is intentionally conservative — only vendor-namespaced or
 * two-token (`cookie-consent`) selectors, never a bare `[id*="consent"]` (which
 * would match editorial markup like `id="consent-article"`).
 */
export const CONSENT_SELECTORS: readonly string[] = [
  // Didomi
  '#didomi-host',
  '.didomi-popup',
  '.didomi-notice',
  // OneTrust
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  '.onetrust-pc-dark-filter',
  // Sourcepoint
  '[id^="sp_message_container"]',
  '.sp_veil',
  '.message-overlay',
  // Cookiebot
  '#CybotCookiebotDialog',
  // Quantcast
  '.qc-cmp2-container',
  '.qc-cmp-cleanslate',
  // Generic (two-token only — never a bare `[id*="consent"]`)
  '.fc-consent-root',
  '#cmpwrapper',
  '#cmpbox',
  '[id*="cookie-consent" i]',
  '[id*="cookieconsent" i]',
  '[class*="cookie-consent" i]',
  // Ad-block-detection nag (idnes.cz `#adblock` and the like). It is the
  // "you are using an ad blocker" wall, never article content — and on a normal
  // page it is hidden, so removing it before extraction is safe.
  '#adblock',
  // idnes.cz / MAFRA server-rendered consent-OR-pay interstitial. Anchored on
  // the `#payorok` gate so the sibling option boxes and the "iDNES a reklama"
  // disclaimer (`div.text`) are matched together (one query, before any removal)
  // and never match a normal idnes article, which has no `#payorok`.
  '#payorok, #payorok ~ #noconsent, #payorok ~ .boxes, #payorok ~ .text',
];

/** Remove known consent/CMP containers from a parsed cheerio document in place. */
export function stripConsentFromCheerio($: CheerioAPI): void {
  for (const selector of CONSENT_SELECTORS) {
    try {
      $(selector).remove();
    } catch {
      // Ignore a selector the cheerio engine rejects; never abort the strip
      // (mirrors stripConsentFromPage's per-selector isolation).
    }
  }
}

/** Remove known consent/CMP containers from a live browser page's DOM in place. */
export async function stripConsentFromPage(page: Page): Promise<void> {
  await page.evaluate((selectors: readonly string[]) => {
    for (const selector of selectors) {
      try {
        for (const node of document.querySelectorAll(selector)) {
          node.remove();
        }
      } catch {
        // Ignore a selector the browser engine rejects; never abort the strip.
      }
    }
  }, CONSENT_SELECTORS);
}

/**
 * Top-level CMP wall containers used to detect — in static (cheerio) HTML —
 * whether a request landed on a consent wall rather than the article. Unlike
 * {@link CONSENT_SELECTORS} (which lists every container to strip), this is the
 * narrower "the page is a consent wall, not content" signal: matching it in the
 * adaptive HTTP path is what escalates the request to a real browser so the CMP
 * can be accepted (see {@link acceptConsentWall}).
 */
export const CONSENT_WALL_SELECTORS: readonly string[] = [
  '#payorok', // idnes.cz / MAFRA server-redirect consent-or-pay wall
  '#didomi-host', // Didomi
  '#onetrust-banner-sdk', // OneTrust
  '#CybotCookiebotDialog', // Cookiebot
  '[id^="sp_message_container"]', // Sourcepoint
  '.qc-cmp2-container', // Quantcast
];

const MAX_RETURN_URL_DEPTH = 3;
const MAX_RETURN_URL_CANDIDATES = 32;
const MIN_ARTICLE_TEXT_LENGTH = 200;

/**
 * Path segments a site uses for its own consent gate.
 *
 * A wall does not have to be a recognised CMP container. derstandard.at answers a
 * request for an article with a same-origin redirect to `/consent/tcf/...`, a
 * first-party page carrying none of {@link CONSENT_WALL_SELECTORS}; without this
 * signal that page is extracted and emitted as though it were the article, which
 * is the one outcome consent handling exists to prevent.
 *
 * Matched as a whole path segment, so `/consenting-adults` and an article at
 * `/news/cookies-and-privacy` do not qualify.
 */
const CONSENT_PATH_SEGMENT_RE = /(?:^|\/)(?:consent|cookiewall|cookie-wall|gdpr-consent)(?:\/|$)/i;

/**
 * True when the browser was redirected away from the requested article to a
 * same-origin page whose own path says it is a consent gate.
 *
 * Deliberately narrow. It requires all three of: a different path from the one
 * requested, the same origin (a cross-origin CMP host is already covered by the
 * return-target and container checks), and a consent path segment. A site that
 * genuinely serves an article under such a path keeps it, because the caller only
 * treats this as a wall when the article markup is absent as well.
 */
export function isConsentGatePath(articleUrl: string, currentLoadedUrl: string): boolean {
  try {
    const requested = new URL(articleUrl);
    const loaded = new URL(currentLoadedUrl);
    if (loaded.origin !== requested.origin) return false;
    if (loaded.pathname === requested.pathname) return false;
    return CONSENT_PATH_SEGMENT_RE.test(loaded.pathname);
  } catch {
    return false;
  }
}

/**
 * Detect a redirect page whose query contains the requested page as a return target.
 *
 * Parameter names are deliberately irrelevant: consent and login systems use
 * many variants (`return_url`, `continue`, nested login URLs, and others). Only
 * absolute HTTP(S) values whose origin and path match the crawler's trusted
 * requested URL count. Traversal is bounded so untrusted query strings cannot
 * create unbounded work.
 */
export function hasMatchingReturnTarget(articleUrl: string, currentLoadedUrl: string): boolean {
  try {
    const requestedUrl = new URL(articleUrl);
    const loadedUrl = new URL(currentLoadedUrl);
    if (!['http:', 'https:'].includes(requestedUrl.protocol)) return false;
    if (loadedUrl.origin === requestedUrl.origin && loadedUrl.pathname === requestedUrl.pathname) {
      return false;
    }

    const candidates = [...loadedUrl.searchParams.values()].map((value) => ({ depth: 1, value }));
    let inspected = 0;
    while (candidates.length > 0 && inspected < MAX_RETURN_URL_CANDIDATES) {
      const candidate = candidates.shift();
      if (candidate === undefined) break;
      inspected += 1;

      let candidateUrl: URL;
      try {
        candidateUrl = new URL(candidate.value);
      } catch {
        continue;
      }
      if (!['http:', 'https:'].includes(candidateUrl.protocol)) continue;
      if (
        candidateUrl.origin === requestedUrl.origin &&
        candidateUrl.pathname === requestedUrl.pathname
      ) {
        return true;
      }
      if (candidate.depth < MAX_RETURN_URL_DEPTH) {
        for (const value of candidateUrl.searchParams.values()) {
          candidates.push({ depth: candidate.depth + 1, value });
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Require semantic article evidence before accepting an HTTP consent recovery. */
export function hasSubstantialArticle($: CheerioAPI): boolean {
  const hasLongText = (selector: string): boolean =>
    $(selector)
      .toArray()
      .some(
        (element) =>
          $(element).text().replace(/\s+/g, ' ').trim().length >= MIN_ARTICLE_TEXT_LENGTH,
      );

  if (hasLongText('article, [itemprop="articleBody"]')) return true;

  const declaresArticle = $('meta[property="og:type"], meta[name="og:type"]')
    .toArray()
    .some((element) => $(element).attr('content')?.trim().toLowerCase() === 'article');
  return declaresArticle && hasLongText('main, [role="main"]');
}

// Markup that indicates the article itself was served (so a CMP container is an
// overlay banner, not a content-replacing wall).
const ARTICLE_MARKERS = 'article, [itemprop="articleBody"], main';

/**
 * True when a parsed document is a CMP consent wall that *replaced* the article
 * (so it must be accepted and the article re-fetched), as opposed to a banner
 * overlaid on a present article (which {@link stripConsentFromCheerio} alone
 * handles). Used by the adaptive handler to decide whether to escalate an
 * HTTP-only request to a browser render.
 */
export function hasConsentWall($: CheerioAPI): boolean {
  const wallPresent = CONSENT_WALL_SELECTORS.some((selector) => {
    try {
      return $(selector).length > 0;
    } catch {
      return false;
    }
  });
  if (!wallPresent) return false;
  // The idnes/MAFRA consent-or-pay gate is always a content-replacing wall.
  try {
    if ($('#payorok').length > 0) return true;
    // Otherwise it only replaced the article if no article markup is present.
    return $(ARTICLE_MARKERS).length === 0;
  } catch {
    return false;
  }
}

/** Window globals the major CMPs expose for programmatic "accept all". */
interface CmpWindow {
  Didomi?: { setUserAgreeToAll?: () => void; notice?: { isVisible?: () => boolean } };
  OneTrust?: { AllowAll?: () => void };
}

// Single CSS query that matches any top-level CMP wall container (browser path).
const CMP_WALL_QUERY = CONSENT_WALL_SELECTORS.join(', ');

// Visible "accept all" affordances for CMPs without a stable JS accept-all API
// (Cookiebot, Quantcast, OneTrust button fallback). Fixed in-code list — never
// built from page input. Buttons are clicked only when actually shown.
const CMP_ACCEPT_BUTTONS: readonly string[] = [
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '.qc-cmp2-summary-buttons button[mode="primary"]',
];

// Known consent cookies any of the supported CMPs writes once consent is given.
const CONSENT_COOKIE_RE = /(?:didomi_token|euconsent-v2|OptanonConsent|CookieConsent)=/i;

/**
 * Outcome of {@link acceptConsentWall}:
 * - `none` — no content-replacing consent wall was present (normal page or an
 *   inline banner over a served article; nothing to recover).
 * - `recovered` — a wall was present, accepted via its own CMP, and the article
 *   was re-fetched and verified wall-free.
 * - `blocked` — a wall was present but could not be cleared; the caller must NOT
 *   record the page (the strip would mask the wall as scraps), and should fail
 *   the request so it retries / surfaces as a failure rather than garbage.
 */
export type ConsentWallOutcome = 'none' | 'recovered' | 'blocked';

/**
 * True when the live page is a consent wall that *replaced* the article — either
 * the idnes/MAFRA `#payorok` gate, or the server redirected us away from the
 * requested article URL to a page showing a CMP prompt. An inline banner on the
 * article URL itself is NOT a content wall (same document → `false`), so this
 * never fires on a served article and is safe to call on every page.
 */
async function isOnContentWall(page: Page, articleUrl: string): Promise<boolean> {
  if (hasMatchingReturnTarget(articleUrl, page.url())) return true;
  // A first-party gate carrying no recognised CMP container. Confirmed against the
  // page rather than trusted on the URL alone, so a site that serves real content
  // under such a path is not failed for it. The test is substantial article *text*,
  // mirroring `hasSubstantialArticle`, because a gate commonly wraps itself in
  // `<main>` and the presence of article markup alone proves nothing.
  if (isConsentGatePath(articleUrl, page.url())) {
    const servesArticle = await page.evaluate(
      ({ minLength }) => {
        const longText = (selector: string): boolean =>
          Array.from(document.querySelectorAll(selector)).some(
            (element) =>
              (element.textContent ?? '').replace(/\s+/g, ' ').trim().length >= minLength,
          );
        if (longText('article, [itemprop="articleBody"]')) return true;
        const declaresArticle = Array.from(
          document.querySelectorAll('meta[property="og:type"], meta[name="og:type"]'),
        ).some((element) => element.getAttribute('content')?.trim().toLowerCase() === 'article');
        return declaresArticle && longText('main, [role="main"]');
      },
      { minLength: MIN_ARTICLE_TEXT_LENGTH },
    );
    if (!servesArticle) return true;
  }

  return page.evaluate(
    ({ wallQuery, target }) => {
      const isShown = (el: Element | null): boolean => {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.offsetParent !== null || style.position === 'fixed';
      };
      // idnes/MAFRA consent-or-pay gate is definitive regardless of URL.
      if (document.querySelector('#payorok') !== null) return true;
      // Same document as the requested article → an inline banner, not a wall.
      const norm = (u: string): string => {
        try {
          const url = new URL(u);
          return `${url.host}${url.pathname}`.replace(/\/+$/, '').toLowerCase();
        } catch {
          return u;
        }
      };
      if (norm(location.href) === norm(target)) return false;
      // Redirected elsewhere: a wall only if a CMP prompt is actually shown here.
      const w = window as unknown as CmpWindow;
      const didomiVisible = w.Didomi?.notice?.isVisible?.() === true;
      const containerShown = Array.from(document.querySelectorAll(wallQuery)).some(isShown);
      return didomiVisible || containerShown;
    },
    { wallQuery: CMP_WALL_QUERY, target: articleUrl },
  );
}

/**
 * Accept a content-replacing consent wall using the wall's own "accept all"
 * mechanism, then re-fetch the article and verify the wall is gone.
 *
 * General across CMPs — not idnes-specific: it prefers each vendor's
 * programmatic accept-all (Didomi `setUserAgreeToAll`, OneTrust `AllowAll`) and
 * falls back to clicking a visible "accept all" button (Cookiebot, Quantcast,
 * OneTrust). Only one mechanism fires. It is a no-op (`none`, no navigation)
 * when the page is not a content wall, so it is safe to call on every page.
 *
 * Recovery is *verified*: after re-navigation the wall is re-checked, so a failed
 * bypass returns `blocked` (the caller must fail, not record scraps) — never a
 * false success.
 */
export async function acceptConsentWall(
  page: Page,
  articleUrl: string,
): Promise<ConsentWallOutcome> {
  if (!(await isOnContentWall(page, articleUrl))) return 'none';

  // A server-rendered wall (idnes) loads its CMP script after the gate markup;
  // wait briefly for an accept mechanism to become available before acting.
  await page
    .waitForFunction(
      (buttons) => {
        const w = window as unknown as CmpWindow;
        return (
          typeof w.Didomi?.setUserAgreeToAll === 'function' ||
          typeof w.OneTrust?.AllowAll === 'function' ||
          buttons.some((selector) => document.querySelector(selector) !== null)
        );
      },
      CMP_ACCEPT_BUTTONS,
      { timeout: 4000 },
    )
    .catch(() => {
      // Timed out — try the accept pass anyway; it is a no-op if nothing is ready.
    });

  const accepted = await page.evaluate((buttons) => {
    const w = window as unknown as CmpWindow;
    const isShown = (el: Element | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return el.offsetParent !== null || style.position === 'fixed';
    };
    // Invoke exactly one accept mechanism (a second would race the CMP's reload).
    try {
      if (typeof w.Didomi?.setUserAgreeToAll === 'function') {
        w.Didomi.setUserAgreeToAll();
        return true;
      }
    } catch {
      // CMP threw — fall through to the next mechanism.
    }
    try {
      if (typeof w.OneTrust?.AllowAll === 'function') {
        w.OneTrust.AllowAll();
        return true;
      }
    } catch {
      // CMP threw — fall through to the button fallback.
    }
    for (const selector of buttons) {
      const btn = document.querySelector(selector);
      if (btn instanceof HTMLElement && isShown(btn)) {
        btn.click();
        return true;
      }
    }
    return false;
  }, CMP_ACCEPT_BUTTONS);

  if (accepted) {
    // Let the CMP persist its consent cookie, then re-fetch the article so the
    // now-consented server serves real content instead of the wall redirect.
    await page
      .waitForFunction(
        (re) => new RegExp(re, 'i').test(document.cookie),
        CONSENT_COOKIE_RE.source,
        {
          timeout: 5000,
        },
      )
      .catch(() => {
        // Cookie not observed in time — re-navigate anyway; the re-check decides.
      });
    await page.goto(articleUrl, { waitUntil: 'domcontentloaded' }).catch(() => {
      // Re-navigation failed — the re-check below will report `blocked`.
    });
  }

  // Verify recovery: only a wall-free article counts as success.
  return (await isOnContentWall(page, articleUrl)) ? 'blocked' : 'recovered';
}

/** Minimal logger surface the orchestrators need (Crawlee's `Log` satisfies it). */
interface ConsentLog {
  info(message: string): void;
  warning(message: string): void;
}

/** Adaptive crawling context shape the orchestrator needs (the lazy `page` getter
 * throws in HTTP-only runs, escalating to a browser render). */
interface AdaptiveConsentContext {
  readonly page: Page;
  parseWithCheerio(): Promise<CheerioAPI>;
}

function failBlockedWall(articleUrl: string, log: ConsentLog): never {
  log.warning(`Consent wall could not be bypassed for ${articleUrl}; failing request`);
  throw new Error(`CONSENT_WALL_NOT_BYPASSED: ${articleUrl}`);
}

/**
 * Browser-path orchestration: accept a content-replacing wall on the live page
 * and return the `loadedUrl` to record (the re-navigated article URL when
 * recovered, otherwise unchanged). Throws on a wall that cannot be cleared.
 */
export async function recoverConsentWallOnPage(
  page: Page,
  articleUrl: string,
  currentLoadedUrl: string,
  log: ConsentLog,
): Promise<string> {
  const outcome = await acceptConsentWall(page, articleUrl);
  if (outcome === 'blocked') failBlockedWall(articleUrl, log);
  if (outcome === 'recovered') {
    log.info(`Accepted consent wall for ${articleUrl}`);
    return page.url();
  }
  return currentLoadedUrl;
}

/**
 * Adaptive-path orchestration: when the parsed HTML is a content-replacing wall,
 * escalate to a browser render (reading `context.page` throws in HTTP-only mode,
 * which Crawlee turns into a browser re-run) and accept it. Returns the possibly
 * re-parsed document and the `loadedUrl` to record. Throws on a wall that cannot
 * be cleared. A no-op (returns the inputs) when there is no wall.
 */
export async function recoverConsentWallAdaptive(
  context: AdaptiveConsentContext,
  $: CheerioAPI,
  articleUrl: string,
  currentLoadedUrl: string,
  log: ConsentLog,
): Promise<{ $: CheerioAPI; loadedUrl: string }> {
  // A consent gate commonly wraps itself in `<main>`, so the presence of article
  // markup proves nothing here; only substantial article *text* does.
  const gatePath = isConsentGatePath(articleUrl, currentLoadedUrl) && !hasSubstantialArticle($);
  if (!gatePath && !hasMatchingReturnTarget(articleUrl, currentLoadedUrl) && !hasConsentWall($)) {
    return { $, loadedUrl: currentLoadedUrl };
  }
  // Reading context.page in an HTTP-only run throws → Crawlee re-runs in a browser.
  const outcome = await acceptConsentWall(context.page, articleUrl);
  if (outcome === 'blocked') failBlockedWall(articleUrl, log);
  if (outcome === 'recovered') {
    log.info(`Accepted consent wall for ${articleUrl}`);
    return { $: await context.parseWithCheerio(), loadedUrl: context.page.url() };
  }
  // `none` → the cheerio signal was a false positive (e.g. an inline banner over
  // a div-based article); keep the now browser-rendered document and strip it.
  return { $, loadedUrl: currentLoadedUrl };
}
