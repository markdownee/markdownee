import { z } from 'zod';
import { apifyRegistry } from '../apify/apify-registry.js';
import {
  CommentHandling,
  CrawlerType,
  Deduplication,
  ImageHandling,
  LinkHandling,
  MarkdownDiscovery,
  Mode,
  OutputLayout,
  ProxyRotation,
  Save,
  TableHandling,
  WaitUntil,
} from './enum-aliases.js';

const initialCookiesDescription = [
  'Cookies that will be pre-set to all pages the scraper opens. This is useful for pages that require login. The value is expected to be a JSON array of objects with `name` and `value` properties. For example: ',
  '',
  '```json',
  '[',
  '  {',
  '    "name": "cookieName",',
  '    "value": "cookieValue",',
  '    "path": "/",',
  '    "domain": ".example.com"',
  '  }',
  ']',
  '```',
  '',
  'You can use the [EditThisCookie](https://docs.apify.com/academy/tools/edit-this-cookie) browser extension to copy browser cookies in this format, and paste it here.',
  '',
  'Note that the value is secret and encrypted to protect your login cookies.',
].join('\n');

/**
 * The `save` vocabulary: the cross-product of the five output formats and the
 * two destinations, as `format-destination` kebab-case tokens (destination
 * shorthand `kvs` = key-value store). This is the single source of truth for the
 * Zod enum, the generated Apify schema, and the npm library's `SaveRoute` type.
 * Order is fixed and MUST stay in lockstep with the `enumTitles` below.
 */
export const SAVE_ROUTE_TOKENS = [
  Save.TxtDataset,
  Save.TxtKvs,
  Save.MarkdownDataset,
  Save.MarkdownKvs,
  Save.HtmlDataset,
  Save.HtmlKvs,
  Save.MinifiedHtmlDataset,
  Save.MinifiedHtmlKvs,
  Save.OriginalDataset,
  Save.OriginalKvs,
] as const;

/** A single `save` token binding one output format to one destination. */
export type SaveRoute = (typeof SAVE_ROUTE_TOKENS)[number];

export const MarkdowneeInput = z
  .object({
    startUrls: z
      .array(z.object({ url: z.string() }).loose())
      .min(1)
      .describe('URLs to extract content from')
      .meta({ title: 'Start URLs' })
      .register(apifyRegistry, {
        editor: 'requestListSources',
        prefill: [{ url: 'https://blog.apify.com/what-is-web-scraping/' }],
      }),

    crawlerType: z
      .enum(CrawlerType)
      .default(CrawlerType.PlaywrightAdaptive)
      .describe(
        'Select how pages are fetched. playwright-adaptive uses browser rendering by default; a positive renderingTypeDetectionRatio enables detection for HTTP-only fetching. Choose an explicit Playwright browser or cheerio for HTTP requests without JavaScript execution.',
      )
      .meta({ title: 'Crawler type' })
      .register(apifyRegistry, {
        sectionCaption: 'Crawler settings',
        editor: 'select',
        enumTitles: [
          'Adaptive switching (Recommended)',
          'Headless browser (Firefox+Playwright)',
          'Headless browser (Chromium+Playwright)',
          'Raw HTTP client (Cheerio)',
        ],
      }),

    renderingTypeDetectionRatio: z
      .number()
      .min(0)
      .max(1)
      .default(0)
      .describe(
        'For the adaptive crawler, set the fraction of pages sampled to determine whether browser rendering is needed (0–1). The default 0 disables detection and uses the browser. With detection enabled, an HTTP fetch may miss content populated by JavaScript.',
      )
      .meta({ title: 'Rendering type detection' }),

    markdownDiscovery: z
      .enum(MarkdownDiscovery)
      .default(MarkdownDiscovery.Off)
      .describe(
        'Choose how to find a Markdown representation published by the origin. An accepted ' +
          'representation supplies content for all requested formats. off (default) leaves HTML ' +
          'fetching unchanged. alternate follows same-origin Markdown links advertised in a ' +
          '<link rel="alternate" type="text/markdown"> element or Link response header. ' +
          'negotiate also requests text/markdown through Accept, with a refetch when needed. ' +
          'probe additionally tries a .md sibling URL. Discovery can attempt three alternates, ' +
          'one negotiated refetch, and one sibling; robots.txt checks can add a request per origin. ' +
          'Per-origin budgets limit unsuccessful attempts. Available steps depend on the crawler ' +
          'path. Rejected or unavailable representations fall back to HTML extraction.',
      )
      .meta({ title: 'Markdown discovery' })
      .register(apifyRegistry, {
        editor: 'select',
        enumTitles: [
          'Off — use HTML extraction',
          'Follow advertised Markdown links',
          'Also request Markdown with Accept',
          'Also try a .md sibling',
        ],
      }),

    globs: z
      .array(z.object({ glob: z.string() }).loose())
      .default([])
      .describe(
        'Glob patterns matching URLs of pages that will be included in crawling. Setting this option allows you to customize the crawling scope. For example `https://{store,docs}.example.com/**` lets the crawler access all URLs starting with `https://store.example.com/` or `https://docs.example.com/`.',
      )
      .meta({ title: 'Include URLs (globs)' })
      .register(apifyRegistry, { editor: 'globs' }),

    exclude: z
      .array(z.object({ glob: z.string() }).loose())
      .default([])
      .describe(
        'Glob patterns matching URLs of pages that will be excluded from crawling. Note that this affects only links found on pages, but not Start URLs, which are always crawled.',
      )
      .meta({ title: 'Exclude URLs (globs)' })
      .register(apifyRegistry, { editor: 'globs' }),

    selector: z
      .string()
      .default('')
      .describe('CSS selector for links to enqueue. Leave empty to disable link enqueueing.')
      .meta({ title: 'Link Selector' })
      .register(apifyRegistry, { editor: 'textfield' }),

    keepUrlFragment: z
      .boolean()
      .default(false)
      .describe(
        'URL fragments (the parts of URL after a #) are not considered when the scraper determines whether a URL has already been visited. Turn this on to treat URLs with different fragments as different pages.',
      )
      .meta({ title: 'Keep URL fragment' }),

    useSitemaps: z
      .boolean()
      .default(false)
      .describe(
        'If enabled, the crawler looks for sitemap.xml at the root of each start URL domain and enqueues matching URLs from it in addition to link-following.',
      )
      .meta({ title: 'Use sitemaps' }),

    deduplication: z
      .enum(Deduplication)
      .default(Deduplication.Standard)
      .describe(
        "Deduplication level applied on top of Crawlee's built-in URL deduplication. " +
          'standard (default): skip pages whose <link rel="canonical"> was already extracted, across all handler types. ' +
          'aggressive: also skip pages whose extracted text content matches a previously extracted page. ' +
          "minimal: disable additional deduplication — only Crawlee's built-in URL dedup remains active.",
      )
      .meta({ title: 'Deduplication' })
      .register(apifyRegistry, {
        editor: 'select',
        enumTitles: [
          'Minimal — Crawlee URL dedup only',
          'Standard — + canonical URL',
          'Aggressive — + content hash',
        ],
      }),

    respectRobotsTxtFile: z
      .boolean()
      .default(false)
      .describe(
        'If enabled, the crawler will consult the robots.txt file for each domain before crawling pages.',
      )
      .meta({ title: 'Respect robots.txt' }),

    initialCookies: z
      .array(z.unknown())
      .optional()
      .describe(initialCookiesDescription)
      .meta({ title: 'Initial cookies' })
      .register(apifyRegistry, { editor: 'json', prefill: [], isSecret: true }),

    customHttpHeaders: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'HTTP headers that will be added to all requests made by the crawler. This is useful for setting custom authentication headers or other headers required by the target website. The value is expected to be a JSON object with header names as keys and header values as values. For example: `{ "Authorization": "Bearer token123", "X-Custom-Header": "value" }`.',
      )
      .meta({ title: 'Custom HTTP headers' })
      .register(apifyRegistry, { editor: 'json', prefill: {} }),

    maxRequestsPerCrawl: z
      .int()
      .min(0)
      .default(0)
      .describe(
        'Maximum number of requests the crawler will handle. Counts handled page outcomes (successes and final failures), including start URLs and pagination pages. The crawler automatically finishes after reaching this number. 0 means unlimited.',
      )
      .meta({ title: 'Max requests per crawl' }),

    maxResultsPerCrawl: z
      .int()
      .min(0)
      .default(0)
      .describe(
        'Maximum number of results that will be saved to dataset. The scraper will terminate after reaching this number. 0 means unlimited.',
      )
      .meta({ title: 'Max results' })
      .register(apifyRegistry, { unit: 'results' }),

    maxCrawlDepth: z
      .int()
      .min(0)
      .default(0)
      .describe(
        'Maximum link depth from Start URLs. Pages discovered further from start URLs than this limit will not be crawled. 0 means unlimited.',
      )
      .meta({ title: 'Max crawling depth' }),

    initialConcurrency: z
      .int()
      .min(0)
      .default(0)
      .describe(
        'Initial number of browser pages or HTTP clients running in parallel. Crawlee auto-scales up to maxConcurrency. 0 lets Crawlee pick the default.',
      )
      .meta({ title: 'Initial concurrency' }),

    maxConcurrency: z
      .int()
      .min(1)
      .default(3)
      .describe(
        'Maximum number of browser pages running in parallel. Kept low by default because the browser crawler cannot abort in-flight pages, so concurrency is the only hard cap on peak memory — large pages can exhaust memory at higher values. Raise it for lightweight pages or the HTTP (cheerio) crawler. This setting also avoids overloading target websites and getting blocked.',
      )
      .meta({ title: 'Max concurrency' }),

    maxRequestRetries: z
      .int()
      .min(0)
      .default(3)
      .describe(
        'Maximum number of retries for failed requests on network, proxy, or server errors.',
      )
      .meta({ title: 'Max request retries' }),

    mode: z
      .enum(Mode)
      .default(Mode.Balanced)
      .describe(
        'Choose the content-selection policy. precision favors less boilerplate at the risk of omitted content; recall retains more content and may include clutter. balanced is the default. keep cleans the whole document without main-content selection.',
      )
      .meta({ title: 'Extraction mode' })
      .register(apifyRegistry, {
        editor: 'select',
        sectionCaption: 'Content extraction',
        enumTitles: [
          'Precision (less noise)',
          'Balanced',
          'Recall (more content)',
          'Keep boilerplate (clean HTML only)',
        ],
      }),

    imageHandling: z
      .enum(ImageHandling)
      .default(ImageHandling.Exclude)
      .describe(
        'What becomes of images in the extracted content. exclude (default) removes image ' +
          'structures entirely, including their captions. alt-text replaces each image with its ' +
          'textual stand-in (alt text, falling back to figcaption, aria-label, or title) — no URL, ' +
          'no bytes. resolved-url keeps each image as one clean tag whose src is the resolved ' +
          'absolute image URL (lazy-load and srcset variants collapsed); nothing is downloaded. ' +
          'The save MODE additionally downloads the image bytes, re-encodes them, and stores them ' +
          'in the key-value store, referencing them from the results — not to be confused with ' +
          'the save TOKENS option, which routes output formats to destinations.',
      )
      .meta({ title: 'Image handling' })
      .register(apifyRegistry, {
        editor: 'select',
        enumTitles: [
          'Exclude images',
          'Replace with alt text',
          'Keep with resolved URLs',
          'Save to key-value store',
        ],
      }),

    maxImageEdge: z
      .int()
      .min(0)
      .default(1568)
      .describe(
        'Long-edge pixel cap for images stored by the save image-handling mode: larger images ' +
          'are downscaled so their longer side is at most this many pixels (never upscaled). ' +
          '0 disables the cap. Ignored unless imageHandling is save.',
      )
      .meta({ title: 'Max image edge' }),

    rasterizeSvg: z
      .boolean()
      .default(true)
      .describe(
        'For SVG images stored by the save image-handling mode: store a rasterized PNG instead ' +
          'of the sanitized SVG source (vision models accept no SVG). Disable to store the ' +
          'sanitized SVG source. Ignored unless imageHandling is save.',
      )
      .meta({ title: 'Rasterize SVG' }),

    linkHandling: z
      .enum(LinkHandling)
      .default(LinkHandling.Include)
      .describe(
        'What becomes of hyperlinks in the extracted content. include (default) renders links ' +
          'inline. exclude unwraps each link — the anchor text survives, the URL is dropped.',
      )
      .meta({ title: 'Link handling' })
      .register(apifyRegistry, {
        editor: 'select',
        enumTitles: ['Include hyperlinks', 'Exclude links (keep anchor text)'],
      }),

    tableHandling: z
      .enum(TableHandling)
      .default(TableHandling.Include)
      .describe(
        'What becomes of tables in the extracted content. include (default) renders tables. ' +
          'exclude discards each table subtree entirely, including its cell text.',
      )
      .meta({ title: 'Table handling' })
      .register(apifyRegistry, {
        editor: 'select',
        enumTitles: ['Include tables', 'Exclude tables (drop subtree incl. text)'],
      }),

    commentHandling: z
      .enum(CommentHandling)
      .default(CommentHandling.Include)
      .describe(
        'What becomes of user-comment sections (forum or blog comments — NOT <!-- --> HTML ' +
          'markup) in the extracted content. include keeps detected comment containers; ' +
          'exclude removes them before output serialization.',
      )
      .meta({ title: 'Comment handling' })
      .register(apifyRegistry, {
        editor: 'select',
        enumTitles: ['Include comment sections', 'Exclude comment sections'],
      }),

    languageCode: z
      .string()
      .default('')
      .describe(
        'Filter extracted content by language code (e.g. "en"). Leave empty to accept any language.',
      )
      .meta({ title: 'Language' })
      .register(apifyRegistry, { editor: 'textfield' }),

    outputLayout: z
      .enum(OutputLayout)
      .default(OutputLayout.Minimal)
      .describe(
        'Choose the structure surrounding generated content: minimal provides TXT/Markdown bodies ' +
          'and HTML fragments; standard adds ordinary metadata, front matter, and complete HTML ' +
          'documents; enhanced includes additional allowlisted metadata and crawl information. ' +
          'Readable HTML and Minified HTML use the same layout.',
      )
      .meta({ title: 'Output layout' })
      .register(apifyRegistry, {
        editor: 'select',
        enumTitles: ['Minimal', 'Standard', 'Enhanced'],
      }),

    save: z
      .array(z.enum(SAVE_ROUTE_TOKENS))
      .min(1, 'Select at least one save route')
      .default([Save.MarkdownKvs])
      .describe(
        'What to save and where, as `format-destination` tokens. Format is one of ' +
          '`txt`, `markdown`, `html`, `minified-html`, `original` (raw page HTML before extraction); ' +
          'destination is `dataset` (inline in the dataset record) or `kvs` (a blob in the ' +
          'key-value store). List a format twice to save it to both, e.g. ' +
          '`markdown-dataset markdown-kvs`. Saving generated or original HTML (large content) to the ' +
          'dataset is not recommended — it risks out-of-memory on large pages; prefer `kvs`.',
      )
      .meta({ title: 'Save' })
      .register(apifyRegistry, {
        editor: 'select',
        sectionCaption: 'Output settings',
        enumTitles: [
          'Plain text → Dataset',
          'Plain text → Key-value store',
          'Markdown → Dataset',
          'Markdown → Key-value store',
          'HTML → Dataset (large; OOM risk)',
          'HTML → Key-value store',
          'Minified HTML → Dataset (large; OOM risk)',
          'Minified HTML → Key-value store',
          'Original HTML → Dataset (large; OOM risk)',
          'Original HTML → Key-value store',
        ],
      }),

    datasetName: z
      .string()
      .optional()
      .describe(
        'Name or ID of the dataset for storing results. Leave empty to use the default run dataset.',
      )
      .meta({ title: 'Dataset name' })
      .register(apifyRegistry, { editor: 'textfield' }),

    keyValueStoreName: z
      .string()
      .optional()
      .describe(
        'Name or ID of the key-value store for content files. Leave empty to use the default store.',
      )
      .meta({ title: 'Key-value store name' })
      .register(apifyRegistry, { editor: 'textfield' }),

    requestQueueName: z
      .string()
      .optional()
      .describe('Name of the request queue for pending URLs. Leave empty to use the default queue.')
      .meta({ title: 'Request queue name' })
      .register(apifyRegistry, { editor: 'textfield' }),

    storeSkippedUrls: z
      .boolean()
      .default(false)
      .describe(
        'If enabled, pushes a dataset record for each URL skipped during crawling (excluded by globs, robots.txt, depth limit, or concurrency cap). Can produce high record volume — enable for auditing only.',
      )
      .meta({ title: 'Store skipped URLs' }),

    proxyConfiguration: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Enables loading websites from IP addresses in specific geographies and to circumvent blocking.',
      )
      .meta({ title: 'Proxy configuration' })
      .register(apifyRegistry, { editor: 'proxy', sectionCaption: 'Proxy' }),

    proxyRotation: z
      .enum(ProxyRotation)
      .default(ProxyRotation.Recommended)
      .describe(
        'Proxy rotation strategy. recommended automatically picks the best proxies. per-request uses a new proxy for each request. until-failure uses one proxy until it fails.',
      )
      .meta({ title: 'Proxy rotation' })
      .register(apifyRegistry, {
        editor: 'select',
        enumTitles: ['Recommended', 'Rotate per request', 'Use until failure'],
      }),

    sessionPoolName: z
      .string()
      .min(3)
      .max(200)
      .regex(/^[0-9A-Za-z_-]+$/)
      .optional()
      .describe(
        'Name for a persistent, shared session pool. Sessions (IP + cookies) are saved under this ' +
          'key and reused across Actor runs. Useful when proxies are frequently blocked — previously ' +
          'working sessions are preferred over random ones.',
      )
      .meta({ title: 'Session pool name' })
      .register(apifyRegistry, { editor: 'textfield' }),

    maxSessionRotations: z
      .int()
      .min(0)
      .max(20)
      .default(10)
      .describe(
        'Maximum number of session (IP + browser fingerprint) rotations per request on block ' +
          'detection. Independent of maxRequestRetries. Set to 0 to disable session rotation.',
      )
      .meta({
        title: 'Max session rotations',
      }),

    navigationTimeoutSecs: z
      .int()
      .min(1)
      .default(60)
      .describe('Maximum time to wait for page navigation in seconds')
      .meta({ title: 'Navigation timeout' })
      .register(apifyRegistry, { unit: 'seconds', sectionCaption: 'Performance and limits' }),

    blockMedia: z
      .boolean()
      .default(true)
      .describe(
        'Block loading of images, stylesheets, fonts (.woff), PDFs, and ZIPs. On by default: it cuts browser memory and bandwidth substantially, which helps avoid out-of-memory on large pages. Disable it (set to false) if a page needs media to render its content (e.g. image- or CSS-driven lazy loading). Has no effect when using the raw HTTP crawler type or non-Chromium browsers (Chromium only).',
      )
      .meta({ title: 'Block media' }),

    waitForSelector: z
      .string()
      .default('')
      .describe(
        'Wait for this CSS selector to appear before extracting content. The request fails and is retried if the selector does not appear within the timeout. Leave empty to disable.',
      )
      .meta({ title: 'Wait for selector' })
      .register(apifyRegistry, { editor: 'textfield' }),

    softWaitForSelector: z
      .string()
      .default('')
      .describe(
        'Wait for this CSS selector to appear before extracting content. Unlike waitForSelector, the request continues even if the selector does not appear within the timeout. Leave empty to disable.',
      )
      .meta({ title: 'Soft wait for selector' })
      .register(apifyRegistry, { editor: 'textfield' }),

    waitForDynamicContentSecs: z
      .int()
      .min(0)
      .default(10)
      .describe(
        'Maximum seconds to wait for dynamic page content to load after navigation. The crawler continues when the network goes idle or this timeout elapses, whichever comes first. 0 disables this wait. Also used as the timeout for waitForSelector and softWaitForSelector.',
      )
      .meta({ title: 'Wait for dynamic content' })
      .register(apifyRegistry, { unit: 'seconds' }),

    waitUntil: z
      .enum(WaitUntil)
      .default(WaitUntil.Load)
      .describe(
        'When to consider navigation finished. networkidle waits for 500ms of network silence (best for JS-heavy SPAs, slower); load waits for the load event (default, good for most articles); domcontentloaded is fastest but may fire before client-side rendering completes; commit fires when network response is received and the document has started loading.',
      )
      .meta({ title: 'Navigation wait until' })
      .register(apifyRegistry, {
        editor: 'select',
        enumTitles: ['Load event', 'DOM content loaded', 'Network idle', 'Commit'],
      }),

    headless: z
      .boolean()
      .default(true)
      .describe('Run browser in headless mode')
      .meta({ title: 'Headless mode' }),

    ignoreCorsAndCsp: z
      .boolean()
      .default(false)
      .describe(
        'Ignore Content Security Policy and Cross-Origin Resource Sharing restrictions. Enables free XHR/Fetch requests from pages.',
      )
      .meta({ title: 'Ignore CORS and CSP' }),

    closeCookieModals: z
      .boolean()
      .default(true)
      .describe(
        'Automatically handle cookie consent: Ghostery-based ad/tracker blocking, accepting consent walls that replace the page (e.g. consent-or-pay) via the site’s own consent manager and re-fetching the article, and removing residual consent/CMP containers before extraction.',
      )
      .meta({ title: 'Close cookie modals' }),

    maxScrollHeight: z
      .int()
      .min(0)
      .default(5000)
      .describe(
        'Maximum pixels (px) to scroll down the page until all content is loaded. Setting to 0 disables scrolling.',
      )
      .meta({
        title: 'Max scroll height',
      }),

    userAgent: z
      .string()
      .default('')
      .describe(
        'Custom User-Agent string for the browser. Leave empty to use the default browser User-Agent.',
      )
      .meta({ title: 'User-Agent' })
      .register(apifyRegistry, { editor: 'textfield' }),

    ignoreHttpsErrors: z
      .boolean()
      .default(false)
      .describe('Ignore HTTPS certificate errors. Use at your own risk.')
      .meta({ title: 'Ignore HTTPS errors' }),
  })
  .strict();

export type MarkdowneeInputType = z.infer<typeof MarkdowneeInput>;
