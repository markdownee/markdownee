import { toLibraryInputSchema, toSharedOutputSchema } from '@markdownee/schema';

/**
 * The `@markdownee/markdownee/schema` entry exposes the shared Zod validators and their
 * library projections. `MarkdowneeLibraryInput` validates createCrawler
 * options and `MarkdowneeFetchInput` validates fetch options;
 * `MarkdowneeInput` is the full shared input, including Actor controls.
 * The JSON Schema helpers below derive from the same shared source; the
 * committed `@markdownee/markdownee/schema/*.json` files (shipped via `package.json`
 * `exports`/`files`) are the same projections for `$schema`/SchemaStore and
 * non-TypeScript consumers.
 */

export {
  CommentHandling,
  CrawlerType,
  Deduplication,
  ImageHandling,
  LinkHandling,
  LogLevel,
  MarkdownDiscovery,
  MarkdowneeFetchInput,
  MarkdowneeInput,
  type MarkdowneeInputType,
  MarkdowneeLibraryInput,
  MarkdowneeOutput,
  type MarkdowneeOutputType,
  Mode,
  OutputLayout,
  ProxyRotation,
  SAVE_ROUTE_TOKENS,
  Save,
  SaveFormat,
  SaveFormatResultKey,
  type SaveRoute,
  TableHandling,
  WaitUntil,
} from '@markdownee/schema';

/** The canonical library-input JSON Schema (draft-07), derived from the Zod SoT. */
export function getInputJsonSchema(): Record<string, unknown> {
  return toLibraryInputSchema();
}

/** The single shared output/dataset JSON Schema (draft-07, top-level `oneOf`). */
export function getOutputJsonSchema(): Record<string, unknown> {
  return toSharedOutputSchema();
}
