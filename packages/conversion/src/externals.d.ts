// Ambient declarations for the two untyped runtime dependencies.
//
// `@mixmark-io/domino` ships a `lib/index.d.ts`, but it declares the module
// under its pre-fork name (`'domino'`) and types the result with `lib.dom`
// globals this package does not load. `@joplin/turndown-plugin-gfm` ships no
// types at all and has no `@types/` package. Both are declared here instead,
// against this package's own structural DOM types — which is why it needs no
// `lib.dom`. This is also the repo's ONLY declaration of `@mixmark-io/domino`:
// a second one in another package would collide wherever both are compiled into
// one program.
//
// This file must stay a script (no top-level `import`/`export`), or these become
// module augmentations of packages that do not exist. Hence the inline
// `import('./…')` type references.

declare module '@mixmark-io/domino' {
  export function createDocument(
    html?: string,
    force?: boolean,
  ): import('./dom-node.js').DomDocument;
}

declare module '@joplin/turndown-plugin-gfm' {
  /** Registers tables, strikethrough, task-list-item, and highlighted-code rules. */
  export function gfm(service: unknown): void;
  export function tables(service: unknown): void;
  export function strikethrough(service: unknown): void;
  export function taskListItems(service: unknown): void;
}
