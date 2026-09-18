import {
  buildSuccessRecord,
  type ExtractionResult,
  type KvsLike,
  type RouteMap,
  type Sink,
  warnDangerousRoutes,
} from '@markdownee/crawler';
import type { Dataset, KeyValueStore } from 'crawlee';

/**
 * Sink that writes each extracted page to a Crawlee dataset and, per the route
 * map, the key-value store. Record assembly and KVS key derivation live in the
 * shared `@markdownee/crawler` sink core, so the standalone CLI/lib and the
 * Apify Actor produce identical output. Warns once (at construction) when large
 * content is routed to the dataset.
 */
export function createCrawleeStorageSink(opts: {
  routes: RouteMap;
  kvs: KeyValueStore;
  dataset: Dataset;
}): Sink<ExtractionResult> {
  const { routes, kvs, dataset } = opts;
  warnDangerousRoutes(routes);

  // Local Crawlee storage has no meaningful public URL, so expose only
  // `setValue` to the shared builder; KVS content nodes then carry {hash, bytes,
  // key} without a misleading url. The Apify Actor passes its KVS with
  // `getPublicUrl`, so its content nodes additionally carry a public url.
  const kvsLike: KvsLike = {
    setValue: (key, value, options) => kvs.setValue(key, value, options),
  };

  return async (result) => {
    try {
      const data = await buildSuccessRecord(result, { kvs: kvsLike, routes });
      await dataset.pushData(data);
    } catch (err) {
      process.stderr.write(
        `[storage] Warning: storage write failed for ${result.url}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  };
}
