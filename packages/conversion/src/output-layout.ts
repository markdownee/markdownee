import { createDocument } from '@mixmark-io/domino';
import { stringify } from 'yaml';
import type { DomDocument } from './dom-node.js';
import {
  frontMatterForLayout,
  normalizeContextForLayout,
  type OutputContext,
  type OutputLayout,
} from './output-context.js';
import { parseDocument } from './parse.js';

function appendMeta(doc: DomDocument, name: string, content: string): void {
  const meta = doc.createElement('meta');
  meta.setAttribute('name', name);
  meta.setAttribute('content', content);
  doc.head?.appendChild(meta);
}

function appendMetadataHead(doc: DomDocument, context: OutputContext, enhanced: boolean): void {
  const metadata = context.metadata;
  if (metadata.title !== undefined) {
    const title = doc.createElement('title');
    title.textContent = metadata.title;
    doc.head?.appendChild(title);
  }
  if (metadata.author !== undefined) appendMeta(doc, 'author', metadata.author);
  if (metadata.date !== undefined) appendMeta(doc, 'date', metadata.date);
  if (metadata.description !== undefined) appendMeta(doc, 'description', metadata.description);
  if (metadata.languageCode !== undefined) {
    doc.documentElement?.setAttribute('lang', metadata.languageCode);
  }
  if (!enhanced) return;

  if (metadata.siteName !== undefined) appendMeta(doc, 'markdownee:site-name', metadata.siteName);

  const scalarEntries: readonly [string, string | undefined][] = [
    ['page-url', metadata.pageUrl],
    ['image-url', metadata.imageUrl],
    ['hostname', metadata.hostname],
    ['license', metadata.license],
    ['declared-page-type', metadata.declaredPageType],
    ['request-url', context.url],
    ['crawl-loaded-url', context.crawl?.loadedUrl],
    ['crawl-scraped-at', context.crawl?.scrapedAt],
    ['crawl-http-status-code', context.crawl?.httpStatusCode?.toString()],
    ['crawl-depth', context.crawl?.depth?.toString()],
    ['crawl-referrer-url', context.crawl?.referrerUrl],
  ];
  for (const [name, value] of scalarEntries) {
    if (value !== undefined) appendMeta(doc, `markdownee:${name}`, value);
  }
  for (const category of metadata.categories ?? [])
    appendMeta(doc, 'markdownee:category', category);
  for (const tag of metadata.tags ?? []) appendMeta(doc, 'markdownee:tag', tag);
}

/** Build the selected HTML envelope from secured body markup and allowlisted context. */
export function buildLayoutHtml(
  securedHtml: string,
  layout: OutputLayout,
  context: OutputContext,
): string {
  const fragment = parseDocument(securedHtml).body?.innerHTML ?? '';
  if (layout === 'minimal') return fragment;

  const doc = createDocument('<!DOCTYPE html><html><head></head><body></body></html>');
  if (doc.body !== null) doc.body.innerHTML = fragment;
  appendMetadataHead(doc, normalizeContextForLayout(context, layout), layout === 'enhanced');
  return `<!DOCTYPE html>${doc.documentElement?.outerHTML ?? '<html><head></head><body></body></html>'}`;
}

/** Add a YAML front-matter envelope to TXT or Markdown body bytes. */
export function addFrontMatter(
  body: string,
  layout: Exclude<OutputLayout, 'minimal'>,
  context: OutputContext,
): string {
  const yaml = stringify(frontMatterForLayout(context, layout), { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body}`;
}
