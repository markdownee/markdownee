import { createDocument } from '@mixmark-io/domino';
import { Marked, type Token } from 'marked';
import { parse as parseYaml } from 'yaml';
import { attributesOf, elementsOf, tagNameOf } from './dom-node.js';

/**
 * Reading a Markdown body a third-party origin served for a page, so the other
 * formats can be rendered from it.
 *
 * This is the inbound half of the package's format work — `markdown.ts` renders
 * cleaned HTML to Markdown, this reads Markdown back. Both are pure format
 * conversion; neither fetches anything.
 *
 * **The HTML this module produces is UNSANITIZED.** By spec Markdown is a
 * superset of raw HTML — CommonMark treats an HTML block as "raw HTML (and will
 * not be escaped in HTML output)" — and marked's own README states it "does not
 * sanitize the output HTML". A served body carrying `<script>`, an `onerror=`
 * handler, or a `javascript:` link therefore reaches {@link markdownToHtml}'s
 * output verbatim. Every caller MUST pass that HTML through Trafilatura Core's
 * unconditional sanitize-html security floor (`prepare`/`prepareHtml`) before
 * anything else consumes it. `formatSecuredHtml` is NOT a substitute: its input
 * contract is already-secured HTML and it would minify an attacker's script
 * rather than remove it.
 */

/** Bytes of a leading YAML block this module is willing to parse. */
const MAX_FRONT_MATTER_BYTES = 16_384;

/** Bytes of a front-matter scalar kept as metadata. */
const MAX_FRONT_MATTER_SCALAR = 2_048;

/** Head of the body examined by {@link looksLikeMarkdown}. */
const SNIFF_WINDOW = 4_096;

/** A markup document mislabelled as Markdown, which every origin tested can produce. */
const HTML_DOCUMENT = /<!doctype\s+html|<html[\s>]|<body[\s>]/i;

/**
 * Positive evidence that a body is Markdown, in two shapes.
 *
 * Block constructs are line-anchored, because that is what makes them
 * constructs: an ATX heading, a blockquote, a bullet or ordered list item, a
 * fenced block, a table row, or a setext underline.
 */
const MARKDOWN_BLOCK =
  /(^|\n)[ \t]{0,3}(#{1,6}[ \t]|>[ \t]?|[-*+][ \t]|\d{1,9}[.)][ \t]|```|~~~|\||={2,}[ \t]*(\r?\n|$)|-{2,}[ \t]*(\r?\n|$))/;

/**
 * Inline constructs may appear anywhere in a line, and on a prose page they are
 * often the only evidence there is: a link, an image, a code span, or an
 * autolink. Anchoring these at line start — as an earlier version of this
 * pattern did — rejected an ordinary paragraph carrying a mid-sentence link.
 */
const MARKDOWN_INLINE = /!?\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]+`|<https?:\/\/[^\s>]+>/;

/**
 * The front-matter keys this engine will adopt as page metadata. Every origin
 * measured that prepends YAML emits exactly these three (Cloudflare docs,
 * Cloudflare's blog, Read the Docs, Apify docs, 2026-08-21). They map onto
 * already-allowlisted output-metadata fields; nothing else is read, because
 * front matter is attacker-controlled input like the rest of the body.
 */
const ADOPTED_FRONT_MATTER_KEYS = ['title', 'description', 'image'] as const;

/** Allowlisted scalars lifted out of a served body's leading YAML block. */
export interface ServedFrontMatter {
  title?: string;
  description?: string;
  image?: string;
}

/** A served Markdown body split into its leading YAML block and its content. */
export interface ServedMarkdown {
  /** The body with any leading YAML front matter removed. */
  body: string;
  /** Allowlisted scalars read out of that block; empty when there was none. */
  frontMatter: ServedFrontMatter;
  /** Whether a leading YAML block was present and removed. */
  hadFrontMatter: boolean;
}

function readScalar(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAX_FRONT_MATTER_SCALAR) return undefined;
  return trimmed;
}

/**
 * Split a leading Jekyll-style YAML block off a served body.
 *
 * Front matter is a convention, not part of any Markdown spec — CommonMark and
 * GFM never mention it and marked declined to handle it (markedjs/marked#485) —
 * so stripping it is the consumer's job. It has to happen before anything else
 * looks at the body: Read the Docs serves a YAML block followed by a literal
 * `<!DOCTYPE html>`, so sniffing the raw bytes sees the `---`, passes, and
 * admits an HTML document as Markdown.
 *
 * A malformed or oversized block is left in place rather than guessed at: the
 * body is then almost certainly not what it claims to be, and
 * {@link looksLikeMarkdown} is the right place to reject it.
 */
export function stripFrontMatter(source: string): ServedMarkdown {
  // A UTF-8 BOM survives `.toString('utf8')` and would defeat the opening match.
  const text = source.startsWith('﻿') ? source.slice(1) : source;
  const opening = text.match(/^---[ \t]*\r?\n/);
  if (!opening) return { body: text, frontMatter: {}, hadFrontMatter: false };

  const afterOpening = text.slice(opening[0].length);
  const closing = afterOpening.match(/(?:^|\r?\n)(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  if (!closing || closing.index === undefined) {
    return { body: text, frontMatter: {}, hadFrontMatter: false };
  }

  const yamlSource = afterOpening.slice(0, closing.index);
  if (Buffer.byteLength(yamlSource, 'utf8') > MAX_FRONT_MATTER_BYTES) {
    return { body: text, frontMatter: {}, hadFrontMatter: false };
  }

  const body = afterOpening.slice(closing.index + closing[0].length);
  const frontMatter: ServedFrontMatter = {};
  try {
    const parsed: unknown = parseYaml(yamlSource);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      for (const key of ADOPTED_FRONT_MATTER_KEYS) {
        const scalar = readScalar(record[key]);
        if (scalar !== undefined) frontMatter[key] = scalar;
      }
    }
  } catch {
    // Unparseable YAML is not a reason to keep the block in the body; it was
    // still delimited front matter and would otherwise stack under ours.
  }
  return { body, frontMatter, hadFrontMatter: true };
}

/**
 * Whether `body` reads as Markdown rather than as a markup document or filler.
 *
 * Call this on the output of {@link stripFrontMatter}, never on raw bytes.
 *
 * Positive evidence is required rather than merely "not HTML". CommonMark says
 * "Any sequence of characters is a valid CommonMark document", so there is no
 * such thing as invalid Markdown to reject; the only meaningful question is
 * whether the origin actually sent the representation it claimed. Origins
 * demonstrably mislabel — one serves an HTML document as `text/markdown`,
 * another serves a megabyte-long `text/plain` 404 — so a body with no Markdown
 * construct at all is treated as a miss and the caller falls back to HTML
 * extraction. The cost of being wrong here is one page extracted the ordinary
 * way; the cost of the opposite is an error page committed as content.
 */
export function looksLikeMarkdown(body: string): boolean {
  if (body.trim() === '') return false;
  const head = body.slice(0, SNIFF_WINDOW);
  if (HTML_DOCUMENT.test(head)) return false;
  return MARKDOWN_BLOCK.test(head) || MARKDOWN_INLINE.test(head);
}

/**
 * Elements the security floor removes outright, whatever they contain.
 *
 * `svg` and `math` are here because both carry their own link grammar —
 * `<animate attributeName="xlink:href">` and `<maction xlink:href>` reach a
 * scheme through an attribute no HTML-shaped allowlist names.
 */
const UNSAFE_ELEMENTS = new Set([
  'applet',
  'base',
  'embed',
  'form',
  'frame',
  'frameset',
  'iframe',
  'link',
  'math',
  'meta',
  'object',
  'script',
  'style',
  'svg',
]);

/** URL schemes that execute rather than locate. */
const UNSAFE_SCHEMES = /^(?:javascript|vbscript|livescript|mocha|data:text\/html)/;

/**
 * The scheme an attribute value resolves to, as a consumer would read it.
 *
 * A URL parser strips ASCII whitespace and NUL from a scheme before resolving
 * it, so `java&#09;script:` and `javascript&colon;` both reach `javascript:`
 * once the parser has seen them. Normalising the same way here is what makes
 * this check exact rather than a pattern that an encoding defeats.
 */
function resolvedScheme(value: string): string {
  // A code-point filter rather than a regex class, because a class over this
  // range is exactly what `noControlCharactersInRegex` exists to catch — and
  // here the control characters are the point rather than a typo.
  let stripped = '';
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) > 0x20) stripped += character;
  }
  return stripped.toLowerCase();
}

/**
 * Whether one attribute would carry executable markup into a consumer.
 *
 * Every attribute value is scheme-checked, not just the URL-bearing ones: SVG
 * and MathML reach a scheme through `values`, `from`, `to` and `xlink:href`,
 * and an allowlist of attribute names would have to enumerate them all.
 */
function unsafeAttribute(name: string, value: string): boolean {
  if (name.startsWith('on')) return true;
  if (name === 'srcdoc') return true;
  const resolved = resolvedScheme(value);
  if (UNSAFE_SCHEMES.test(resolved)) return true;
  return (
    name === 'style' && (resolved.includes('expression(') || resolved.includes('url(javascript'))
  );
}

/** Whether any element in a parsed document carries markup the floor strips. */
function unsafeDocument(html: string): boolean {
  return elementsOf(createDocument(html, true).querySelectorAll('*')).some(
    (element) =>
      UNSAFE_ELEMENTS.has(tagNameOf(element)) ||
      attributesOf(element.attributes).some((attribute) =>
        unsafeAttribute(attribute.name.toLowerCase(), attribute.value),
      ),
  );
}

/**
 * The Markdown source with every code block and code span removed.
 *
 * Fenced, indented and inline code is the one construct every CommonMark
 * renderer escapes rather than interprets, so it is the one place markup-shaped
 * text is provably inert. Everything else is fair game for a consumer's parser
 * and is kept for {@link containsUnsafeMarkup} to examine.
 */
function withoutCode(markdown: string): string {
  const collect = (tokens: readonly Token[]): string =>
    tokens
      .map((token) => {
        if (token.type === 'code' || token.type === 'codespan') return '';
        const nested = 'tokens' in token ? token.tokens : undefined;
        return nested !== undefined && nested.length > 0 ? collect(nested) : token.raw;
      })
      .join('');
  return collect(marked.lexer(markdown));
}

/**
 * Whether a served Markdown body carries markup the security floor would strip.
 *
 * Its one job is to answer "may the source bytes be emitted verbatim?". A body
 * that fails this is not rejected — the caller renders that page's Markdown from
 * the sanitized HTML instead, trading the verbatim fidelity this design normally
 * preserves for the guarantee the HTML path already gives: that no output format
 * can carry a script, an event handler, or a dangerous URL scheme.
 *
 * **Both questions are asked of a parsed document, never of the source text.**
 * Deciding from source text was measured wrong in both directions. It admitted
 * danger, because the source is not what a consumer resolves:
 * `[x](&#106;avascript:alert(1))`, `<a href="javascript&colon;…">` and
 * `java&#09;script:` all contain no literal `javascript:` and so passed a pattern
 * over the bytes, while every consumer decodes the entity and strips the control
 * character before resolving the scheme. And it refused the safe, because a
 * `<script>` inside a fenced block, a `<meta name="viewport">` shown as an
 * example, or the word `once = ` in a TOML sample are prose about markup, not
 * markup — 7% of this repository's own Markdown tripped the source patterns.
 *
 * Two documents are examined because two different parsers see these bytes:
 *
 * - `renderedHtml` is what this run produced, and is what the `html` and `txt`
 *   formats derive from. Parsing it catches every scheme marked resolved.
 * - {@link withoutCode} is the source as a *lenient* consumer might read it.
 *   `<img/onerror=alert(1) src=x>` is not a valid tag under CommonMark's grammar,
 *   so marked escapes it and it never reaches `renderedHtml` — but the verbatim
 *   bytes are what this function is authorizing, and an HTML parser given them
 *   yields a live handler. Only code, which every renderer escapes, is dropped.
 */
export function containsUnsafeMarkup(markdown: string, renderedHtml: string): boolean {
  return unsafeDocument(renderedHtml) || unsafeDocument(withoutCode(markdown));
}

/**
 * Markdown dialect. CommonMark 0.31.2 plus GFM's frozen extension set is the de
 * facto 2026 baseline and what every origin measured emits. RFC 7763's
 * `variant` parameter is a hint only and no live origin sends one, which per the
 * RFC leaves interpretation "entirely up to the receiver" — so this is a
 * receiver policy, deliberately fixed rather than exposed as an option.
 *
 * `breaks: false` keeps CommonMark's own line-break rule. One `Marked` instance
 * is configured once and reused, mirroring `markdown.ts`'s Turndown service.
 */
const marked = new Marked({ gfm: true, breaks: false, pedantic: false });

/**
 * Render a Markdown body to HTML.
 *
 * **The result is UNSANITIZED** — see this module's header. Sanitize it before
 * any other consumer sees it, and sanitize last, after every transform.
 *
 * **Bound the input before calling this.** `marked` 18.0.10 is quadratic in the
 * number of GFM task-list items a body carries — 32,000 of them hold the event
 * loop for 5.8 s — and `marked.parse` is synchronous, so no timeout preempts it.
 * Bounding belongs to whichever boundary admitted the untrusted bytes, which for
 * a served body is `@markdownee/crawler`'s `acceptMarkdownResponse`.
 */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false });
}
