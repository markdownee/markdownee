import { CrawlerType, createCrawler, Deduplication, fetch, Save, SaveFormat } from 'markdownee';
import { Configuration, KeyValueStore } from 'markdownee/storage';

// fetch(url, options) crawls exactly one URL (no link-following) and
// returns the content directly — nothing is persisted. `formats` defaults to
// ['markdown'], so this resolves to { markdown: '…' }.
const single = await fetch('https://example.com', { crawlerType: CrawlerType.Cheerio });
console.log('fetch default markdown length:', single.markdown?.length);

// Request several formats at once: the returned map is keyed by the requested
// formats. 'original' carries the raw page HTML (fetch has no includeHtml).
const multi = await fetch('https://example.com', {
  crawlerType: CrawlerType.Cheerio,
  formats: [SaveFormat.Markdown, SaveFormat.Original],
});
console.log('fetch multi-format keys:', Object.keys(multi));
console.log('original HTML length:', multi.original?.length);

// Construct an extractor from a camelCase options object (field names match the
// input schema), then run(urls) and consume the in-memory result handle.
const extractor = createCrawler({
  crawlerType: CrawlerType.Cheerio, // browserless — runs without a Playwright install
  // `save` is a SaveRoute[] of `format-destination` tokens: markdown to BOTH the
  // dataset and the key-value store, and the raw HTML to the KVS only. The set of
  // extracted formats is derived from the tokens (here: markdown).
  save: [Save.MarkdownDataset, Save.MarkdownKvs, Save.OriginalKvs],
  includeHtml: false, // default: raw HTML is excluded from returned records
  deduplication: Deduplication.Minimal,
  maxResultsPerCrawl: 10, // bounds the in-memory result set
});

const { dataset, statistics, failures } = await extractor.run(['https://example.com']);

// Partial page failures resolve with results. Invalid inputs and run errors throw.
console.log(
  'Failed URLs:',
  failures.map((failure) => failure.url),
);
console.log(
  `finished=${statistics.requestsFinished} failed=${statistics.requestsFailed} total=${statistics.requestsTotal}`,
);
console.log(`Extracted ${dataset.count} item(s)`);

// Visit the collected in-memory records sequentially.
await dataset.forEach((item, i) => {
  console.log(
    i,
    'url:',
    item.url,
    'depth:',
    item.crawl?.depth,
    'referrer:',
    item.crawl?.referrerUrl,
  );
});

// Or grab the whole array (raw HTML excluded by default — only metadata + formats).
const records = dataset.export();
const first = records[0];
if (first) {
  console.log('first record formats:', Object.keys(first.formats));
  console.log('html included?', first.html !== undefined);
}

// Export to an explicitly selected store, independent of other calls.
const store = await KeyValueStore.open('default', {
  config: new Configuration({
    storageClientOptions: { localDataDirectory: './results', persistStorage: true },
    purgeOnStart: false,
  }),
});
await dataset.exportToJSON('results.json', store);
await dataset.exportToCSV('results.csv', store);
console.log('Wrote results.json and results.csv under ./results.');
