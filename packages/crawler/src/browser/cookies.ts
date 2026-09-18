import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import type { Page } from 'playwright';

// Ghostery network/cosmetic ad/tracker blocking. Consent-wall handling lives in
// ./consent.ts — this module is only the adblocker defences.
const FILTER_LISTS = [
  'https://easylist-downloads.adblockplus.org/easylist.txt',
  'https://easylist-downloads.adblockplus.org/easyprivacy.txt',
  'https://secure.fanboy.co.nz/fanboy-annoyance.txt',
  'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
];

let blockerPromise: Promise<PlaywrightBlocker> | undefined;

export async function getBlocker(
  cachePath = join(tmpdir(), '.cache', 'adblock-engine.bin'),
): Promise<PlaywrightBlocker> {
  blockerPromise ??= mkdir(dirname(cachePath), { recursive: true }).then(() =>
    PlaywrightBlocker.fromLists(globalThis.fetch, FILTER_LISTS, undefined, {
      path: cachePath,
      read: readFile,
      write: writeFile,
    }),
  );

  return blockerPromise;
}

export async function installCookieDefences(page: Page): Promise<void> {
  const blocker = await getBlocker();
  await blocker.enableBlockingInPage(page);
}
