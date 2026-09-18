import {
  buildRouteMap,
  type ExtractionResult,
  extractedFormats,
  type MarkdowneeCrawlerOptions,
  type ProxyConfiguration,
  type RequestProvider,
  type Sink,
  savesOriginal,
} from '@markdownee/crawler';
import type { MarkdowneeInputType } from '@markdownee/schema';

export function buildCrawlerOpts(
  input: MarkdowneeInputType,
  sink: Sink<ExtractionResult>,
  proxyConfiguration?: ProxyConfiguration,
  requestQueue?: RequestProvider,
  proxyRotation?: MarkdowneeInputType['proxyRotation'],
): MarkdowneeCrawlerOptions {
  // Extract only the formats the `save` tokens request (excluding `original`,
  // which is raw HTML). May be empty (e.g. only `original-kvs`) — the engine
  // accepts zero extracted formats and the sink then writes only `original`.
  const routes = buildRouteMap(input.save);
  const formats = extractedFormats(routes);

  return {
    startUrls: [],
    sink,
    formats,
    mode: input.mode,
    imageHandling: input.imageHandling,
    maxImageEdge: input.maxImageEdge,
    rasterizeSvg: input.rasterizeSvg,
    // The save image pipeline also stores pre-normalization bytes when an
    // `original-*` save token is present. The destination store (`imageKvs`)
    // is wired by the caller (run.ts), which owns the opened stores.
    saveOriginalImages: savesOriginal(routes),
    linkHandling: input.linkHandling,
    tableHandling: input.tableHandling,
    commentHandling: input.commentHandling,
    outputLayout: input.outputLayout,
    languageCode: input.languageCode,
    cookieStrategy: input.closeCookieModals ? 'ghostery' : 'none',
    scroll: input.maxScrollHeight > 0 ? { maxScrollHeight: input.maxScrollHeight } : undefined,
    headless: input.headless,
    crawlerType: input.crawlerType,
    renderingTypeDetectionRatio: input.renderingTypeDetectionRatio,
    markdownDiscovery: input.markdownDiscovery,
    ignoreHttpsErrors: input.ignoreHttpsErrors,
    bypassCSP: input.ignoreCorsAndCsp,
    initialCookies: input.initialCookies,
    extraHTTPHeaders: input.customHttpHeaders ?? undefined,
    userAgent: input.userAgent || undefined,
    maxRequestsPerCrawl: input.maxRequestsPerCrawl,
    maxRetries: input.maxRequestRetries,
    initialConcurrency: input.initialConcurrency,
    maxConcurrency: input.maxConcurrency,
    navigationTimeoutSecs: input.navigationTimeoutSecs,
    waitUntil: input.waitUntil,
    maxResults: input.maxResultsPerCrawl > 0 ? input.maxResultsPerCrawl : undefined,
    selector: input.selector,
    maxCrawlDepth: input.maxCrawlDepth,
    globs: input.globs.map((g) => g.glob).filter((g): g is string => Boolean(g)),
    exclude: input.exclude.map((g) => g.glob).filter((g): g is string => Boolean(g)),
    keepUrlFragment: input.keepUrlFragment,
    proxyConfiguration,
    proxyRotation,
    requestQueue,
    blockMedia: input.blockMedia,
    respectRobotsTxt: input.respectRobotsTxtFile,
    waitForDynamicContentSecs: input.waitForDynamicContentSecs,
    waitForSelector: input.waitForSelector || undefined,
    softWaitForSelector: input.softWaitForSelector || undefined,
    deduplication: input.deduplication,
    sessionPoolName: input.sessionPoolName,
    maxSessionRotations: input.maxSessionRotations,
  };
}
