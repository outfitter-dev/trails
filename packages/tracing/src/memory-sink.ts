import type { TraceRecord, TraceSink } from '@ontrails/core';

export const DEFAULT_MEMORY_SINK_MAX_RECORDS = 1000;

export interface MemorySinkOptions {
  /** Maximum records retained in memory. Defaults to {@link DEFAULT_MEMORY_SINK_MAX_RECORDS}. */
  readonly maxRecords?: number | undefined;
}

export interface MemoryTraceSink extends TraceSink {
  /** Live retained records, oldest first. */
  readonly records: readonly TraceRecord[];
  /** Maximum retained records before older entries are dropped. */
  readonly maxRecords: number;
  /** Number of records dropped since the last clear. */
  readonly droppedCount: number;
  /** Remove retained records and reset the dropped counter. */
  readonly clear: () => void;
  /** Return a stable snapshot without exposing the live mutable array. */
  readonly snapshot: () => readonly TraceRecord[];
}

const normalizeMaxRecords = (value: number | undefined): number => {
  const maxRecords = value ?? DEFAULT_MEMORY_SINK_MAX_RECORDS;
  if (!Number.isInteger(maxRecords) || maxRecords < 1) {
    throw new RangeError(
      'Memory trace sink maxRecords must be a positive integer'
    );
  }
  return maxRecords;
};

/** Bounded in-memory sink for testing and local trace rendering. */
export const createMemorySink = (
  options: MemorySinkOptions = {}
): MemoryTraceSink => {
  const maxRecords = normalizeMaxRecords(options.maxRecords);
  const records: TraceRecord[] = [];
  let droppedCount = 0;

  return {
    clear() {
      records.length = 0;
      droppedCount = 0;
    },
    get droppedCount() {
      return droppedCount;
    },
    maxRecords,
    records,
    snapshot: () => [...records],
    write: (record) => {
      records.push(record);
      const overflow = records.length - maxRecords;
      if (overflow > 0) {
        records.splice(0, overflow);
        droppedCount += overflow;
      }
    },
  };
};

export const createBoundedMemorySink = createMemorySink;
