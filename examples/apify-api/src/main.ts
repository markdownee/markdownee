import { ApifyClient } from 'apify-client';

// Load token from environment — never hardcode secrets
const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) {
  throw new Error('APIFY_TOKEN environment variable is required');
}

const client = new ApifyClient({ token: APIFY_TOKEN });

// Start the test actor and wait for it to finish
const run = await client.actor('markdownee/crawler-test').call({
  startUrls: [{ url: 'https://example.com' }],
  // `save` tokens bind each format to a destination (`-dataset` inlines it in the
  // record; `-kvs` stores a blob in the key-value store). Here txt goes to the
  // dataset, markdown to BOTH (inline + blob), and the raw HTML to the KVS only.
  save: ['txt-dataset', 'markdown-dataset', 'markdown-kvs', 'original-kvs'],
  initialConcurrency: 3,
  blockMedia: true,
  useSitemaps: true,
  storeSkippedUrls: true,
  waitForDynamicContentSecs: 5,
  waitForSelector: 'article',
  deduplication: 'minimal',
});

console.log('Run finished:', run.status);

// Retrieve dataset results
const { items } = await client.dataset(run.defaultDatasetId).listItems();
console.log(`Got ${items.length} item(s)`);
for (const item of items) {
  const crawl = item.crawl as { depth: number; referrerUrl: string | null } | undefined;
  console.log(
    'url:',
    item.url,
    'status:',
    item.status,
    'depth:',
    crawl?.depth,
    'referrer:',
    crawl?.referrerUrl,
  );
}
