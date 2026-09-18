import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { apifyRegistry } from './apify-registry.js';

export interface ApifyInputSchemaJSON {
  title: string;
  description?: string;
  type: 'object';
  schemaVersion: 1;
  properties: Record<string, Record<string, unknown>>;
  required: string[];
}

export interface ToApifyInputSchemaOptions {
  title?: string;
  description?: string;
}

const PROPERTY_KEY_ORDER: readonly string[] = [
  'sectionCaption',
  'sectionDescription',
  'groupCaption',
  'groupDescription',
  'title',
  'type',
  'description',
  'editor',
  'default',
  'prefill',
  'enum',
  'enumTitles',
  'enumSuggestedValues',
  'minimum',
  'maximum',
  'unit',
  'isSecret',
  'nullable',
  'resourceType',
  'resourcePermissions',
  'patternKey',
  'patternValue',
  'placeholderKey',
  'placeholderValue',
  'dateType',
  'mcpServers',
  'items',
  'properties',
  'required',
];

const TYPES_WITH_TOP_LEVEL_ITEMS_STRIPPED = new Set(['array']);

export function toApifyInputSchema(
  schema: z.ZodObject,
  opts: ToApifyInputSchemaOptions = {},
): ApifyInputSchemaJSON {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-07',
    io: 'input',
    unrepresentable: 'any',
    reused: 'inline',
  });

  if (typeof generated !== 'object' || generated === null) {
    throw new Error('z.toJSONSchema did not return an object schema');
  }

  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    if (key in generated) {
      throw new Error(
        `Top-level '${key}' is not supported by the Apify INPUT_SCHEMA dialect; use a flat z.object(...) instead of z.union/z.discriminatedUnion at the root.`,
      );
    }
  }

  const sourceProperties = generated.properties ?? {};
  const sourceRequired = generated.required ?? [];

  // Apify-only UI hints live in `apifyRegistry` (not inline `.meta()`), so
  // `z.toJSONSchema` above does NOT emit them. Join them back per field, keyed
  // by the field schema, before normalizing — reproducing the pre-registry
  // behavior where the hints rode along inside `.meta()` as sibling keys.
  const shape = schema.shape as Record<string, z.ZodType>;
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [name, raw] of Object.entries(sourceProperties)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const fieldSchema = shape[name];
    const hints = fieldSchema ? apifyRegistry.get(fieldSchema) : undefined;
    const merged: Record<string, unknown> = hints ? { ...raw, ...hints } : raw;
    properties[name] = normalizeProperty(merged);
  }

  // Workaround for https://github.com/colinhacks/zod/issues/4134 — `io: 'input'`
  // still emits defaulted fields in `required`. Drop any required entry whose
  // property carries a `default` keyword.
  const required = sourceRequired.filter((name) => {
    const prop = properties[name];
    return prop ? !('default' in prop) : true;
  });

  const envelope: ApifyInputSchemaJSON = {
    title: opts.title ?? 'Input',
    type: 'object',
    schemaVersion: 1,
    properties,
    required,
  };
  if (opts.description !== undefined) {
    envelope.description = opts.description;
  }

  return orderEnvelope(envelope);
}

export function writeApifyInputSchema(
  schema: z.ZodObject,
  outPath: string,
  opts: ToApifyInputSchemaOptions = {},
): void {
  const out = toApifyInputSchema(schema, opts);
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
}

function normalizeProperty(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  // Drop $-prefixed bookkeeping keys that the Apify dialect omits.
  delete out.$schema;
  delete out.$id;
  delete out.$ref;
  delete out.$defs;

  const type = typeof out.type === 'string' ? out.type : undefined;

  // Apify's `objectProperty` constrains `additionalProperties` to a boolean
  // (or absent) and rejects `propertyNames` outright. Zod emits both for
  // `z.record(...)`; strip them so the meta-schema accepts the result.
  if (type === 'object') {
    delete out.additionalProperties;
    delete out.unevaluatedProperties;
    delete out.propertyNames;
  }

  // For array+select with an enum on items, Apify's `arrayItemsSelect`
  // definition requires items to be present. Keep items in that case;
  // strip items for all other array editors (Apify infers from `editor`).
  const isArraySelectWithEnum =
    type === 'array' &&
    out.editor === 'select' &&
    typeof out.items === 'object' &&
    out.items !== null &&
    Array.isArray((out.items as Record<string, unknown>).enum);

  if (
    type !== undefined &&
    TYPES_WITH_TOP_LEVEL_ITEMS_STRIPPED.has(type) &&
    !isArraySelectWithEnum
  ) {
    delete out.items;
  }

  // Move `enumTitles` from the top level into `items.enumTitles` so Apify
  // renders human-readable labels in the multi-select picker.
  if (
    isArraySelectWithEnum &&
    Array.isArray(out.enumTitles) &&
    typeof out.items === 'object' &&
    out.items !== null
  ) {
    (out.items as Record<string, unknown>).enumTitles = out.enumTitles;
    delete out.enumTitles;
  }

  // Apify accepts `minItems`/`maxItems` on arrays per the meta-schema, but the
  // existing file uses `editor` to imply uniqueness; keep them through.
  // (No-op — leaving comment as documentation of intent.)

  // Apply default editor per type if none is set.
  if (out.editor === undefined) {
    const fallback = defaultEditor(type, out);
    if (fallback) out.editor = fallback;
  }

  return orderProperty(out);
}

function defaultEditor(
  type: string | undefined,
  prop: Record<string, unknown>,
): string | undefined {
  if (type === 'string') {
    return Array.isArray(prop.enum) ? 'select' : 'textfield';
  }
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'boolean') return 'checkbox';
  if (type === 'array' || type === 'object') return 'json';
  return undefined;
}

function orderProperty(prop: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const key of PROPERTY_KEY_ORDER) {
    if (key in prop) {
      out[key] = prop[key];
      seen.add(key);
    }
  }
  for (const [key, value] of Object.entries(prop)) {
    if (!seen.has(key)) out[key] = value;
  }
  return out;
}

function orderEnvelope({
  title,
  description,
  type,
  schemaVersion,
  properties,
  required,
}: ApifyInputSchemaJSON): ApifyInputSchemaJSON {
  if (description !== undefined) {
    return { title, description, type, schemaVersion, properties, required };
  }
  return { title, type, schemaVersion, properties, required };
}
