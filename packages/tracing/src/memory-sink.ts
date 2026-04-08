import type { TraceSink } from './tracing-layer.js';
import type { TraceRecord } from './trace-record.js';

/** In-memory sink for testing — captures all written records. */
export const createMemorySink = (): TraceSink & {
  readonly records: TraceRecord[];
} => {
  const records: TraceRecord[] = [];

  return {
    records,
    write: (record) => {
      records.push(record);
    },
  };
};
