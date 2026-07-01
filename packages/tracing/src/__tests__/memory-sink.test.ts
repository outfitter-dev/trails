import { describe, expect, test } from 'bun:test';

import type { TraceRecord } from '@ontrails/core';

import {
  DEFAULT_MEMORY_SINK_MAX_RECORDS,
  createBoundedMemorySink,
  createMemorySink,
} from '../index.js';

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

  test('records remains a live compatibility view', () => {
    const sink = createMemorySink({ maxRecords: 2 });
    const { records } = sink;

    sink.write(makeRecord('a'));
    sink.write(makeRecord('b'));
    sink.write(makeRecord('c'));

    expect(records.map((record) => record.id)).toEqual(['b', 'c']);
    expect(records).toBe(sink.records);
  });

  test('records sync does not spread retained records into call arguments', () => {
    const recordCount = 100_000;
    const sink = createMemorySink({ maxRecords: recordCount });
    const { records } = sink;

    for (let index = 0; index < recordCount; index += 1) {
      sink.write(makeRecord(String(index)));
    }

    expect(records).toHaveLength(recordCount);
    expect(records.at(0)?.id).toBe('0');
    expect(records.at(-1)?.id).toBe(String(recordCount - 1));
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
