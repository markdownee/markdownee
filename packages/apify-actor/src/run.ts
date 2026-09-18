import {
  buildFailedRecord,
  buildRequests,
  buildRouteMap,
  buildSkippedRecord,
  createMarkdowneeCrawler,
  createPendingWrites,
  SitemapRequestList,
} from '@markdownee/crawler';
import { MarkdowneeInput } from '@markdownee/schema';
import type { ProxyConfigurationOptions } from 'apify';
import { Actor, log } from 'apify';
import { buildCrawlerOpts } from './config.js';
import { createApifySink } from './sinks.js';

export async function runActor(): Promise<void> {
  await Actor.init();

  const raw = (await Actor.getInput()) ?? {};
  const parsed = MarkdowneeInput.safeParse(raw);
  if (!parsed.success) {
    // Same rendering the CLI and library use for this schema (standalone
    // cliProgram.ts, library.ts), so one bad input reads identically wherever it
    // is rejected. `.issues` also replaces the deprecated `ZodError.format()`;
    // its documented successor `z.treeifyError()` nests under a `properties`
    // level and would emit `{"errors":{"errors":[],…}}` here, and @apify/log
    // writes this object as one unindented JSON line.
    log.error('Actor input validation failed', {
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    });
    await Actor.exit({ exitCode: 1 });
    process.exit(1);
  }

  const input = parsed.data;

  const startUrls = input.startUrls
    .map((u) => u?.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
  if (startUrls.length === 0) {
    log.info('No URLs provided.');
    await Actor.exit();
    process.exit(0);
  }

  const kvs = input.keyValueStoreName
    ? await Actor.openKeyValueStore(input.keyValueStoreName)
    : await Actor.openKeyValueStore();
  const dataset = await Actor.openDataset(input.datasetName);
  const requestQueue = input.requestQueueName
    ? await Actor.openRequestQueue(input.requestQueueName)
    : undefined;
  let proxyConfig: Awaited<ReturnType<typeof Actor.createProxyConfiguration>> | undefined;
  if (input.proxyConfiguration) {
    // The shared schema keeps this an open record so the Apify-only
    // `useApifyProxy` dialect stays in this package; the cast is a compiler
    // formality, since the SDK `ow`-validates the shape before reading any
    // field. Catching keeps a bad proxy input on the Actor lifecycle instead of
    // an unhandled rejection. The message differs from the schema one above
    // because this call also throws on proxy access and credential failures.
    try {
      proxyConfig = await Actor.createProxyConfiguration(
        input.proxyConfiguration as ProxyConfigurationOptions,
      );
    } catch (error) {
      log.error('Proxy configuration validation failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      await Actor.exit({ exitCode: 1 });
      process.exit(1);
    }
  }

  const sink = createApifySink({
    kvs,
    dataset,
    routes: buildRouteMap(input.save),
  });
  let sitemapList: SitemapRequestList | undefined;
  if (input.useSitemaps) {
    const sitemapUrls = [...new Set(startUrls.map((u) => `${new URL(u).origin}/sitemap.xml`))];
    sitemapList = await SitemapRequestList.open({
      sitemapUrls,
      globs: input.globs.map((g) => g.glob).filter((g): g is string => Boolean(g)),
      exclude: input.exclude.map((g) => g.glob).filter((g): g is string => Boolean(g)),
    });
  }

  // True only when the caller actually supplied `blockMedia` (vs inheriting the
  // schema default of `true`) — gates the "no effect" warning for non-Chromium
  // crawlers. `raw` is an object here (a non-object input fails `safeParse` above).
  const blockMediaExplicit = typeof raw === 'object' && 'blockMedia' in raw;
  const pendingWrites = createPendingWrites();

  const crawler = createMarkdowneeCrawler({
    ...buildCrawlerOpts(input, sink, proxyConfig, requestQueue, input.proxyRotation),
    // Save-mode image bytes go to the same (possibly named) store as the
    // format blobs; the Apify store exposes public URLs, so dataset `images[]`
    // entries and rewritten `img src` carry them.
    imageKvs: kvs,
    blockMediaExplicit,
    ...(sitemapList !== undefined ? { requestList: sitemapList } : {}),
    onFailedRequest: async (info) => {
      await dataset.pushData(buildFailedRecord(info));
    },
    ...(input.storeSkippedUrls
      ? {
          onSkippedUrl: (url, reason) => {
            pendingWrites.add(dataset.pushData(buildSkippedRecord(url, reason)));
          },
        }
      : {}),
  });
  try {
    try {
      await crawler.run(buildRequests(startUrls, input.keepUrlFragment));
    } finally {
      await pendingWrites.drain();
    }
  } catch (error) {
    await Actor.exit({ exitCode: 1 });
    throw error;
  }
  await Actor.exit();
}
