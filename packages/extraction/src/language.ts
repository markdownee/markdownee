import { type DomDocument, elementsOf, parseDocument } from '@markdownee/conversion';

/**
 * Declared-language handling, reimplemented in TypeScript.
 *
 * `trafilaturacore` has no `language` metadata field and no target-language
 * knob, but Markdownee's public `languageCode` input and its dataset's
 * `metadata.languageCode` both predate the engine swap and must keep working.
 *
 * Trafilatura Core runs no statistical language detection either, so this module
 * compares **declared** `lang` markup only — no `franc`, no `tinyld`, no guessing
 * from the prose.
 */

/**
 * Normalize a language tag to its primary subtag, lowercased:
 * `en-GB` → `en`, `en_US` → `en`, `PT-br` → `pt`.
 */
export function normalizeLanguage(tag: string): string {
  return (tag.trim().split(/[-_]/)[0] ?? '').toLowerCase();
}

/** The `<meta>` names/properties that can declare a document language. */
const LANGUAGE_META_NAMES = new Set(['og:locale', 'language', 'dc.language', 'content-language']);

interface AttributeSource {
  getAttribute(name: string): string | null;
}

/** The first non-empty of `name`, `property`, `itemprop`, `http-equiv`, lowercased. */
function metaName(meta: AttributeSource): string {
  const raw =
    meta.getAttribute('name') ??
    meta.getAttribute('property') ??
    meta.getAttribute('itemprop') ??
    meta.getAttribute('http-equiv') ??
    '';
  return raw.toLowerCase();
}

function attribute(source: AttributeSource | null, name: string): string {
  return source?.getAttribute(name)?.trim() ?? '';
}

/**
 * The language a document *declares*, or `null`.
 *
 * Scans `<meta>` in document order, taking the first whose name is one of
 * `og:locale | language | dc.language | content-language`, then falls back to
 * `<html lang>`. That is the value `metadata.languageCode` has always carried.
 */
export function declaredLanguage(document: DomDocument): string | null {
  for (const meta of elementsOf(document.querySelectorAll('meta'))) {
    if (!LANGUAGE_META_NAMES.has(metaName(meta))) continue;
    const content = attribute(meta, 'content');
    if (content !== '') return normalizeLanguage(content);
  }
  const lang = attribute(document.documentElement, 'lang');
  return lang === '' ? null : normalizeLanguage(lang);
}

/**
 * The language the content *filter* compares against, or `null`.
 *
 * Deliberately a different precedence from {@link declaredLanguage}: `<html lang>`
 * first, then `<meta http-equiv="content-language">`, then `<meta name="language">`.
 */
function filterLanguage(document: DomDocument): string | null {
  const htmlLang = attribute(document.documentElement, 'lang');
  if (htmlLang !== '') return normalizeLanguage(htmlLang);

  for (const meta of elementsOf(document.querySelectorAll('meta[http-equiv]'))) {
    if (attribute(meta, 'http-equiv').toLowerCase() !== 'content-language') continue;
    const content = attribute(meta, 'content');
    if (content !== '') return normalizeLanguage(content);
  }
  for (const meta of elementsOf(document.querySelectorAll('meta[name]'))) {
    if (attribute(meta, 'name').toLowerCase() !== 'language') continue;
    const content = attribute(meta, 'content');
    if (content !== '') return normalizeLanguage(content);
  }
  return null;
}

/** What {@link applyLanguageFilter} decided about a page. */
export interface LanguageFilterResult {
  /** `true` when the document declares a language that contradicts the target. */
  rejected: boolean;
  /** The HTML to extract from: the input, minus any wrong-language subtrees. */
  html: string;
  /** The document's declared language, for `metadata.language`. */
  language: string | null;
}

/**
 * Read the declared language and apply the target-language filter to raw page HTML.
 *
 * Filtering happens before content-node selection:
 *
 * - No `targetLanguage` → nothing is filtered.
 * - The document declares a language that differs from the target → the whole
 *   page is rejected, because no candidate content node could ever have matched.
 * - The document declares nothing → graceful degradation; extraction proceeds.
 * - Elements carrying a `lang` attribute that differs from the target are
 *   dropped, so a mixed-language page keeps only its target-language parts.
 *
 * Element-level filtering must run **before** cleaning: the engine's cleaning
 * stage allows `lang` only on `<html>`, so by the time `clean()` returns, every
 * per-element language marker is gone.
 */
export function applyLanguageFilter(
  html: string,
  targetLanguage: string | null,
): LanguageFilterResult {
  const document = parseDocument(html);
  const language = declaredLanguage(document);

  const target = targetLanguage === null ? '' : normalizeLanguage(targetLanguage);
  if (target === '') return { rejected: false, html, language };

  const documentLanguage = filterLanguage(document);
  if (documentLanguage !== null && documentLanguage !== target) {
    return { rejected: true, html, language };
  }

  let removed = 0;
  for (const element of elementsOf(document.querySelectorAll('[lang]'))) {
    const lang = attribute(element, 'lang');
    if (lang === '' || normalizeLanguage(lang) === target) continue;
    element.remove();
    removed += 1;
  }
  if (removed === 0) return { rejected: false, html, language };

  // Re-serialize only when something was actually dropped, so the common path
  // hands `clean()` the original bytes.
  return { rejected: false, html: document.documentElement?.outerHTML ?? html, language };
}
