#!/usr/bin/env node
import { buildProgram, isMainEntry, runCli } from './cliProgram.js';

export { buildProgram } from './cliProgram.js';

export const program = buildProgram();

if (isMainEntry(import.meta.url)) {
  await runCli(program, process.argv);
}
