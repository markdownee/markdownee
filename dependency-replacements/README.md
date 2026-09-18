# Dependency replacements (mirror payload)

This tree exists so the **public mirror** — and the production Actor image built from it — resolves
the same licence-clean `launder` replacement the tools workspace already resolves. It is synced to
the mirror root, where `package.json`'s `pnpm.overrides` points at it with a relative `file:` spec.

## Why a second copy exists

The authoritative copy is
`@/solutions/trafilaturacore/engine/packages/standalone/dependency-replacements/launder/`. The
tools workspace overrides `'sanitize-html>launder'` to it from `@/pnpm-workspace.yaml`, so the tools
TypeScript build and the test Actor resolve it; native Python installs its own dependencies.

The mirror cannot reach that path. It has no `@/solutions/trafilaturacore/` tree, `trafilaturacore`
arrives from npm, and the replacement sits outside that package's `files` allowlist (`["dist",
"LICENSE"]`), so it is not in the published tarball. A `file:` override target must resolve locally,
so the mirror needs its own copy — this one.

The duplication is deliberate and was the owner's decision of 2026-08-24, recorded at
`@/docs/legal/issues/done/2026-08-22-markdownee-mirror-actor-image-drops-launder-replacement/`.
Without it the mirror install resolves registry `launder`, which declares MIT and ships no
copyright-and-permission notice in any of its 19 published releases, into the published Actor image.

## The files are byte-identical, on purpose

`launder/index.js`, `launder/LICENSE` and `launder/package.json` are exact copies of the Trafilatura Core
originals — including the `@trafilaturacore/launder-replacement` package name, which is not renamed
here even though this is the Markdownee tree.

That is what makes drift detectable. The parity gate is a three-file byte comparison, so it cannot
be confused by a cosmetic difference and cannot silently accept a partial update. The package is
private and resolved by path, so its name is never published or resolved from a registry and
carries no meaning outside this directory.

**Never edit the files here.** Change the Trafilatura Core original, then re-copy. The gate fails the
sync otherwise.

## The gate

`@/.agents/skills/operations/markdownee-sync/scripts/assert-launder-replacement-parity.sh`
asserts, before
any mirror write:

1. all three files are byte-identical to the Trafilatura Core originals;
2. `package.release.json` carries the `'sanitize-html>launder'` override key;
3. that key's target resolves to a directory that exists in the synced payload.

It remains runnable standalone. The shared sync helper enforces the same byte-parity, override,
and required-target checks before purging the mirror. It keeps the override from being lost
silently — which matters because pnpm 11 ignores `pnpm.overrides` in `package.json` without failing
([pnpm/pnpm#11536](https://github.com/pnpm/pnpm/issues/11536)), so a future `packageManager` bump
could drop the key with no error.

This gate checks the mirror payload before transfer. TypeScript dependency installation also
requires the dangerous-href parity gate at the canonical Trafilatura Core owner below. Native Python
no longer vendors this dependency graph, so the former Python wheel-staging backstop is removed.

## Maintenance obligation

The replacement ports the dangerous-href check from `sanitize-html@2.17.3`, the last release that
carried it inline before the maintainer extracted it into `launder`. A `sanitize-html` bump must be
diffed against it — see the Trafilatura Core original's `../README.md`, which owns that obligation. This
copy inherits it and adds no second obligation of its own, because it is never edited independently.
