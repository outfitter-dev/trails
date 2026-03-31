import type { TrackSink } from './tracks-layer.js';
import type { TrackRecord } from './record.js';

/** In-memory sink for testing — captures all written records. */
export const createMemorySink = (): TrackSink & {
  readonly records: TrackRecord[];
} => {
  const records: TrackRecord[] = [];

  return {
    records,
    write: (record) => {
      records.push(record);
    },
  };
};
