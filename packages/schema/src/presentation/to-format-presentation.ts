import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { apifyRegistry } from '../apify/apify-registry.js';
import { asSchemaNode, TO_JSON_SCHEMA_OUTPUT } from '../canonical-json-schema.js';
import { type SaveFormat, SaveFormatResultKey } from '../source-of-truth/enum-aliases.js';
import { MarkdowneeInput, SAVE_ROUTE_TOKENS } from '../source-of-truth/input.js';
import { MarkdowneeOutput } from '../source-of-truth/output.js';

/**
 * The presentation artifact — one entry per output FORMAT (not per save route) —
 * that gives an external form UI (the playground's "Output" checkboxes)
 * everything it needs to render a format and its `?` help in a SINGLE import: a
 * human label plus the prose description.
 *
 * Mirrors {@link ./to-field-presentation.ts to-field-presentation}: it is an
 * EXPLICIT presentation artifact (it MAY carry Apify-derived UI strings such as
 * the `enumTitles`-based label), NOT a canonical input/output schema, so it is
 * not subject to the no-Apify-dialect guard.
 *
 * Everything is derived — never hand-edit the generated JSON:
 * - `format`: the format key as it appears in `save` tokens (`txt`, `markdown`,
 *   `html`, `minified-html`, `original`), in `SAVE_ROUTE_TOKENS` declaration order.
 * - `label`: the format part of the `save` field's Apify `enumTitles` (the text
 *   before the "→ destination", e.g. `Plain text` from `Plain text → Dataset`).
 * - `description`: the per-format `.describe(...)` text on the output
 *   source-of-truth's `success` record.
 *
 * Change the Zod SoT (or `apifyRegistry`) and regenerate; the snapshot test
 * keeps the on-disk JSON in lockstep.
 */
export interface FormatPresentation {
  /** The output format key as used in `save` tokens (the join key). */
  format: string;
  /** Form label, derived from the `save` `enumTitles` (e.g. "Plain text"). */
  label: string;
  /** Prose help, from the output record field's `.describe(...)`. */
  description: string;
}

export interface FormatPresentationDocument {
  title: string;
  description: string;
  formats: FormatPresentation[];
}

/**
 * A `save` token without its `-dataset`/`-kvs` destination suffix, validated
 * against the `SaveFormat` vocabulary so the literal type survives instead of
 * being widened to `string` and re-asserted at the result-key lookup.
 */
function formatOf(token: string): SaveFormat {
  const format = token.replace(/-(?:dataset|kvs)$/, '');
  if (!Object.hasOwn(SaveFormatResultKey, format)) {
    throw new Error(`Unrecognized save-route token "${token}"`);
  }
  return format as SaveFormat;
}

/** The output formats in `SAVE_ROUTE_TOKENS` declaration order, de-duplicated. */
function orderedFormats(): SaveFormat[] {
  const seen = new Set<SaveFormat>();
  const formats: SaveFormat[] = [];
  for (const token of SAVE_ROUTE_TOKENS) {
    const format = formatOf(token);
    if (!seen.has(format)) {
      seen.add(format);
      formats.push(format);
    }
  }
  return formats;
}

/**
 * Map each format to its label, from the first `save` `enumTitle` whose token
 * matches that format — the text before the "→ destination" arrow.
 */
function formatLabels(): Map<SaveFormat, string> {
  const enumTitles = apifyRegistry.get(MarkdowneeInput.shape.save)?.enumTitles ?? [];
  const labels = new Map<SaveFormat, string>();
  SAVE_ROUTE_TOKENS.forEach((token, index) => {
    const format = formatOf(token);
    if (labels.has(format)) return;
    const title = enumTitles[index];
    if (typeof title === 'string') {
      labels.set(format, (title.split('→')[0] ?? format).trim());
    }
  });
  return labels;
}

/**
 * The discriminated-union variant whose `status` literal is `success`.
 *
 * Narrows at the dispatch head: a variant, its `properties` and its `status`
 * node are all positions draft-07 allows a boolean in, so a non-object at any
 * of the three is simply not the success variant.
 */
function isSuccessVariant(variant: unknown): boolean {
  const properties = asSchemaNode(asSchemaNode(variant)?.properties);
  const status = asSchemaNode(properties?.status);
  if (!status) return false;
  if (status.const === 'success') return true;
  return Array.isArray(status.enum) && status.enum.length === 1 && status.enum[0] === 'success';
}

/**
 * Map each output format field to its `.describe(...)` text, read off the
 * `success` variant of the output JSON Schema (derived from the Zod SoT exactly
 * like to-field-presentation derives its field metadata).
 */
function formatDescriptions(): Map<string, string> {
  const schema = asSchemaNode(z.toJSONSchema(MarkdowneeOutput, TO_JSON_SCHEMA_OUTPUT)) ?? {};
  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : [];
  const success = asSchemaNode(variants.find(isSuccessVariant));
  const properties = asSchemaNode(success?.properties) ?? {};
  const descriptions = new Map<string, string>();
  for (const [field, raw] of Object.entries(properties)) {
    const prop = asSchemaNode(raw);
    if (prop && typeof prop.description === 'string') descriptions.set(field, prop.description);
  }
  return descriptions;
}

/** Build the format-presentation document for the output formats. */
export function toFormatPresentation(): FormatPresentationDocument {
  const labels = formatLabels();
  const descriptions = formatDescriptions();
  const formats: FormatPresentation[] = orderedFormats().map((format) => {
    const resultKey = SaveFormatResultKey[format];
    return {
      format,
      label: labels.get(format) ?? format,
      description: descriptions.get(resultKey) ?? '',
    };
  });

  return {
    title: 'Markdownee format presentation',
    description:
      'Generated per-output-format presentation metadata (label + description) for the markdownee extraction formats. Derived from the Zod source of truth — the save-route enumTitles and the output record descriptions; do not edit by hand.',
    formats,
  };
}

export function writeFormatPresentation(outPath: string): void {
  writeFileSync(outPath, `${JSON.stringify(toFormatPresentation(), null, 2)}\n`, 'utf8');
}
