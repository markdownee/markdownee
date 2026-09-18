#!/usr/bin/env node
/**
 * Publish gate (SPEC.md "package checks must verify the published tarball"):
 * publint, @arethetypeswrong/cli, and an entry-target pack check, run from
 * `prepublishOnly` as one guarded script. The guard matters: pnpm also runs
 * `prepublishOnly` for workspace-linked packages during `pnpm install`, where
 * a not-yet-built `dist/` is legitimate — so outside a real publish
 * (`npm_command === "publish"`) the gate is skipped unless forced with
 * `--force`. Never published itself (`scripts/` is outside the files
 * allowlist).
 *
 * attw baseline (measured on 0.4.14): `--profile esm-only` accepts the
 * by-design `type: module` CJS/node10 resolutions on this Node.js 22+ ESM
 * package. Every JavaScript subpath is a typed importable API; the separate
 * shebang bin remains dist/cli.js.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

if (process.env.npm_command !== 'publish' && !process.argv.includes('--force')) {
  console.log('verify-package: skipped (not an npm publish; pass --force to run the gate).');
  process.exit(0);
}

// Both binaries are named as string literals and located by prepending this
// package's own `node_modules/.bin` to PATH, rather than by resolving an absolute
// path. Precedence is unchanged — the local `.bin` wins, PATH is the fallback — but
// the literal keeps `publint` and `@arethetypeswrong/cli` visible to the dead-code
// audit, which parses `node:child_process` calls and only follows a string-literal
// executable. A computed path or a wrapper function makes both read as unused
// devDependencies and invites deleting this gate.
const binDir = path.join(packageDir, 'node_modules', '.bin');
/** @type {import('node:child_process').ExecFileSyncOptions} */
const options = {
  cwd: packageDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: process.env.PATH ? `${binDir}${path.delimiter}${process.env.PATH}` : binDir,
  },
};

execFileSync('publint', [], options);
execFileSync('attw', ['--pack', '.', '--profile', 'esm-only'], options);
execFileSync('tsc', ['-p', 'tsconfig.consumer.json'], options);

// Entry-target pack check: every target declared in package.json — `main`,
// `types`, `bin`, and every `exports` leaf — must be present in the `npm pack`
// file list, or an omitted `files` entry / missing build artifact ships.
const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const domAdapter = JSON.parse(
  readFileSync(path.join(packageDir, 'node_modules/isomorphic-dompurify/package.json'), 'utf8'),
);
if (manifest.engines?.node !== domAdapter.engines?.node) {
  throw new Error(
    'The Node.js support range must match the installed isomorphic-dompurify runtime.',
  );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function targets(value) {
  if (typeof value === 'string') return [value.startsWith('./') ? value.slice(2) : value];
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(targets);
  return [];
}

const declared = [
  ...new Set([
    ...targets(manifest.main),
    ...targets(manifest.types),
    ...targets(manifest.bin),
    ...targets(manifest.exports),
  ]),
];
if (declared.length === 0) {
  console.error('verify-package: package.json declares no entry targets — refusing to pass.');
  process.exit(1);
}

const [pack] = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: packageDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const packed = new Set(
  /** @type {{ files: { path: string }[] }} */ (pack).files.map((file) => file.path),
);

const missing = declared.filter((target) => !packed.has(target));
if (missing.length > 0) {
  console.error(`verify-package: npm pack is missing ${missing.length} declared entry target(s):`);
  for (const target of missing) console.error(`  - ${target}`);
  process.exit(1);
}
console.log(`verify-package: all ${declared.length} declared entry targets are packed.`);

// Exercise Node's export-map resolution with the built package's own name. The
// CLI API must be importable even when argv contains a command it would reject.
execFileSync(
  process.execPath,
  [
    '--input-type=module',
    '--eval',
    `
      import assert from 'node:assert/strict';
      import { Configuration } from 'crawlee';
      const configuration = Configuration.getGlobalConfig();
      const storageOptions = configuration.get('storageClientOptions');
      const purgeOnStart = configuration.get('purgeOnStart');
      process.argv.push('not-a-markdownee-command');
      const library = await import('markdownee');
      const cli = await import('markdownee/cli');
      const storage = await import('markdownee/storage');
      const schema = await import('markdownee/schema');
      assert.equal(typeof library.fetch, 'function');
      assert.equal(typeof library.createCrawler, 'function');
      for (const name of ['buildProgram', 'isMainEntry', 'runCli']) {
        assert.equal(typeof cli[name], 'function');
        assert.equal(name in library, false);
      }
      assert.equal('program' in cli, false);
      for (const name of ['Configuration', 'Dataset', 'KeyValueStore',
        'configureStorage', 'resolveStorageDir', 'runExportAction', 'runPurgeAction']) {
        assert.equal(typeof storage[name], 'function');
        assert.equal(name in library, false);
      }
      for (const name of ['MarkdowneeInput', 'MarkdowneeOutput',
        'MarkdowneeLibraryInput', 'MarkdowneeFetchInput',
        'getInputJsonSchema', 'getOutputJsonSchema']) {
        assert.ok(schema[name]);
        assert.equal(name in library, false);
      }
      assert.equal(library.Save, schema.Save);
      assert.equal(library.SaveFormat, schema.SaveFormat);
      assert.equal(configuration.get('storageClientOptions'), storageOptions);
      assert.equal(configuration.get('purgeOnStart'), purgeOnStart);
      assert.deepEqual(cli.buildProgram().commands.map(command => command.name()),
        ['crawl', 'fetch', 'export', 'purge']);
    `,
  ],
  options,
);
console.log(
  'verify-package: typed API subpaths import without running CLI or configuring storage.',
);
