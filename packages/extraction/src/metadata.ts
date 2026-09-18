import type { Metadata } from './index.js';

export interface DatasetMetadata {
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  description: string | null;
  siteName: string | null;
  languageCode: string | null;
}

export function projectMetadata(meta: Metadata): DatasetMetadata {
  return {
    title: meta.title,
    author: meta.author,
    publishedAt: meta.date,
    description: meta.description,
    siteName: meta.sitename,
    languageCode: meta.language ?? null,
  };
}
