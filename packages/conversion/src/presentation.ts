import type { Message } from './message.js';

export interface ReadableHtmlResult {
  html: string;
  messages: Message[];
}

/**
 * Format HTML that has already passed Trafilatura Core's cleaning and security
 * floor into Markdownee's readable presentation. Formatting is
 * presentation-only and never repeats extraction or sanitization. A formatter
 * failure is non-fatal and returns the secured input.
 *
 * `htmlWhitespaceSensitivity: 'css'` is binding, not a preference. Under
 * `'ignore'` Prettier reflows around inline elements and changes the rendered
 * text: `<p>Read <a href="/x">RFC 6761</a>, then stop.</p>` comes back with the
 * anchor on its own line, which renders as `RFC 6761 ,` — a different document.
 * `'css'` keeps every inline run intact.
 */
export async function formatReadableHtml(securedHtml: string): Promise<ReadableHtmlResult> {
  if (securedHtml === '') return { html: '', messages: [] };

  try {
    const prettier = await import('prettier');
    return {
      html: await prettier.format(securedHtml, {
        parser: 'html',
        printWidth: 120,
        tabWidth: 2,
        htmlWhitespaceSensitivity: 'css',
      }),
      messages: [],
    };
  } catch {
    return {
      html: securedHtml,
      messages: [
        {
          type: 'warning',
          text: 'Could not format HTML; returning the cleaned input without formatting.',
        },
      ],
    };
  }
}
