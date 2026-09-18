import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { asSchemaNode } from '../canonical-json-schema.js';
import { OutputViews } from './output-views.js';

type JsonNode = Record<string, unknown>;
type Field = Record<string, unknown>;

/**
 * Transform the `MarkdowneeOutput` Zod discriminated union into an Apify
 * dataset schema. Merges the `oneOf` branches into one flat `fields` map,
 * recurses into nested object `properties` (`metadata`, `crawl`, and the
 * `ContentNode` content fields), and collapses nullable `anyOf:[X,null]` to X.
 * Mirrors the `to-apify-schema.ts` boundary used for the input schema.
 *
 * The `anyOf` collapse is currently unexercised: the output source of truth has
 * no `.nullable()` left, and zod expresses `.optional()` by omission from
 * `required` rather than as `anyOf:[X,null]`, so the generated schema contains
 * zero `anyOf` nodes. It is kept for the day a `.nullable()` returns.
 */
export function toDatasetSchema(
  schema: z.ZodType,
  views = OutputViews,
): { actorSpecification: number; fields: Record<string, Field>; views: Record<string, unknown> } {
  const jsonSchema = z.toJSONSchema(schema, {
    target: 'draft-07',
    unrepresentable: 'any',
    reused: 'inline',
  });

  const merged = mergeBranchProperties(jsonSchema);
  const fields: Record<string, Field> = {};
  for (const [name, node] of Object.entries(merged)) {
    const field = toDatasetField(node);
    if (field) fields[name] = field;
  }

  return { actorSpecification: 1, fields, views: views.views };
}

export function writeDatasetSchema(schema: z.ZodType, outPath: string): void {
  writeFileSync(outPath, `${JSON.stringify(toDatasetSchema(schema), null, 2)}\n`, 'utf8');
}

/**
 * Narrow every member of a JSON-Schema `schemaArray` position (`oneOf`, `anyOf`,
 * `allOf`), dropping the boolean members draft-07 permits there. `Array.isArray`
 * proves array, not array-of-object, so it cannot stand in for this.
 */
function schemaNodesIn(nodes: readonly unknown[]): JsonNode[] {
  const out: JsonNode[] = [];
  for (const node of nodes) {
    const narrowed = asSchemaNode(node);
    if (narrowed) out.push(narrowed);
  }
  return out;
}

/**
 * Merge every discriminated-union branch's properties into one flat map.
 *
 * Each `oneOf` member and each `properties` member is narrowed on the way in; a
 * non-object node is skipped exactly as if it were absent.
 */
function mergeBranchProperties(jsonSchema: unknown): Record<string, JsonNode> {
  const root = asSchemaNode(jsonSchema);
  if (!root) return {};
  const branches: JsonNode[] = Array.isArray(root.oneOf) ? schemaNodesIn(root.oneOf) : [root];
  const out: Record<string, JsonNode> = {};
  for (const branch of branches) {
    const props = asSchemaNode(branch.properties) ?? {};
    for (const [name, raw] of Object.entries(props)) {
      const node = asSchemaNode(raw);
      if (!node) continue;
      const existing = out[name];
      out[name] = existing ? mergeNode(existing, node) : node;
    }
  }
  return out;
}

/**
 * Merge a field that appears in multiple branches. The only real cross-branch
 * conflict in this schema is the `status` discriminator: each branch emits a
 * distinct `const`, which we accumulate into a single `enum`. Accumulating
 * (rather than pairwise-collapsing) is required so all three `status` values
 * survive a 3-branch merge.
 *
 * Any other field shared across branches (e.g. `url`, and the `crawl` object,
 * which carries a different property set in `success` than in `failed`) keeps
 * the first branch's node. That is safe because `toDatasetField` normalizes
 * leaf types downstream, so the emitted dataset field type is the same whichever
 * branch wins.
 */
function mergeNode(a: JsonNode, b: JsonNode): JsonNode {
  const av = Array.isArray(a.enum) ? a.enum : a.const !== undefined ? [a.const] : null;
  const bv = Array.isArray(b.enum) ? b.enum : b.const !== undefined ? [b.const] : null;
  if (av && bv) {
    return {
      type: 'string',
      enum: [...new Set([...av, ...bv])],
      description: a.description ?? b.description,
    };
  }
  return a;
}

/**
 * Convert one JSON-Schema node into an Apify dataset field descriptor.
 * Recurses into object `properties` (e.g. `metadata`, `crawl`, and the
 * `ContentNode` content fields) and collapses nullable `anyOf:[X,null]` to X
 * (unexercised today — see {@link toDatasetSchema}).
 * Leaf types: string, integer, number, boolean, array, object, null.
 */
function toDatasetField(raw: unknown): Field | null {
  const prop = asSchemaNode(raw);
  if (!prop) return null;
  const description = typeof prop.description === 'string' ? prop.description : undefined;

  if (Array.isArray(prop.anyOf)) {
    const branches = schemaNodesIn(prop.anyOf);
    const objectBranch = branches.find((b) => b.type === 'object' && b.properties);
    const chosen = objectBranch ?? branches.find((b) => b.type && b.type !== 'null');
    const field = toDatasetField({ ...chosen }) ?? { type: 'object' };
    delete field.description;
    if (description) field.description = description;
    return field;
  }

  const field: Field = {};
  const t = prop.type;
  if (t === 'string') field.type = 'string';
  else if (t === 'integer') field.type = 'integer';
  else if (t === 'number') field.type = 'number';
  else if (t === 'boolean') field.type = 'boolean';
  else if (t === 'array') field.type = 'array';
  else if (t === 'null') field.type = 'null';
  else field.type = 'object';

  const nestedSource = field.type === 'object' ? asSchemaNode(prop.properties) : undefined;
  if (nestedSource) {
    const nested: Record<string, Field> = {};
    for (const [k, v] of Object.entries(nestedSource)) {
      const sub = toDatasetField(v);
      if (sub) nested[k] = sub;
    }
    if (Object.keys(nested).length > 0) field.properties = nested;
  }

  if (Array.isArray(prop.enum)) field.enum = prop.enum;
  if (prop.title) field.title = prop.title;
  if (description) field.description = description;
  return field;
}
