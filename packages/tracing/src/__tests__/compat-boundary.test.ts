import { describe, expect, test } from 'bun:test';

import {
  TRACE_CONTEXT_KEY as CORE_TRACE_CONTEXT_KEY,
  clearTraceSink as clearCoreTraceSink,
  createActivationTraceRecord as createCoreActivationTraceRecord,
  createSignalTraceRecord as createCoreSignalTraceRecord,
  createTraceRecord as createCoreTraceRecord,
  getTraceContext as getCoreTraceContext,
  getTraceSink as getCoreTraceSink,
  NOOP_SINK as CORE_NOOP_SINK,
  registerTraceSink as registerCoreTraceSink,
  traceContextFromRecord as traceCoreContextFromRecord,
  writeActivationTraceRecord as writeCoreActivationTraceRecord,
  writeSignalTraceRecord as writeCoreSignalTraceRecord,
} from '@ontrails/core';
import type { TraceRecord } from '@ontrails/core';
import {
  DEFAULT_MEMORY_SINK_MAX_RECORDS as OBSERVE_MEMORY_SINK_MAX_RECORDS,
  createMemorySink as createObserveMemorySink,
} from '@ontrails/observe';

import {
  NOOP_SINK,
  TRACE_CONTEXT_KEY,
  clearTraceSink,
  createActivationTraceRecord,
  createMemorySink,
  createSignalTraceRecord,
  createTraceRecord,
  getTraceContext,
  getTraceSink,
  registerTraceSink,
  traceContextFromRecord,
  writeActivationTraceRecord,
  writeSignalTraceRecord,
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

describe('@ontrails/tracing compatibility boundary', () => {
  test('re-exports core tracing primitives without wrapping them', () => {
    expect(TRACE_CONTEXT_KEY).toBe(CORE_TRACE_CONTEXT_KEY);
    expect(clearTraceSink).toBe(clearCoreTraceSink);
    expect(createActivationTraceRecord).toBe(createCoreActivationTraceRecord);
    expect(createSignalTraceRecord).toBe(createCoreSignalTraceRecord);
    expect(createTraceRecord).toBe(createCoreTraceRecord);
    expect(getTraceContext).toBe(getCoreTraceContext);
    expect(getTraceSink).toBe(getCoreTraceSink);
    expect(NOOP_SINK).toBe(CORE_NOOP_SINK);
    expect(registerTraceSink).toBe(registerCoreTraceSink);
    expect(traceContextFromRecord).toBe(traceCoreContextFromRecord);
    expect(writeActivationTraceRecord).toBe(writeCoreActivationTraceRecord);
    expect(writeSignalTraceRecord).toBe(writeCoreSignalTraceRecord);
  });

  test('keeps memory sink compatibility while observe owns retention behavior', () => {
    const observeSink = createObserveMemorySink({ maxRecords: 2 });
    const tracingSink = createMemorySink({ maxRecords: 2 });

    observeSink.write(makeRecord('a'));
    observeSink.write(makeRecord('b'));
    observeSink.write(makeRecord('c'));
    tracingSink.write(makeRecord('a'));
    tracingSink.write(makeRecord('b'));
    tracingSink.write(makeRecord('c'));

    const observeSnapshot = observeSink.records();
    const tracingSnapshot = tracingSink.snapshot();

    observeSink.write(makeRecord('d'));
    tracingSink.write(makeRecord('d'));

    expect(OBSERVE_MEMORY_SINK_MAX_RECORDS).toBe(1000);
    expect(tracingSink.maxRecords).toBe(observeSink.maxRecords);
    expect(tracingSink.droppedCount).toBe(observeSink.droppedCount);
    expect(tracingSnapshot.map((record) => record.id)).toEqual(['b', 'c']);
    expect(observeSnapshot.map((record) => record.id)).toEqual(['b', 'c']);
    expect(tracingSink.records.map((record) => record.id)).toEqual(['c', 'd']);
    expect(observeSink.records().map((record) => record.id)).toEqual([
      'c',
      'd',
    ]);

    observeSink.clear();
    tracingSink.clear();

    expect(tracingSink.records).toEqual([]);
    expect(observeSink.records()).toEqual([]);
    expect(tracingSink.droppedCount).toBe(0);
    expect(observeSink.droppedCount).toBe(0);
  });
});
