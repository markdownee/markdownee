import { type DomNode, isElement, TEXT_NODE, tagNameOf } from './dom-node.js';

/**
 * Blocks separated from their neighbours by a blank line.
 * (`<pre>` is here too; its *contents* are still emitted verbatim.)
 */
const PARAGRAPH_BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'div',
  'dl',
  'figure',
  'figcaption',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

/** Blocks separated from their siblings by a single newline, inside a parent block. */
const LINE_BLOCKS = new Set(['caption', 'dd', 'dt', 'li', 'tr']);

/** Table cells. Adjacent cells are joined by {@link CELL_SEPARATOR}. */
const CELLS = new Set(['td', 'th']);

/**
 * Table cells within a row are joined by ` | `, and rows by a newline — so a
 * table reads as pipe-delimited lines rather than one run-on line. This matches
 * the plain-text tables Markdownee emitted before the engine swap; the naive
 * walk (concatenating cell text) would otherwise collapse `A B / 1 2` onto one
 * line and lose the column structure entirely. It is deliberately *not* a
 * Markdown table: there is no header rule, no padding, and no leading pipe.
 */
const CELL_SEPARATOR = ' | ';

/** Elements whose text is never content. */
const DROPPED = new Set(['head', 'noscript', 'script', 'style', 'template', 'title']);

type Token =
  /** A run of collapsible text. */
  | { kind: 'text'; value: string }
  /** Text emitted verbatim (inside `<pre>`). */
  | { kind: 'verbatim'; value: string }
  /** Request at least `count` newlines before the next text. */
  | { kind: 'break'; count: number }
  /** A table-cell separator; suppressed when a break intervenes. */
  | { kind: 'separator' };

function nextElementSibling(node: DomNode): DomNode | null {
  let sibling = node.nextSibling;
  while (sibling !== null && !isElement(sibling)) sibling = sibling.nextSibling;
  return sibling;
}

function tokenize(node: DomNode, inPre: boolean, tokens: Token[]): void {
  if (node.nodeType === TEXT_NODE) {
    const value = node.nodeValue ?? '';
    tokens.push(inPre ? { kind: 'verbatim', value } : { kind: 'text', value });
    return;
  }
  if (!isElement(node)) return;

  const tag = tagNameOf(node);
  if (DROPPED.has(tag)) return;
  if (tag === 'br') {
    tokens.push({ kind: 'break', count: 1 });
    return;
  }
  if (tag === 'img') {
    const alt = node.getAttribute('alt');
    if (node.getAttribute('src') !== null) {
      // An image with a source contributes its alt text, the only thing it can
      // say in plain text.
      if (alt !== null && alt.trim() !== '') tokens.push({ kind: 'text', value: alt });
      return;
    }
    // A src-less <img> is the engine's `alt-text` stand-in shape: render the
    // bracketed placeholder family. An explicit alt="" marks a decorative
    // image (nothing emitted); a missing alt attribute yields the generic token.
    if (alt === null) tokens.push({ kind: 'text', value: '[Image]' });
    else if (alt.trim() !== '') tokens.push({ kind: 'text', value: `[Image: ${alt.trim()}]` });
    return;
  }

  const isParagraph = PARAGRAPH_BLOCKS.has(tag);
  const isLine = LINE_BLOCKS.has(tag);
  const boundary = isParagraph ? 2 : isLine ? 1 : 0;

  if (boundary > 0) tokens.push({ kind: 'break', count: boundary });
  const childrenInPre = inPre || tag === 'pre';
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    tokenize(child, childrenInPre, tokens);
  }
  if (boundary > 0) tokens.push({ kind: 'break', count: boundary });

  if (CELLS.has(tag)) {
    const sibling = nextElementSibling(node);
    if (sibling !== null && CELLS.has(tagNameOf(sibling))) tokens.push({ kind: 'separator' });
  }
}

/** Drop the trailing spaces a pending newline is about to make invisible. */
function trimTrailingSpaces(text: string): string {
  return text.replace(/[ \t]+$/, '');
}

function render(tokens: Token[]): string {
  let out = '';
  let pendingBreaks = 0;

  for (const token of tokens) {
    if (token.kind === 'break') {
      // A break before any content is a leading blank line — drop it.
      if (out !== '') pendingBreaks = Math.max(pendingBreaks, token.count);
      continue;
    }
    if (token.kind === 'separator') {
      // A row/block boundary already separated the cells; do not also add ` | `.
      if (out !== '' && pendingBreaks === 0) out = `${trimTrailingSpaces(out)}${CELL_SEPARATOR}`;
      continue;
    }

    let value = token.value;
    if (token.kind === 'text') {
      value = value.replace(/\s+/g, ' ');
      if (value.trim() === '') {
        // Inter-element whitespace: worth at most one space, and nothing at all
        // across a pending break or after an existing space.
        if (out !== '' && pendingBreaks === 0 && !out.endsWith(' ')) out += ' ';
        continue;
      }
      if (pendingBreaks > 0 || out === '' || out.endsWith(' ')) value = value.replace(/^ /, '');
    }
    if (value === '') continue;

    if (pendingBreaks > 0) {
      out = trimTrailingSpaces(out) + '\n'.repeat(pendingBreaks);
      pendingBreaks = 0;
    }
    out += value;
  }

  return out.trim();
}

/**
 * Render an already-parsed cleaned-HTML body to plain text.
 *
 * Whitespace inside text nodes is collapsed so presentation formatting cannot
 * affect plain-text bytes,
 * except inside `<pre>`, whose contents are emitted verbatim. Block elements are
 * separated by a blank line, list items and table rows by a single newline, and
 * adjacent table cells by {@link CELL_SEPARATOR}.
 */
export function toPlainText(body: DomNode): string {
  const tokens: Token[] = [];
  tokenize(body, false, tokens);
  return render(tokens);
}
