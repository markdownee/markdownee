import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const outputArg = process.argv[2];

if (!outputArg) {
  throw new Error('Usage: npm run deploy -w @markdownee/apify -- <output-dir>');
}

const outputDir = resolve(process.cwd(), outputArg);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const entry of ['package.json', 'dist', '.actor']) {
  await cp(resolve(packageRoot, entry), resolve(outputDir, entry), {
    recursive: true,
    dereference: true,
  });
}

await cp(resolve(repoRoot, 'node_modules'), resolve(outputDir, 'node_modules'), {
  recursive: true,
  dereference: true,
});

for (const extra of [
  'node_modules/@markdownee/apify',
  'node_modules/@markdownee/gen-input-schema',
  'node_modules/@markdownee/gen-md-regions',
  'node_modules/@markdownee/generated-unit-tests',
  'node_modules/@markdownee/opencode-sync',
  'node_modules/@markdownee/markdownee',
  'node_modules/@tools',
]) {
  await rm(resolve(outputDir, extra), { recursive: true, force: true });
}

console.log(`Deployed @markdownee/apify bundle to ${outputDir}`);
