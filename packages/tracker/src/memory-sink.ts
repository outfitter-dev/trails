import type { TrackSink } from './tracker-gate.js';
import type { Track } from './track.js';

/** In-memory sink for testing — captures all written records. */
export const createMemorySink = (): TrackSink & {
  readonly records: Track[];
} => {
  const records: Track[] = [];

  return {
    records,
    write: (record) => {
      records.push(record);
    },
  };
};
