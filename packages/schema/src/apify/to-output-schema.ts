import { writeFileSync } from 'node:fs';
import { OutputViews } from './output-views.js';

/** Build the Apify output schema (Console "Output" links) from `OutputViews`. */
export function toOutputSchema(views = OutputViews): {
  actorOutputSchemaVersion: number;
  title: string;
  properties: Record<string, unknown>;
} {
  return {
    actorOutputSchemaVersion: 1,
    title: views.title,
    properties: views.output,
  };
}

export function writeOutputSchema(outPath: string): void {
  writeFileSync(outPath, `${JSON.stringify(toOutputSchema(), null, 2)}\n`, 'utf8');
}
