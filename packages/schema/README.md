# `@markdownee/schema`

Shared Zod input/output contracts for Markdownee's npm library, CLI, and Apify Actor.
Each interface has its own validated projection; Actor-only storage and proxy fields
do not belong to local library or CLI configuration.

`MarkdowneeInput` defines settings and finite-value aliases. `MarkdowneeOutput`
distinguishes `success`, `failed`, and `skipped` records. Structured results use
`minifiedHtml`; format selectors use `minified-html`.

The package also produces the Actor schemas and npm schema/presentation JSON.
`apifyRegistry` holds Actor UI hints separately from validation. Field and format
presentation exports supply the playground's labels and help text.

Applications consume the public validators through
`@markdownee/markdownee/schema`. See the
[npm library guide](https://www.markdownee.com/help/npm-library/),
[CLI configuration](https://www.markdownee.com/help/npm-cli/),
and [Actor input reference](https://www.markdownee.com/help/apify/)
for their supported fields and usage.
