import type { ConversionResult, OutputContext } from '@markdownee/extraction';
import type { MarkdownMechanism } from '@markdownee/schema';
import type { StoredImage } from '../images/stored-image.js';

export type Sink<T> = (result: T) => Promise<void>;

export interface ExtractionResult {
  url: string;
  html: string;
  metadata: OutputContext['metadata'];
  crawl?: OutputContext['crawl'];
  formats: ConversionResult;
  rawHtmlHash: string;
  rawHtmlLength: number;
  /**
   * Images stored by the save image-handling mode (`imageHandling: 'save'`) —
   * one entry per stored image, in document order. Present (possibly empty)
   * only when the save byte pipeline ran for this page.
   */
  images?: StoredImage[];
  /**
   * Present only when this page's content came from a Markdown representation
   * the origin published, rather than from extracting its HTML. Absent means
   * extracted, which is every page unless `markdownDiscovery` was turned on.
   *
   * When it is present, `html` is derived from those Markdown bytes rather than
   * received from the origin, so `rawHtmlHash` and `rawHtmlLength` describe the
   * derived document.
   */
  markdownSource?: {
    mechanism: MarkdownMechanism;
    /** The URL the Markdown bytes were fetched from. */
    url: string;
    /**
     * Whether `formats.markdown` is those served bytes or the round trip back
     * from the sanitized HTML. It describes the Markdown output alone — every
     * other format is rendered either way.
     */
    verbatim: boolean;
  };
}
