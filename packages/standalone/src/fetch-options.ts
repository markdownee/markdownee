import type { KvsLike } from '@markdownee/crawler';
import type { MarkdowneeFetchInput } from '@markdownee/schema';
import type { z } from 'zod';
import type { MarkdowneeOptions } from './markdownee-options.js';

/** Return-only single-page options. Output routing and crawl-frontier controls are absent. */
export type FetchOptions = Readonly<z.input<typeof MarkdowneeFetchInput>>;

/** Internal CLI file-output adapter; never exported from the package root. */
export type FetchRuntimeOptions = Omit<FetchOptions, 'imageHandling'> & {
  readonly imageHandling?: MarkdowneeOptions['imageHandling'];
  readonly imageKvs?: KvsLike;
};
