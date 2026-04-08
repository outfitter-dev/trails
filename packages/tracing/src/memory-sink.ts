import type { TraceRecord, TraceSink } from '@ontrails/core';

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
