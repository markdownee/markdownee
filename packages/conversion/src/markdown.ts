import { gfm } from '@joplin/turndown-plugin-gfm';
import TurndownService from 'turndown';
import type { DomElement } from './dom-node.js';

/**
 * ATX headings and fenced code blocks are the forms every Markdown renderer
 * handles; the rest are Turndown's own defaults (`_em_`, `**strong**`, three-space
 * list-item indent).
 */
const TURNDOWN_OPTIONS = {
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
} as const;

/** Turndown's own attribute cleanup: collapse newline runs inside alt/title text. */
function cleanAttribute(attribute: string | null): string {
  return attribute ? attribute.replace(/(\n+\s*)+/g, '\n') : '';
}

/**
 * Custom `img` rule replacing turndown's default (which emits `''` for a
 * src-less `<img>`). A src-less `<img alt="…">` is the engine's `alt-text`
 * stand-in shape, rendered as `![alt]()` — a valid CommonMark image node with
 * an empty destination. The rendering keys off the HTML shape, not a plumbed
 * mode, so it is deterministic in every mode:
 *
 * - `src` present → `![alt](src "title")` (turndown's default behavior)
 * - src-less, non-empty `alt` → `![alt]()`
 * - src-less, explicit `alt=""` → `''` (decorative image)
 * - src-less, NO `alt` attribute → `![Image]()` (generic token)
 */
const IMAGE_RULE: TurndownService.Rule = {
  filter: 'img',
  replacement: (_content, node) => {
    const img = node as unknown as DomElement;
    const src = img.getAttribute('src') ?? '';
    const alt = img.getAttribute('alt');
    if (src !== '') {
      const title = cleanAttribute(img.getAttribute('title'));
      const titlePart = title ? ` "${title}"` : '';
      return `![${cleanAttribute(alt)}](${src}${titlePart})`;
    }
    if (alt === null) return '![Image]()';
    if (alt.trim() === '') return '';
    return `![${cleanAttribute(alt)}]()`;
  },
};

const turndownService = new TurndownService({ ...TURNDOWN_OPTIONS, linkStyle: 'inlined' });
// GFM adds tables, strikethrough, task-list items, and highlighted code.
turndownService.use(gfm);
// Custom rules are matched before the built-ins, so this shadows the default image rule.
turndownService.addRule('image', IMAGE_RULE);

/**
 * Render an already-parsed cleaned-HTML body to Markdown.
 *
 * Turndown collapses the engine's prettier-formatted whitespace itself, so a
 * `<p>` broken across source lines still renders as a single paragraph.
 *
 * `@types/turndown` types the node parameter with `lib.dom` globals this package
 * deliberately does not load, so the structural {@link DomElement} is cast in at
 * this one boundary.
 */
export function toMarkdown(body: DomElement): string {
  return turndownService.turndown(body as unknown as TurndownService.Node).trim();
}
