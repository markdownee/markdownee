import type { createMarkdowneeCrawler } from '@markdownee/crawler';
import type { FinalStatistics, RequestsLike } from 'crawlee';

/** Run a privately owned crawler, including cleanup when startup fails. */
export async function runCrawler(
  crawler: ReturnType<typeof createMarkdowneeCrawler>,
  requests: RequestsLike,
): Promise<FinalStatistics> {
  try {
    return await crawler.run(requests);
  } catch (error) {
    // Crawlee 3.18 initializes resources before run() reaches its finally block.
    // teardown() assumes the session pool exists, which a failed startup cannot guarantee.
    const cleanup = [
      () => crawler.stats.stopCapturing(),
      () => ('browserPool' in crawler ? crawler.browserPool.destroy() : undefined),
      () => crawler.sessionPool?.teardown(),
      () => crawler.config.getEventManager().close(),
      () => crawler.autoscaledPool?.abort(),
    ];
    const errors: unknown[] = [error];
    for (const release of cleanup) {
      try {
        await release();
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Crawler failed and resource cleanup also failed.', {
        cause: error,
      });
    }
    throw error;
  }
}
