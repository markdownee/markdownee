import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Resolves the Crawlee storage directory using five-level precedence:
 * 1. CLI --storage flag value (the library's `storageDir` option)
 * 2. MARKDOWNEE_STORAGE_DIR env var
 * 3. CRAWLEE_STORAGE_DIR env var
 * 4. ./storage if .actor/ or ./storage/ exists in cwd (Apify/Crawlee compat)
 * 5. ${XDG_DATA_HOME:-~/.local/share}/markdownee/storage (XDG fallback)
 */
export function resolveStorageDir(flagValue?: string): string {
  if (flagValue) return path.resolve(flagValue);

  if (process.env.MARKDOWNEE_STORAGE_DIR) {
    return path.resolve(process.env.MARKDOWNEE_STORAGE_DIR);
  }

  if (process.env.CRAWLEE_STORAGE_DIR) {
    return path.resolve(process.env.CRAWLEE_STORAGE_DIR);
  }

  const cwd = process.cwd();
  if (existsSync(path.join(cwd, '.actor')) || existsSync(path.join(cwd, 'storage'))) {
    return path.resolve(path.join(cwd, 'storage'));
  }

  const xdgDataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
  return path.join(xdgDataHome, 'markdownee', 'storage');
}
