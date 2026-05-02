import { afterEach, describe, expect, test } from 'bun:test';

import {
  clearTraceSink,
  registerTraceSink,
  writeActivationTraceRecord,
} from '../internal/tracing';
import type { TraceSink } from '../internal/tracing';

afterEach(() => {
  clearTraceSink();
});

describe('writeActivationTraceRecord', () => {
  test('returns the written record when the sink accepts it', async () => {
    const writes: unknown[] = [];
    const sink: TraceSink = {
      write(record) {
        writes.push(record);
      },
    };
    registerTraceSink(sink);

    const record = await writeActivationTraceRecord(
      'activation.webhook',
      { 'trails.activation.target_trail.id': 'demo' },
      'ok'
    );

    expect(record).toBeDefined();
    expect(writes).toHaveLength(1);
    expect(record?.name).toBe('activation.webhook');
  });

  test('returns undefined when the sink synchronously throws', async () => {
    const sink: TraceSink = {
      write() {
        throw new Error('synchronous sink failure');
      },
    };
    registerTraceSink(sink);

    const record = await writeActivationTraceRecord(
      'activation.webhook',
      { 'trails.activation.target_trail.id': 'demo' },
      'ok'
    );

    // Caller must not adopt the record as a parent trace context when the
    // sink dropped it -- doing so would create a child span that points at
    // an activation record that never reached storage.
    expect(record).toBeUndefined();
  });

  test('returns undefined when the sink asynchronously rejects', async () => {
    const sink: TraceSink = {
      write() {
        return Promise.reject(new Error('async sink failure'));
      },
    };
    registerTraceSink(sink);

    const record = await writeActivationTraceRecord(
      'activation.webhook',
      { 'trails.activation.target_trail.id': 'demo' },
      'ok'
    );

    expect(record).toBeUndefined();
  });

  test('defaults sampled to true on parentless activation records', async () => {
    const writes: unknown[] = [];
    const sink: TraceSink = {
      write(record) {
        writes.push(record);
      },
    };
    registerTraceSink(sink);

    const record = await writeActivationTraceRecord(
      'activation.webhook',
      { 'trails.activation.target_trail.id': 'demo' },
      'ok'
    );

    // Without a parent context, the activation record is the root span. It
    // must carry sampled=true so child trail records (which derive sampled
    // via traceContextFromRecord, defaulting to true) stay consistent with
    // their activation parent. Otherwise filters/exporters that gate on the
    // activation boundary's sampled flag drop the entire trace tree.
    expect(record?.sampled).toBe(true);
    expect(writes).toHaveLength(1);
    const written = writes[0] as { sampled?: boolean };
    expect(written.sampled).toBe(true);
  });

  test('inherits sampled from parent when provided', async () => {
    const writes: unknown[] = [];
    const sink: TraceSink = {
      write(record) {
        writes.push(record);
      },
    };
    registerTraceSink(sink);

    const record = await writeActivationTraceRecord(
      'activation.webhook',
      { 'trails.activation.target_trail.id': 'demo' },
      'ok',
      undefined,
      {
        rootId: 'root-1',
        sampled: false,
        spanId: 'span-1',
        traceId: 'trace-1',
      }
    );

    expect(record?.sampled).toBe(false);
  });
});
