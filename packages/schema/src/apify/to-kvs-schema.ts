import { writeFileSync } from 'node:fs';
import { KvsCollections } from './output-views.js';

/**
 * Build the Apify key-value-store schema from `KvsCollections`. Each content
 * format is grouped into its own collection by `keyPrefix`, matching the
 * deterministic `{format}-{md5(url)}.{ext}` keys the crawler sink writes.
 */
export function toKeyValueStoreSchema(collections = KvsCollections): {
  actorKeyValueStoreSchemaVersion: number;
  title: string;
  collections: Record<string, unknown>;
} {
  return {
    actorKeyValueStoreSchemaVersion: 1,
    title: collections.title,
    collections: collections.collections,
  };
}

export function writeKeyValueStoreSchema(outPath: string): void {
  writeFileSync(outPath, `${JSON.stringify(toKeyValueStoreSchema(), null, 2)}\n`, 'utf8');
}
