import type { MarkdowneeLibraryInput } from '@markdownee/schema';
import type { z } from 'zod';

/** CamelCase library options, validated by the shared library input projection. */
export type MarkdowneeOptions = Readonly<z.input<typeof MarkdowneeLibraryInput>>;
