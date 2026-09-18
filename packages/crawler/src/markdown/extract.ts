import {
  addFrontMatter,
  CONVERSION_FORMAT_RESULT_KEYS,
  type ContentExtractor,
  containsUnsafeMarkup,
  markdownToHtml,
  type OutputFormat,
  type OutputLayout,
  type PageExtraction,
  type PageOutputContext,
} from '@markdownee/extraction';
import type { ServedMarkdownSource } from './discovery.js';

/**
 * Rendering a page from Markdown an origin served, instead of from its HTML.
 *
 * The shape is deliberately the same one the HTML path already uses, so a
 * Markdown-sourced page pays for exactly one engine cleaning pass like every
 * other page (`@/solutions/markdownee/engine/packages/crawler/SPEC.md`):
 *
 * - `markdown` is the served bytes **verbatim**, front matter stripped. It is
 *   never round-tripped. Measured on three origins, Markdown → HTML → Turndown
 *   never reproduced its input: bare URLs were expanded into explicit links,
 *   trailing-double-space hard breaks were normalised away, an empty image node
 *   was dropped, and length drifted by up to 15.7%.
 * - `html` is one Markdown-to-HTML parse of those bytes, pushed through
 *   Trafilatura Core's unconditional sanitize-html security floor by
 *   `cleanPage`. That parse output is UNSANITIZED — CommonMark passes raw HTML
 *   through and marked does not sanitize — so the floor is not optional, and
 *   `formatSecuredHtml` is not a substitute for it: its input contract is
 *   already-secured HTML and it would minify an attacker's script rather than
 *   remove it. Sanitization runs after the transform, never before, per OWASP.
 * - `txt` falls out of that same cleaned HTML through the ordinary renderer.
 */

/**
 * Fields an origin's front matter contributes to the page metadata.
 *
 * A Markdown-derived document has no `<head>`, so without this a Markdown-sourced
 * page would carry almost no metadata and the `standard`/`enhanced` layouts would
 * emit a near-empty front-matter block. The three keys are the ones every origin
 * measured actually emits.
 *
 * Front matter WINS over whatever the metadata pass derived from the derived
 * document, because it plays exactly the role `<title>` and `og:title` play on
 * the HTML path — the origin's own declaration for this page — whereas the
 * derived value is a fallback read out of the body's first heading. Without this
 * precedence a page whose front matter says "Cloudflare Fundamentals" is titled
 * after its first `<h1>` instead.
 *
 * These are attacker-supplied strings and carry exactly the trust that `<title>`
 * already does: bounded at the parse boundary, allowlisted to three keys, and
 * URL-validated downstream by `normalizeOutputUrl`.
 */
function adoptFrontMatter(
  metadata: { title: string | null; description: string | null; image: string | null },
  frontMatter: ServedMarkdownSource['frontMatter'],
): void {
  if (frontMatter.title !== undefined) metadata.title = frontMatter.title;
  if (frontMatter.description !== undefined) metadata.description = frontMatter.description;
  if (frontMatter.image !== undefined) metadata.image = frontMatter.image;
}

/** What one served-Markdown page produced. */
export interface ServedMarkdownExtraction {
  extracted: PageExtraction;
  /**
   * An HTML representation of the page, for the `original` route and the raw
   * hash. It is derived from the served Markdown rather than fetched, which is
   * exactly what the record's `markdownSource` field discloses.
   */
  html: string;
  /**
   * Whether `markdown` below is the served bytes or the round trip. Read from
   * the branch actually taken, because no other field on the record implies it:
   * `mechanism` says how the bytes were reached, not what was done with them.
   */
  verbatim: boolean;
}

/**
 * Render every requested format from a served Markdown body.
 *
 * `extractor` must be configured with `boilerplate: 'keep'`: the origin already
 * decided what the content of this page is, so running main-content extraction
 * over a document that is entirely content would discard part of it. Every other
 * content-handling choice the caller made still applies.
 */
export async function extractServedMarkdown(
  extractor: ContentExtractor,
  source: ServedMarkdownSource,
  url: string,
  formats: readonly OutputFormat[],
  context: PageOutputContext,
  layout: OutputLayout,
): Promise<ServedMarkdownExtraction> {
  const derivedHtml = markdownToHtml(source.markdown);
  const page = await extractor.cleanPage(derivedHtml, url);
  adoptFrontMatter(page.metadata, source.frontMatter);

  const extracted = await extractor.renderFormats(page.html, page, formats, context);
  // `verbatim` records which of the two `markdown` ended up being, read from the
  // branch actually taken: nothing else on the record implies it, since
  // `mechanism` says how the bytes were reached rather than what was done with
  // them. Three conditions can send a page down the round trip — the safety gate
  // below, a page the declared-language filter rejected, and a body that is empty
  // once trimmed — but in practice only the first fires. A served body can
  // declare a document language only through `<html lang>`, which
  // `looksLikeMarkdown` refuses across its 4 KiB sniff window, or through a
  // `<meta>`, which the safety gate already catches; and a blank body never
  // becomes a served source at all.
  let verbatim = false;
  if (
    formats.includes('markdown') &&
    !page.rejected &&
    !containsUnsafeMarkup(source.markdown, derivedHtml)
  ) {
    // The served bytes replace the rendered ones, wearing this run's own layout
    // envelope. The origin's front matter was stripped upstream, so the output
    // can never carry two stacked `---` blocks.
    //
    // Skipped entirely for a body carrying markup the security floor strips.
    // Emitting those bytes verbatim would make `markdown` the ONE output format
    // that can carry a `<script>`, an `onerror=` handler or a `javascript:`
    // link — measured, and a property the HTML path never had, since its
    // Markdown is rendered from already-sanitized HTML. Such a page keeps the
    // rendered Markdown `renderFormats` already produced: the round trip costs
    // fidelity, which is the right trade for a body that was carrying a script.
    //
    // The question is asked of parsed documents, not of the source text — see
    // `containsUnsafeMarkup` for why both of them have to be examined.
    const body =
      layout === 'minimal'
        ? source.markdown.trim()
        : addFrontMatter(source.markdown.trim(), layout, extracted.outputContext);
    if (body !== '') {
      extracted.formats[CONVERSION_FORMAT_RESULT_KEYS.markdown] = body;
      verbatim = true;
    }
  }
  return { extracted, html: page.html, verbatim };
}
