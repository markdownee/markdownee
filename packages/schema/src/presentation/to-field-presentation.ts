import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { apifyRegistry } from '../apify/apify-registry.js';
import { asSchemaNode, TO_JSON_SCHEMA_INPUT } from '../canonical-json-schema.js';
import { cliSurface } from '../cli/cli-surface.js';
import { MarkdowneeInput } from '../source-of-truth/input.js';

/**
 * The presentation artifact — one entry per `MarkdowneeInput` field — that
 * gives an external form UI (the playground) everything it needs to render a
 * field and its help in a SINGLE import: the vanilla JSON Schema metadata
 * (`title`/`description`/`default`/`enumValues`) joined with the Apify UI hints
 * (`enumTitles`/`section`) and the CLI flag(s) for that field.
 *
 * Unlike `library-input`/`cli-input` (canonical, Apify-agnostic, guarded against
 * dialect leakage), this is EXPLICITLY a presentation artifact — like
 * {@link ../apify/output-views.ts OutputViews} — so it MAY carry `enumTitles`
 * and `section` (`sectionCaption`). It is NOT a canonical input schema and is
 * not subject to the no-Apify-dialect guard.
 *
 * Everything is derived: `title`/`description`/`default`/`enumValues` from the
 * canonical projection of the Zod source of truth; `enumTitles`/`section` from
 * `apifyRegistry`; `cliFlags` from `cli-surface` (every flag whose `field`
 * matches, e.g. `["--headless","--no-headless"]`); `apifyKey === field`. Never
 * hand-edit the generated JSON — change the Zod SoT (or registry / cli-surface)
 * and regenerate.
 */
export interface FieldPresentation {
  /** The `MarkdowneeInput` field name (camelCase) — the join key. */
  field: string;
  /** Form label, from `.meta({ title })`. */
  title: string;
  /** Prose help, from `.describe(...)`. */
  description: string;
  /** Default value, when the field has one (omitted for required/optional-no-default fields). */
  default?: unknown;
  /** Allowed values for an enum (or enum-of-array) field. */
  enumValues?: string[];
  /** Human-readable labels paired 1:1 with `enumValues` (from `apifyRegistry`). */
  enumTitles?: string[];
  /** Every CLI flag mapping to this field, in registration order (may be empty). */
  cliFlags: string[];
  /** The Apify Actor input key — equals `field`. */
  apifyKey: string;
  /** The Apify form section this field belongs to (`sectionCaption`), when set. */
  section?: string;
}

export interface FieldPresentationDocument {
  title: string;
  description: string;
  fields: FieldPresentation[];
}

/** Group every CLI flag by the `MarkdowneeInput` field it maps to, in surface order. */
function cliFlagsByField(): Map<string, string[]> {
  const byField = new Map<string, string[]>();
  for (const option of cliSurface) {
    if (option.field === null) continue;
    const flags = byField.get(option.field) ?? [];
    if (!flags.includes(option.flag)) flags.push(option.flag);
    byField.set(option.field, flags);
  }
  return byField;
}

/** Read the enum values off a canonical property (top-level `enum` or `items.enum`). */
function enumValuesOf(prop: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(prop.enum)) return onlyStrings(prop.enum);
  const items = asSchemaNode(prop.items);
  if (items && Array.isArray(items.enum)) return onlyStrings(items.enum);
  return undefined;
}

/** JSON-Schema `enum` members may legally be non-strings; the artifact publishes strings only. */
function onlyStrings(values: readonly unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string');
}

/**
 * Build the field-presentation document for `MarkdowneeInput`. Iterates the
 * Zod shape in declaration order so the artifact's field order tracks the SoT.
 */
export function toFieldPresentation(): FieldPresentationDocument {
  const generated = asSchemaNode(z.toJSONSchema(MarkdowneeInput, TO_JSON_SCHEMA_INPUT)) ?? {};
  const properties = asSchemaNode(generated.properties) ?? {};
  const flagsByField = cliFlagsByField();
  const shape = MarkdowneeInput.shape as Record<string, z.ZodType>;

  const fields: FieldPresentation[] = [];
  for (const [field, fieldSchema] of Object.entries(shape)) {
    // Narrowed once here, so `prop.title`, `'default' in prop` and
    // `enumValuesOf(prop)` below need no guard of their own.
    const prop = asSchemaNode(properties[field]) ?? {};
    const hints = apifyRegistry.get(fieldSchema);

    const entry: FieldPresentation = {
      field,
      title: typeof prop.title === 'string' ? prop.title : field,
      description: typeof prop.description === 'string' ? prop.description : '',
      cliFlags: flagsByField.get(field) ?? [],
      apifyKey: field,
    };
    if ('default' in prop) entry.default = prop.default;
    const enumValues = enumValuesOf(prop);
    if (enumValues) entry.enumValues = enumValues;
    if (hints?.enumTitles) entry.enumTitles = hints.enumTitles;
    if (hints?.sectionCaption) entry.section = hints.sectionCaption;

    fields.push(orderEntry(entry));
  }

  return {
    title: 'Markdownee field presentation',
    description:
      'Generated per-field presentation metadata (title, description, default, enum values + labels, CLI flags, Apify key, section) for the markdownee input surface. Derived from the Zod source of truth, apifyRegistry, and cli-surface; do not edit by hand.',
    fields,
  };
}

/** Stable per-entry key order (mirrors the {@link FieldPresentation} field order). */
function orderEntry(entry: FieldPresentation): FieldPresentation {
  return {
    field: entry.field,
    title: entry.title,
    description: entry.description,
    ...('default' in entry ? { default: entry.default } : {}),
    ...(entry.enumValues ? { enumValues: entry.enumValues } : {}),
    ...(entry.enumTitles ? { enumTitles: entry.enumTitles } : {}),
    cliFlags: entry.cliFlags,
    apifyKey: entry.apifyKey,
    ...(entry.section ? { section: entry.section } : {}),
  };
}

export function writeFieldPresentation(outPath: string): void {
  writeFileSync(outPath, `${JSON.stringify(toFieldPresentation(), null, 2)}\n`, 'utf8');
}
