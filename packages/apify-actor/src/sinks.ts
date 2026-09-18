import {
  buildSuccessRecord,
  type ExtractionResult,
  type KvsLike,
  type RouteMap,
  type Sink,
  warnDangerousRoutes,
} from '@markdownee/crawler';
import type { Dataset } from 'apify';

interface ApifySinkOpts {
  kvs: KvsLike;
  dataset: Dataset;
  /** Per-format destination map parsed from the `save` token array. */
  routes: RouteMap;
}

/**
 * Sink that writes each extracted page to the Apify dataset and, per the route
 * map, the key-value store. Record assembly and KVS key derivation live in the
 * shared `@markdownee/crawler` sink core so the Actor and the standalone
 * CLI/lib produce identical output. Warns once (at construction) when large
 * content is routed to the dataset.
 */
export function createApifySink(opts: ApifySinkOpts): Sink<ExtractionResult> {
  const { kvs, dataset, routes } = opts;
  warnDangerousRoutes(routes);

  return async (result: ExtractionResult): Promise<void> => {
    const data = await buildSuccessRecord(result, { kvs, routes });
    await dataset.pushData(data);
  };
}
