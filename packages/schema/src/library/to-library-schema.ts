import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  canonicalizeJsonSchema,
  schemaId,
  TO_JSON_SCHEMA_INPUT,
  TO_JSON_SCHEMA_OUTPUT,
} from '../canonical-json-schema.js';
import { LogLevel } from '../source-of-truth/enum-aliases.js';
import { MarkdowneeInput } from '../source-of-truth/input.js';
import { OrdinaryProxyConfiguration } from '../source-of-truth/ordinary-proxy-configuration.js';
import { MarkdowneeOutput } from '../source-of-truth/output.js';

/**
 * Canonical JSON Schema projections of the ONE Zod source-of-truth for the
 * npm library surface. Unlike `to-apify-schema.ts` these emit vanilla draft-07
 * JSON Schema — no Apify dialect. INPUT is per-surface (the library surface
 * differs from the Apify and CLI surfaces); OUTPUT is byte-identical across
 * surfaces, so there is exactly ONE shared output schema — never per-surface
 * copies.
 */

export const LIBRARY_INPUT_SCHEMA_ID = schemaId('library-input.schema.json');
export const SHARED_OUTPUT_SCHEMA_ID = schemaId('output.schema.json');

/**
 * The library's programmatic input surface as a Zod object — the single source
 * for the library-input JSON Schema. Equals `MarkdowneeInput` minus the
 * Apify-only start-URL / named-bucket fields, plus the three library-only knobs.
 * Mirrors `MarkdowneeOptions` in the `markdownee` package
 * (`packages/standalone/src/library.ts`): `startUrls` is passed to `run(urls)`,
 * so it is not part of the options object; `datasetName`/`keyValueStoreName`/
 * `requestQueueName` are an Apify Actor storage concept; `includeHtml`/
 * `storageDir`/`logLevel` are library-only and intentionally absent from the
 * shared `MarkdowneeInput` so they never leak into the Apify Actor input.
 *
 * The single-page projection derives from this object too.
 */
export const MarkdowneeLibraryInput = MarkdowneeInput.omit({
  startUrls: true,
  datasetName: true,
  keyValueStoreName: true,
  requestQueueName: true,
}).extend({
  proxyConfiguration: OrdinaryProxyConfiguration.optional(),
  includeHtml: z
    .boolean()
    .default(false)
    .describe('Include the raw page `html` on each returned record.')
    .meta({ title: 'Include HTML' }),
  storageDir: z
    .string()
    .optional()
    .describe(
      'When set, ALSO persist full records to disk (Crawlee dataset + key-value store) at this location, in addition to returning them in memory.',
    )
    .meta({ title: 'Storage directory' }),
  logLevel: z
    .enum(LogLevel)
    .default(LogLevel.Warning)
    .describe("Crawlee log threshold for the run. Default 'warning' keeps stdout clean.")
    .meta({ title: 'Log level' }),
});

/** Build the canonical library-input JSON Schema (camelCase, library fields). */
export function toLibraryInputSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(MarkdowneeLibraryInput, TO_JSON_SCHEMA_INPUT);
  return canonicalizeJsonSchema(generated, {
    id: LIBRARY_INPUT_SCHEMA_ID,
    title: 'Markdownee library input',
  });
}

/**
 * Build the SINGLE shared output/dataset JSON Schema (top-level `oneOf` over the
 * success/failed/skipped record shapes). Consumed by library and CLI alike.
 */
export function toSharedOutputSchema(
  schema: z.ZodType = MarkdowneeOutput,
): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, TO_JSON_SCHEMA_OUTPUT);
  return canonicalizeJsonSchema(generated, {
    id: SHARED_OUTPUT_SCHEMA_ID,
    title: 'Markdownee output record',
  });
}

export function writeLibraryInputSchema(outPath: string): void {
  writeFileSync(outPath, `${JSON.stringify(toLibraryInputSchema(), null, 2)}\n`, 'utf8');
}

export function writeSharedOutputSchema(outPath: string): void {
  writeFileSync(outPath, `${JSON.stringify(toSharedOutputSchema(), null, 2)}\n`, 'utf8');
}
