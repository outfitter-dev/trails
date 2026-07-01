import {
  DEFAULT_MEMORY_SINK_MAX_RECORDS,
  createMemorySink as createObserveMemorySink,
} from '@ontrails/observe';
import type {
  MemorySinkOptions,
  MemoryTraceSink as ObserveMemoryTraceSink,
} from '@ontrails/observe';
import type { TraceRecord, TraceSink } from '@ontrails/core';

export { DEFAULT_MEMORY_SINK_MAX_RECORDS };
export type { MemorySinkOptions };

export interface MemoryTraceSink extends TraceSink {
  /** Retained records, oldest first, as a live compatibility view. */
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

const adaptObserveMemorySink = (
  sink: ObserveMemoryTraceSink
): MemoryTraceSink => {
  const records: TraceRecord[] = [];

  return {
    clear: () => {
      sink.clear();
      records.length = 0;
    },
    get droppedCount() {
      return sink.droppedCount;
    },
    maxRecords: sink.maxRecords,
    records,
    snapshot: () => [...records],
    write: (record) => {
      sink.write(record);
      records.push(record);
      const overflow = records.length - sink.maxRecords;
      if (overflow > 0) {
        records.splice(0, overflow);
      }
    },
  };
};

/** Compatibility wrapper over the canonical `@ontrails/observe` memory sink. */
export const createMemorySink = (
  options: MemorySinkOptions = {}
): MemoryTraceSink => adaptObserveMemorySink(createObserveMemorySink(options));

/** @alias */
export const createBoundedMemorySink = createMemorySink;
