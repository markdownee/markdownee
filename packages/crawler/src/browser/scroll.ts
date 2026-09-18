import type { PlaywrightCrawlingContext } from 'crawlee';

export interface ScrollConfig {
  maxScrollHeight?: number;
  waitForSecs?: number;
}

export async function autoScroll(
  context: PlaywrightCrawlingContext,
  opts?: ScrollConfig,
): Promise<void> {
  await context.infiniteScroll({
    maxScrollHeight: opts?.maxScrollHeight,
    waitForSecs: opts?.waitForSecs ?? 2,
  });
}
