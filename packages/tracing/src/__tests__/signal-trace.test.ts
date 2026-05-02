import { afterEach, describe, expect, test } from 'bun:test';
import {
  TRACE_CONTEXT_KEY,
  clearTraceSink,
  registerTraceSink,
} from '@ontrails/core';
import type { TraceContext, TraceRecord, TraceSink } from '@ontrails/core';

import {
  createSignalTraceRecord,
  writeSignalTraceRecord,
} from '../signal-trace.js';

const parent: TraceContext = {
  rootId: 'root-1',
  sampled: true,
  spanId: 'span-1',
  traceId: 'trace-1',
};

afterEach(() => {
  clearTraceSink();
});

describe('signal trace helpers', () => {
  test('creates signal lifecycle records from a parent trace context', () => {
    const record = createSignalTraceRecord(parent, 'signal.fired', {
      signalId: 'order.placed',
    });

    expect(record).toMatchObject({
      attrs: {
        signalId: 'order.placed',
      },
      kind: 'signal',
      name: 'signal.fired',
      parentId: 'span-1',
      rootId: 'root-1',
      status: 'ok',
      traceId: 'trace-1',
    });
  });

  test('accepts core predicate lifecycle record names', () => {
    const record = createSignalTraceRecord(
      parent,
      'signal.handler.predicate_skipped',
      {
        handlerTrailId: 'notify.email',
      }
    );

    expect(record.name).toBe('signal.handler.predicate_skipped');
  });

  test('writes signal lifecycle records through the core trace sink registry', async () => {
    const records: TraceRecord[] = [];
    const sink: TraceSink = {
      write(record) {
        records.push(record);
      },
    };
    registerTraceSink(sink);

    await writeSignalTraceRecord(
      {
        extensions: {
          [TRACE_CONTEXT_KEY]: parent,
        },
      },
      'signal.handler.failed',
      { handlerTrailId: 'notify.email' },
      'err',
      'internal'
    );

    expect(records).toEqual([
      expect.objectContaining({
        attrs: {
          handlerTrailId: 'notify.email',
        },
        endedAt: expect.any(Number),
        errorCategory: 'internal',
        kind: 'signal',
        name: 'signal.handler.failed',
        parentId: 'span-1',
        status: 'err',
        traceId: 'trace-1',
      }),
    ]);
  });
});
