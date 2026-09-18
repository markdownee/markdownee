import { createDocument } from '@mixmark-io/domino';
import type { DomDocument, DomElement } from './dom-node.js';

/** Parse an HTML string into a document. The one place this package parses. */
export function parseDocument(html: string): DomDocument {
  return createDocument(html);
}

/**
 * Parse cleaned HTML **once** and return its `<body>` element.
 *
 * The body — never the document — is the conversion root: given a document node,
 * both Turndown and a naive text walk emit the `<title>` as content. Turndown
 * clones the node it is handed rather than re-parsing, so this single parse
 * safely feeds every requested format.
 */
export function parseCleanedHtml(html: string): DomElement {
  const body = parseDocument(html).body;
  if (body === null) throw new TypeError('parsed document has no <body>');
  return body;
}
