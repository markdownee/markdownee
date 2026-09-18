import { access, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'tsup';

/**
 * The published `markdownee` tarball must carry no `@markdownee/*`
 * runtime dependencies (the core packages are internal-only, `private: true`),
 * so this bundles them into `dist`. Public packages (crawlee, playwright,
 * commander, turndown, `trafilaturacore`, …) stay external regular
 * dependencies.
 *
 * `trafilaturacore` is one of those externals: an ordinary published npm package
 * of platform-independent JavaScript. It carries no native addon, and neither
 * does Markdownee, so nothing here stages a `.node` file.
 */
export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    'cli-api': 'src/cli-api.ts',
    index: 'src/index.ts',
    storage: 'src/storage.ts',
    schema: 'src/schema.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // Typings are produced by `tsc -p tsconfig.dts.json` + api-extractor (see
  // the build script): tsup's dts pipelines cannot inline the internal
  // @markdownee/* packages into a self-contained dist/index.d.ts.
  dts: false,
  clean: true,
  sourcemap: false,
  // Splitting dedupes code shared by the public entries into dist/ chunks.
  // cli.ts's own top-level code — the `isMainEntry(import.meta.url)`
  // check — stays in the dist/cli.js entry chunk, so the bin-path comparison
  // still works.
  splitting: true,
  noExternal: [/^@markdownee\//],
  banner: {
    // Bundled code may reach CJS-only externals (turndown, domino) at runtime;
    // ESM output has no `require` without this shim. The aliased import avoids
    // colliding with source-level createRequire imports.
    js: "import { createRequire as __bundleCreateRequire } from 'node:module'; const require = __bundleCreateRequire(import.meta.url);",
  },
  async onSuccess() {
    // Ship the third-party attribution NOTICE, the Apache-2.0 LICENSE text and the
    // THIRD-PARTY-NOTICES.txt attribution file in the published tarball. `dist` is
    // already in the package `files` allowlist, so copying them here is enough. The NOTICE
    // points at "(see LICENSE)" and at the notices file, so all three must ship.
    // This is the npm channel's route only. The native Python wheel and source
    // distribution carry their package-local LICENSE and NOTICE through Hatchling;
    // they do not vendor this dist tree or the Node dependency closure.
    // The tarball bundles rather than vendoring a node_modules tree, so a dependency's
    // own licence file never travels with it here — the notices file is the only route
    // by which the material it carries reaches an npm consumer.
    // After the engine un-nest, NOTICE/LICENSE sit at the workspace root in BOTH
    // repos — the public `markdownee` mirror and the `tools` source-of-truth
    // engine workspace (`solutions/markdownee/engine/`) — two levels up from this
    // `standalone` package, so a single resolution works in both.
    const resolveDoc = async (name: string) => {
      const candidate = path.join(__dirname, '..', '..', name); // workspace root
      try {
        await access(candidate);
        return candidate;
      } catch {
        throw new Error(`tsup: could not locate ${name} at the workspace root (${candidate})`);
      }
    };
    await copyFile(await resolveDoc('NOTICE'), path.join(__dirname, 'dist', 'NOTICE'));
    await copyFile(await resolveDoc('LICENSE'), path.join(__dirname, 'dist', 'LICENSE'));
    await copyFile(
      await resolveDoc('THIRD-PARTY-NOTICES.txt'),
      path.join(__dirname, 'dist', 'THIRD-PARTY-NOTICES.txt'),
    );
  },
});
