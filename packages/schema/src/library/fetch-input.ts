import { z } from 'zod';
import { ImageHandling, SaveFormat } from '../source-of-truth/enum-aliases.js';
import { MarkdowneeLibraryInput } from './to-library-schema.js';

/** Single-page options share validation and defaults with the library projection. */
export const MarkdowneeFetchInput = MarkdowneeLibraryInput.omit({
  save: true,
  storageDir: true,
  includeHtml: true,
  maxCrawlDepth: true,
  maxRequestsPerCrawl: true,
  maxResultsPerCrawl: true,
  globs: true,
  exclude: true,
  selector: true,
  useSitemaps: true,
  keepUrlFragment: true,
  initialConcurrency: true,
  maxConcurrency: true,
  deduplication: true,
  storeSkippedUrls: true,
  sessionPoolName: true,
}).extend({
  formats: z.array(z.enum(SaveFormat)).min(1).default([SaveFormat.Markdown]),
  imageHandling: z
    .enum([ImageHandling.Exclude, ImageHandling.AltText, ImageHandling.ResolvedUrl])
    .default(ImageHandling.Exclude),
});
