import { z } from 'zod';
import { MarkdownMechanism } from './enum-aliases.js';

/**
 * Zod source-of-truth for the Apify Actor dataset output schema.
 *
 * The dataset carries three record shapes discriminated by `status`
 * (see packages/apify-actor/SPEC.md): `success`, `failed`, `skipped`.
 *
 * Crawl provenance uses the same canonical camelCase paths as generated JSON:
 * top-level `url`, plus `crawl.loadedUrl`, `crawl.scrapedAt`,
 * `crawl.httpStatusCode`, `crawl.depth`, and `crawl.referrerUrl`.
 */

/**
 * A piece of content (an extracted format or the raw original HTML). Always an
 * object: `hash` + `bytes` are always present. `content` carries the inline
 * string when the format targets the dataset (a `*-dataset` token), while `key`
 * + `url` reference the blob when it targets the key-value store (a `*-kvs`
 * token). Both may be present at once when a format targets both destinations.
 */
const ContentNode = z.object({
  hash: z.string().describe('MD5 hex digest of the content'),
  bytes: z.number().int().describe('UTF-8 byte length of the content'),
  content: z
    .string()
    .optional()
    .describe(
      'Inline content string. Present when this format targets the dataset (a "*-dataset" token). May co-exist with "key"/"url" when the format also targets the key-value store.',
    ),
  key: z
    .string()
    .optional()
    .describe(
      'Key-value store key. Present when this format targets the key-value store (a "*-kvs" token). May co-exist with inline "content" when the format also targets the dataset.',
    ),
  url: z
    .string()
    .optional()
    .describe('Public URL to the key-value store item. Present when stored to a public store.'),
});

/**
 * One image stored by the save image-handling mode (`imageHandling: "save"` —
 * distinct from the `save` format-destination tokens). Bytes live in the
 * key-value store under `images-{md5(sourceUrl)}.{ext}`; the dataset record
 * carries only these references.
 */
const StoredImage = z.object({
  key: z
    .string()
    .describe('Key-value store key of the stored image ("images-{md5(sourceUrl)}.{ext}")'),
  publicUrl: z
    .string()
    .optional()
    .describe('Public URL to the stored image. Present when stored to a public store.'),
  sourceUrl: z.string().describe('Resolved absolute URL the image bytes were downloaded from'),
  alt: z.string().optional().describe('Alt text carried by the image, when present'),
  width: z.number().int().optional().describe('Stored pixel width (after any resize)'),
  height: z.number().int().optional().describe('Stored pixel height (after any resize)'),
  format: z
    .enum(['webp', 'png', 'svg'])
    .describe(
      'The stored format (also the key extension): "webp" re-encoded raster, "png" rasterized SVG, "svg" sanitized SVG source',
    ),
});

const Metadata = z
  .object({
    title: z.string().optional().describe('Page title'),
    author: z.string().optional().describe('Content author'),
    date: z.string().optional().describe('Publication date'),
    description: z.string().optional().describe('Page description or summary'),
    siteName: z.string().optional().describe('Site name'),
    languageCode: z.string().optional().describe('Detected content language code (ISO 639)'),
    pageUrl: z.string().url().optional().describe('Canonical page URL from page metadata'),
    imageUrl: z.string().url().optional().describe('Representative image URL'),
    hostname: z.string().optional().describe('Page hostname'),
    categories: z.array(z.string()).optional().describe('Extracted categories'),
    tags: z.array(z.string()).optional().describe('Extracted tags'),
    license: z.string().optional().describe('Content license'),
    declaredPageType: z
      .string()
      .optional()
      .describe(
        'Page-declared type from OpenGraph og:type or a recognized JSON-LD @type, lowercased for JSON-LD',
      ),
  })
  .describe('Extracted page metadata');

/**
 * Provenance for a page whose content came from a Markdown representation the
 * origin published rather than from extracting the page HTML. Reachable only
 * when `markdownDiscovery` is above `off`; the record's `original` is then
 * derived from the served bytes rather than received from the origin.
 */
const MarkdownSource = z
  .object({
    mechanism: z
      .enum(MarkdownMechanism)
      .describe(
        'Discovery method: "response" for Markdown returned by the page request, "alternate" for an advertised same-origin link, "negotiated" for an Accept-based refetch, or "sibling" for a .md URL probe',
      ),
    url: z.string().describe('Source URL of the fetched Markdown representation'),
    verbatim: z
      .boolean()
      .describe(
        'True when the Markdown output uses the served body after removing source front matter ' +
          "and applying this run's layout. False when output was converted from cleaned HTML " +
          'or when the record contains no Markdown output.',
      ),
  })
  .describe('Details of the published Markdown representation used as the content source');

const Crawl = z
  .object({
    loadedUrl: z.string().url().optional().describe('The URL that was loaded (post-redirect)'),
    scrapedAt: z.string().describe('ISO 8601 timestamp when extraction ran'),
    httpStatusCode: z
      .number()
      .int()
      .optional()
      .describe('Observed HTTP response status code, when available'),
    depth: z.number().int().optional().describe('Link distance from a start URL'),
    referrerUrl: z.string().url().optional().describe('The linking page URL'),
  })
  .describe('Crawl provenance for this page');

const SuccessRecord = z.object({
  url: z.string().describe('The original request URL'),
  status: z.literal('success').describe('Record outcome discriminator'),
  metadata: Metadata,
  crawl: Crawl.optional(),
  original: ContentNode.describe(
    'The raw page HTML. "hash" and "bytes" are always present. When an "original-*" token is in save, the raw HTML is included as "content" (an "original-dataset" token) and/or referenced by "key"/"url" (an "original-kvs" token).',
  ),
  txt: ContentNode.optional().describe(
    'Extracted plain text. Present when a "txt-*" token is in save.',
  ),
  markdown: ContentNode.optional().describe(
    'Extracted Markdown. Present when a "markdown-*" token is in save.',
  ),
  html: ContentNode.optional().describe(
    'Readable cleaned HTML. Present when an "html-*" token is in save.',
  ),
  minifiedHtml: ContentNode.optional().describe(
    'Compact cleaned HTML. Present when a "minified-html-*" token is in save.',
  ),
  images: z
    .array(StoredImage)
    .optional()
    .describe(
      'Images stored in the key-value store by the save image-handling mode (imageHandling: "save") — one reference per stored image, in document order. Absent in other image-handling modes.',
    ),
  markdownSource: MarkdownSource.optional().describe(
    'Identifies content obtained from an origin-published Markdown representation through enabled ' +
      'markdownDiscovery. Omitted for content extracted from page HTML.',
  ),
});

const FailedRecord = z.object({
  url: z.string().describe('The original request URL'),
  status: z.literal('failed').describe('Record outcome discriminator'),
  crawl: z
    .object({
      loadedUrl: z
        .string()
        .url()
        .optional()
        .describe('The URL that was loaded before failure, when navigation completed'),
      scrapedAt: z.string().describe('ISO 8601 timestamp when the request was abandoned'),
    })
    .describe('Crawl provenance for this page'),
  errors: z.array(z.string()).describe('Error messages from the final attempt'),
  retryCount: z.number().int().describe('Number of retries before the request was abandoned'),
});

const SkippedRecord = z.object({
  url: z.string().describe('The skipped URL'),
  status: z.literal('skipped').describe('Record outcome discriminator'),
  skipReason: z
    .enum(['robotsTxt', 'limit', 'enqueueLimit', 'filters', 'redirect', 'depth'])
    .describe('Why the URL was skipped'),
});

export const MarkdowneeOutput = z.discriminatedUnion('status', [
  SuccessRecord,
  FailedRecord,
  SkippedRecord,
]);
