# @markdownee/conversion

This internal renderer takes cleaned semantic HTML and produces Markdownee's selected
`txt`, `markdown`, readable `html`, and compact `minified-html` representations.

The extraction package supplies semantic content separately from its readable and compact HTML
presentations. Conversion parses the semantic input once for TXT and Markdown, keeping their
content independent of presentation whitespace.

```ts
import { convert } from '@markdownee/conversion';
import { OutputLayout, SaveFormat } from '@markdownee/schema';

const out = convert({
  semanticHtml: compactLayoutHtml,
  readableHtml,
  minifiedHtml,
  formats: [SaveFormat.Txt, SaveFormat.Markdown, SaveFormat.MinifiedHtml],
  layout: OutputLayout.Enhanced,
  context,
});
```

| Format          | How                                                                  |
| --------------- | -------------------------------------------------------------------- |
| `markdown`      | `turndown` + `@joplin/turndown-plugin-gfm` from stable semantic HTML |
| `txt`           | A whitespace-collapsing DOM walk; table cells joined by `" \| "`     |
| `html`          | Readable formatted generated HTML                                    |
| `minified-html` | Compact generated HTML, returned as `minifiedHtml`                   |

Choose the envelope with `layout`: `minimal` is body/fragment output, `standard` adds ordinary
metadata and complete HTML, and `enhanced` adds allowlisted extended metadata and crawl context.
TXT and Markdown use front matter where selected. Serialization omits unavailable values,
validates emitted URLs, and constructs the head rather than copying the source head.

The output contract contains neither XML nor XML-TEI.

## Readable presentation

`formatReadableHtml` lazily loads Prettier's HTML printer for the readable presentation.
Its input must already have passed Trafilatura Core's cleaning and sanitization. Keep `htmlWhitespaceSensitivity: 'css'`: the `'ignore'`
setting can change spacing around inline elements. Compact formatting belongs to Trafilatura Core's `formatSecuredHtml`. These presentation passes do not extract or sanitize again;
formatting failure returns the supplied HTML with a warning.

## Served Markdown

Markdown discovery can supply an origin-published body. This package separates its leading YAML
with `stripFrontMatter`, exposes allowlisted metadata, checks the remaining body with
`looksLikeMarkdown`, and reports removable markup through `containsUnsafeMarkup`.
`markdownToHtml` parses CommonMark plus GFM for subsequent cleaning and conversion. Fetching
remains the crawler's responsibility.

**That HTML is unsanitized.** Markdown is a superset of raw HTML by specification and the
parser does not sanitize, so every caller routes the result through Trafilatura Core's
security floor before anything else consumes it. `formatSecuredHtml` is not a substitute —
its input contract is already-secured HTML.

`SPEC.md` defines the API, TXT conventions, and ownership of `@mixmark-io/domino`.
