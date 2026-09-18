/**
 * The minimal DOM surface this package and its consumers walk.
 *
 * Declared structurally rather than pulled from `lib.dom`, so the package keeps
 * `"lib": ["ES2022"]` and stays independent of which implementation parsed the
 * HTML (today `@mixmark-io/domino`). This package is the single owner of that
 * dependency and of its type surface — `@markdownee/extraction` reaches the
 * DOM through here rather than declaring the untyped module a second time.
 */
export interface DomNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly firstChild: DomNode | null;
  readonly nextSibling: DomNode | null;
}

/** One attribute of a {@link DomElement}, with its value already entity-decoded. */
export interface DomAttribute {
  readonly name: string;
  readonly value: string;
}

/**
 * What `Element.attributes` returns — array-like for the same reason
 * {@link DomNodeList} is. Use {@link attributesOf}.
 */
export interface DomNamedNodeMap {
  readonly length: number;
  item(index: number): DomAttribute | null;
}

/** A {@link DomNode} of element type: it carries attributes and can be removed. */
export interface DomElement extends DomNode {
  readonly attributes: DomNamedNodeMap;
  readonly outerHTML: string;
  innerHTML: string;
  textContent: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  appendChild(node: DomElement): DomElement;
  remove(): void;
}

/**
 * What `querySelectorAll` returns. It is array-like — numeric indices, `length`,
 * `item()` — but **not iterable**, so `for…of` over it throws. Use
 * {@link elementsOf} rather than spreading it.
 */
export interface DomNodeList {
  readonly length: number;
  item(index: number): DomElement | null;
}

/** A parsed document. */
export interface DomDocument {
  readonly documentElement: DomElement | null;
  readonly body: DomElement | null;
  readonly head: DomElement | null;
  createElement(tagName: string): DomElement;
  querySelectorAll(selector: string): DomNodeList;
}

/** The `Node.nodeType` values the renderers distinguish. */
const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;

/** Narrow a {@link DomNode} to a {@link DomElement}. */
export function isElement(node: DomNode): node is DomElement {
  return node.nodeType === ELEMENT_NODE;
}

/** Lowercased tag name of a node. */
export function tagNameOf(node: DomNode): string {
  return node.nodeName.toLowerCase();
}

/**
 * Snapshot a {@link DomNodeList} into a real array. Two reasons this is not a
 * spread: the list is not iterable, and callers that remove elements must not
 * mutate the collection they are walking.
 */
export function elementsOf(list: DomNodeList): DomElement[] {
  const out: DomElement[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const element = list.item(index);
    if (element !== null) out.push(element);
  }
  return out;
}

/** Snapshot an element's attributes into a real array, for the same two reasons. */
export function attributesOf(map: DomNamedNodeMap): DomAttribute[] {
  const out: DomAttribute[] = [];
  for (let index = 0; index < map.length; index += 1) {
    const attribute = map.item(index);
    if (attribute !== null) out.push(attribute);
  }
  return out;
}
