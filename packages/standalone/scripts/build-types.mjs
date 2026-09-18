import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractor, ExtractorConfig, ExtractorLogLevel } from '@microsoft/api-extractor';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configPath = path.join(packageDir, 'api-extractor.json');
const ROOT_SCHEMA_DECLARATIONS = new Set([
  'MarkdowneeFetchInput',
  'MarkdowneeInput',
  'MarkdowneeLibraryInput',
  'MarkdowneeOutput',
]);

for (const entry of ['index', 'cli-api', 'storage', 'schema']) {
  const configObject = ExtractorConfig.loadFile(configPath);
  configObject.mainEntryPointFilePath = `<projectFolder>/dist-types/${entry}.d.ts`;
  if (!configObject.dtsRollup?.enabled) {
    throw new Error('api-extractor.json must enable declaration rollups.');
  }
  configObject.dtsRollup.untrimmedFilePath = `<projectFolder>/dist/${entry}.d.ts`;
  const config = ExtractorConfig.prepare({
    configObject,
    configObjectFullPath: configPath,
    packageJsonFullPath: path.join(packageDir, 'package.json'),
  });
  const result = Extractor.invoke(config, {
    localBuild: true,
    messageCallback(message) {
      if (
        entry === 'index' &&
        message.messageId === 'ae-forgotten-export' &&
        [...ROOT_SCHEMA_DECLARATIONS].some((name) =>
          message.text.startsWith(`The symbol "${name}" needs to be exported`),
        )
      ) {
        // These declarations support root-exported inferred types but remain runtime-only
        // exports of markdownee/schema. Keep every other forgotten export visible.
        message.logLevel = ExtractorLogLevel.None;
      }
    },
  });
  if (!result.succeeded) {
    throw new Error(`Declaration rollup failed for ${entry}: ${result.errorCount} errors.`);
  }
}
