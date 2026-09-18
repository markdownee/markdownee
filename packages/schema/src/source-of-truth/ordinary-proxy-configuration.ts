import { z } from 'zod';

/** Ordinary proxy URLs for local adapters; Apify Proxy options belong to the Actor. */
export const OrdinaryProxyConfiguration = z
  .object({ proxyUrls: z.array(z.string()).optional() })
  .strict()
  .describe(
    'Ordinary proxy URLs using http, https, socks4, or socks5. Apify Proxy options are not accepted.',
  );
