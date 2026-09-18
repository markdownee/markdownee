import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { KvsLike } from '@markdownee/crawler';

const SAFE_IMAGE_KEY = /^[a-zA-Z0-9!\-_.()']{1,256}$/;

function validateKey(key: string): void {
  if (key === '.' || key === '..' || !SAFE_IMAGE_KEY.test(key) || path.basename(key) !== key) {
    throw new Error(`Unsafe image artifact key: ${JSON.stringify(key)}`);
  }
}

/** A direct file-output image sink that buffers until extraction succeeds. */
export class FilesystemImageSink implements KvsLike {
  private readonly entries = new Map<string, string | Buffer>();

  constructor(readonly directoryPath: string) {}

  async setValue(
    key: string,
    value: string | Buffer,
    _options?: { contentType?: string },
  ): Promise<void> {
    validateKey(key);
    this.entries.set(key, value);
  }

  getPublicUrl(key: string): string {
    validateKey(key);
    return path.posix.join(path.basename(this.directoryPath), key);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Materialize buffered bytes only after the page extraction has succeeded. */
  async commit(): Promise<void> {
    if (this.entries.size === 0) return;
    await mkdir(this.directoryPath, { recursive: true });
    for (const [key, value] of this.entries) {
      await writeFile(path.join(this.directoryPath, key), value);
    }
  }
}
