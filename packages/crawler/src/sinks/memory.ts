import type { Sink } from './types.js';

interface MemorySink<T> extends Sink<T> {
  results: T[];
}

export function memorySink<T>(): MemorySink<T> {
  const results: T[] = [];
  const sink: MemorySink<T> = async (result) => {
    results.push(result);
  };
  sink.results = results;
  return sink;
}
