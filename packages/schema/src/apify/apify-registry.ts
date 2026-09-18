import { z } from 'zod';
import type { ApifyMeta } from './apify-meta.js';

/**
 * Registry of Apify-only UI hints (`editor`, `prefill`, `sectionCaption`,
 * `enumTitles`, …), keyed by the field schema they annotate. These hints live
 * here rather than inline in each field's `.meta(...)` so the exported Zod
 * source-of-truth — and every JSON Schema derived from it via
 * `z.toJSONSchema()` — stays Apify-agnostic: only the vanilla JSON Schema
 * keywords (`title` via `.meta({ title })`, `description` via `.describe()`)
 * remain on the schema. `z.toJSONSchema()` reads the GLOBAL registry, so a
 * separate registry is never emitted into the library/CLI schemas.
 *
 * The Apify generators ({@link ../apify/to-apify-schema.ts}) join this registry
 * back onto the clean schema at build time, reproducing the `.actor/*.json`
 * files byte-for-byte. Look a field's hints up with
 * `apifyRegistry.get(MarkdowneeInput.shape[name])`. That lookup is keyed by
 * schema-object identity, so `.register(apifyRegistry, …)` MUST be the terminal
 * call in each field's chain — chaining `.optional()`/`.describe()` AFTER it
 * makes `.shape[name]` a different object and silently drops the field's hints
 * (the byte-identical `.actor/*.json` snapshot tests are the backstop).
 *
 * Typed as {@link ApifyMeta} so `.register(apifyRegistry, { … })` rejects a
 * misspelled key or wrong editor name at compile time — the same safety the
 * former `apifyMeta()` helper provided.
 */
export const apifyRegistry = z.registry<ApifyMeta>();
