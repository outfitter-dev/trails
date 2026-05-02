import { describe, expect, test } from 'bun:test';

import type { TraceRecord } from '@ontrails/core';

import {
  DEFAULT_MEMORY_SINK_MAX_RECORDS,
  createBoundedMemorySink,
  createMemorySink,
} from '../memory-sink.js';

const makeRecord = (id: string): TraceRecord => ({
  attrs: {},
  endedAt: 2,
  id,
  kind: 'trail',
  name: `trail.${id}`,
  rootId: id,
  startedAt: 1,
  status: 'ok',
  traceId: `trace.${id}`,
  trailId: `trail.${id}`,
});

describe('memory trace sink', () => {
  test('uses a bounded default capacity', () => {
    const sink = createMemorySink();

    expect(sink.maxRecords).toBe(DEFAULT_MEMORY_SINK_MAX_RECORDS);
  });

  test('retains only the newest records past capacity', () => {
    const sink = createMemorySink({ maxRecords: 2 });

    sink.write(makeRecord('a'));
    sink.write(makeRecord('b'));
    sink.write(makeRecord('c'));

    expect(sink.records.map((record) => record.id)).toEqual(['b', 'c']);
    expect(sink.droppedCount).toBe(1);
  });

  test('clear resets records and drop count', () => {
    const sink = createMemorySink({ maxRecords: 1 });

    sink.write(makeRecord('a'));
    sink.write(makeRecord('b'));
    sink.clear();

    expect(sink.records).toEqual([]);
    expect(sink.droppedCount).toBe(0);
  });

  test('snapshot returns a stable copy', () => {
    const sink = createMemorySink({ maxRecords: 2 });
    sink.write(makeRecord('a'));
    const snapshot = sink.snapshot();

    sink.write(makeRecord('b'));

    expect(snapshot.map((record) => record.id)).toEqual(['a']);
    expect(sink.records.map((record) => record.id)).toEqual(['a', 'b']);
  });

  test('rejects invalid capacities', () => {
    expect(() => createMemorySink({ maxRecords: 0 })).toThrow(RangeError);
    expect(() => createMemorySink({ maxRecords: 1.5 })).toThrow(RangeError);
  });

  test('createBoundedMemorySink aliases the memory sink factory', () => {
    const sink = createBoundedMemorySink({ maxRecords: 1 });

    sink.write(makeRecord('a'));
    sink.write(makeRecord('b'));

    expect(sink.records.map((record) => record.id)).toEqual(['b']);
  });
});
