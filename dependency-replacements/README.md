# Dependency replacements

This directory supplies the local `launder` replacement used by Markdownee's
TypeScript dependency installation. `sanitize-html` depends on upstream `launder`,
whose published package declares a license but omits its copyright-and-permission
notice. The replacement carries its own [license](launder/LICENSE).

Its `index.js`, `LICENSE`, and `package.json` match the
[Trafilatura Core replacement](https://github.com/markdownee/trafilaturacore/tree/main/packages/standalone/dependency-replacements/launder)
byte-for-byte. Make implementation changes at that owner, then copy all three files
together; keep the `@trafilaturacore/launder-replacement` package name unchanged.

The `sanitize-html>launder` override requires an existing local target. Check both
the override and file parity when updating dependencies. The key is not version
bounded, so a `sanitize-html` upgrade can keep selecting a stale replacement.

The replacement includes the dangerous-href check formerly in `sanitize-html@2.17.3`.
Review upstream changes to that check and verify the replacement's behavior through
`sanitize-html` after an upgrade. The
[canonical replacement notes](https://github.com/markdownee/trafilaturacore/tree/main/packages/standalone/dependency-replacements)
own the maintenance details. Native Python installs separate dependencies and does not bundle
this JavaScript graph.
