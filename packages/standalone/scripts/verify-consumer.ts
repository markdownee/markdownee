// Compiled after build by verify-package.mjs; never executed. Bare self-imports
// resolve the public export map and rolled-up declarations, not source files.
import {
  CrawlerType,
  createCrawler,
  type FailedRequestInfo,
  type FetchOptions,
  fetch,
  type MarkdowneeInputType,
  type MarkdowneeOptions,
  type MarkdowneeOutputType,
  type ResultDataset,
  Save,
  SaveFormat,
} from 'markdownee';
import { buildProgram, runCli } from 'markdownee/cli';
import {
  MarkdowneeFetchInput,
  MarkdowneeInput,
  MarkdowneeLibraryInput,
  MarkdowneeOutput,
  type MarkdowneeInputType as SchemaInput,
} from 'markdownee/schema';
import {
  Configuration,
  Dataset,
  type DatasetContent,
  KeyValueStore,
  runExportAction,
  runPurgeAction,
} from 'markdownee/storage';

export async function consumePublicPackage(url: string): Promise<void> {
  const input: MarkdowneeInputType = MarkdowneeInput.parse({ startUrls: [{ url }] });
  const schemaInput: SchemaInput = input;
  const output: MarkdowneeOutputType = MarkdowneeOutput.parse({});
  const options: MarkdowneeOptions = {
    crawlerType: CrawlerType.Cheerio,
    save: [Save.MarkdownDataset],
    initialCookies: [{ name: 'example', value: 'value', domain: 'example.com' }],
  };
  const parsedOptions: MarkdowneeOptions = MarkdowneeLibraryInput.parse(options);
  const singleOptions: FetchOptions = {
    crawlerType: CrawlerType.Cheerio,
    formats: [SaveFormat.Markdown, SaveFormat.MinifiedHtml],
  };
  const parsedSingle: FetchOptions = MarkdowneeFetchInput.parse(singleOptions);
  const single = await fetch(url, singleOptions);
  const markdown: string | undefined = single.markdown;
  const minifiedHtml: string | undefined = single.minifiedHtml;
  const { dataset, statistics, failures } = await createCrawler(options).run([url]);
  const publicDataset: ResultDataset = dataset;
  const failure: FailedRequestInfo | undefined = failures[0];
  const configuration = new Configuration({ purgeOnStart: false });
  const store = await KeyValueStore.open('results', { config: configuration });
  await dataset.exportToJSON('pages.json', store);
  await dataset.exportToCSV('pages.csv', store);
  const storageDataset = await Dataset.open('results', { config: configuration });
  const data: DatasetContent<Record<string, unknown>> = await storageDataset.getData();
  await runExportAction({ storageDir: './storage', outputDir: './exported' });
  await runPurgeAction({ storageDir: './storage' });
  await runCli(buildProgram(), ['node', 'markdownee', '--help']);

  const library = await import('markdownee');
  // @ts-expect-error CLI construction belongs to the CLI subpath.
  const rootCli = library.buildProgram;
  // @ts-expect-error Storage operations belong to the storage subpath.
  const rootStorage = library.runExportAction;
  // @ts-expect-error Runtime validators belong to the schema subpath.
  const rootSchema = library.MarkdowneeInput;
  // @ts-expect-error Single-page extraction cannot follow a crawl frontier.
  const invalidSingle: FetchOptions = { maxCrawlDepth: 2 };
  // @ts-expect-error Return-only single-page extraction cannot store image bytes.
  const invalidImage: FetchOptions = { imageHandling: 'save' };
  void [
    schemaInput,
    output,
    parsedOptions,
    parsedSingle,
    markdown,
    minifiedHtml,
    publicDataset,
    statistics,
    failure,
    data,
    invalidSingle,
    invalidImage,
    rootCli,
    rootStorage,
    rootSchema,
  ];
}
