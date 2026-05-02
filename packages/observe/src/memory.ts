import type { TraceRecord, TraceSink } from '@ontrails/core';

export const DEFAULT_MEMORY_SINK_MAX_RECORDS = 1000;

export interface MemorySinkOptions {
  /** Maximum records retained in memory. Defaults to {@link DEFAULT_MEMORY_SINK_MAX_RECORDS}. */
  readonly maxRecords?: number | undefined;
}

export interface MemoryTraceSink extends TraceSink {
  /** Maximum retained records before older entries are dropped. */
  readonly maxRecords: number;
  /** Number of records dropped since the last clear. */
  readonly droppedCount: number;
  /** Remove retained records and reset the dropped counter. */
  clear(): void;
  /** Return retained records, oldest first, as a stable snapshot. */
  records(): readonly TraceRecord[];
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

/** Bounded in-memory trace sink for tests, dogfood tooling, and local trace rendering. */
export const createMemorySink = (
  options: MemorySinkOptions = {}
): MemoryTraceSink => {
  const maxRecords = normalizeMaxRecords(options.maxRecords);
  const retained: TraceRecord[] = [];
  let droppedCount = 0;

  return {
    clear() {
      retained.length = 0;
      droppedCount = 0;
    },
    get droppedCount() {
      return droppedCount;
    },
    maxRecords,
    records: () => [...retained],
    write(record) {
      retained.push(record);
      const overflow = retained.length - maxRecords;
      if (overflow > 0) {
        retained.splice(0, overflow);
        droppedCount += overflow;
      }
    },
  };
};

export const createBoundedMemorySink = createMemorySink;
