import { rm } from 'node:fs/promises';
import path from 'node:path';
import { resolveStorageDir } from './storage/index.js';

export interface PurgeOpts {
  storageDir?: string;
}

export interface PurgeResult {
  storageDir: string;
}

/**
 * The Crawlee storage bucket directories a run writes. A purge wipes all three —
 * not a hardcoded `default` bucket — because with the file-per-record
 * MemoryStorage layout everything a run produces lives under these dirs.
 */
const STORAGE_BUCKETS = ['datasets', 'key_value_stores', 'request_queues'] as const;

/**
 * Wipe the three Crawlee storage bucket directories under an ALREADY-RESOLVED
 * `storageDir`. Internal building block — callers that have already resolved the
 * directory (e.g. the `crawl --purge` hot path) use this to avoid resolving
 * twice; {@link runPurgeAction} is the public resolve-then-wipe entry point.
 */
export async function purgeStorageBuckets(storageDir: string): Promise<void> {
  await Promise.all(
    STORAGE_BUCKETS.map((bucket) =>
      rm(path.join(storageDir, bucket), { recursive: true, force: true }),
    ),
  );
}

/**
 * Purge the Crawlee storage at the resolved `storageDir`: remove the
 * `datasets`, `key_value_stores`, and `request_queues` directories. Resolves the
 * directory with the same precedence as every other action via
 * {@link resolveStorageDir}, and returns the resolved path so the caller can
 * report it.
 *
 * Library-callable: never calls `process.exit` — the thin CLI wrapper owns exit
 * codes and the human-readable summary.
 */
export async function runPurgeAction(opts: PurgeOpts = {}): Promise<PurgeResult> {
  const storageDir = resolveStorageDir(opts.storageDir);
  await purgeStorageBuckets(storageDir);
  return { storageDir };
}
