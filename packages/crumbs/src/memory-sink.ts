import type { CrumbSink } from './crumbs-layer.js';
import type { Crumb } from './record.js';

/** In-memory sink for testing — captures all written records. */
export const createMemorySink = (): CrumbSink & {
  readonly records: Crumb[];
} => {
  const records: Crumb[] = [];

  return {
    records,
    write: (record) => {
      records.push(record);
    },
  };
};
