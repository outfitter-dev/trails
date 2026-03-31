import { describe, expect, test } from 'bun:test';

import { createMemorySink } from '../memory-sink.js';
import { TRACE_CONTEXT_KEY } from '../trace-context.js';
import type { TraceContext } from '../trace-context.js';
import { createTracksApi } from '../tracks-api.js';

/** Build a stub ctx with trace context in extensions. */
const makeCtx = (
  overrides?: Partial<TraceContext>
): { readonly extensions: Readonly<Record<string, unknown>> } => {
  const trace: TraceContext = {
    rootId: 'root-span-id',
    sampled: true,
    spanId: 'parent-span-id',
    traceId: 'test-trace-id',
    ...overrides,
  };

  return { extensions: { [TRACE_CONTEXT_KEY]: trace } };
};

describe('createTracksApi', () => {
  describe('span()', () => {
    test('creates a child record in the sink', async () => {
      const sink = createMemorySink();
      const { api } = createTracksApi(makeCtx(), sink);

      await api.span('my-span', () => 'done');

      expect(sink.records).toHaveLength(1);
      const [record] = sink.records;
      expect(record?.kind).toBe('span');
      expect(record?.name).toBe('my-span');
      expect(record?.traceId).toBe('test-trace-id');
      expect(record?.parentId).toBe('parent-span-id');
      expect(record?.rootId).toBe('root-span-id');
    });

    test('returns the callback result', async () => {
      const sink = createMemorySink();
      const { api } = createTracksApi(makeCtx(), sink);

      const result = await api.span('op', () => 42);

      expect(result).toBe(42);
    });

    test('returns the async callback result', async () => {
      const sink = createMemorySink();
      const { api } = createTracksApi(makeCtx(), sink);

      const result = await api.span('async-op', () =>
        Promise.resolve('async-value')
      );

      expect(result).toBe('async-value');
    });

    test('times the execution (endedAt >= startedAt)', async () => {
      const sink = createMemorySink();
      const { api } = createTracksApi(makeCtx(), sink);

      await api.span('timed', () => 'ok');

      const [record] = sink.records;
      expect(record?.startedAt).toBeNumber();
      expect(record?.endedAt).toBeNumber();
      expect(Number(record?.endedAt)).toBeGreaterThanOrEqual(
        Number(record?.startedAt)
      );
    });

    test('marks record as err when callback throws', async () => {
      const sink = createMemorySink();
      const { api } = createTracksApi(makeCtx(), sink);

      try {
        await api.span('failing', () => {
          throw new Error('boom');
        });
      } catch {
        // expected
      }

      expect(sink.records).toHaveLength(1);
      expect(sink.records[0]?.status).toBe('err');
    });

    test('re-throws the callback error after recording', async () => {
      const sink = createMemorySink();
      const { api } = createTracksApi(makeCtx(), sink);

      await expect(
        api.span('failing', () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');

      expect(sink.records).toHaveLength(1);
    });

    test('multiple spans create independent records', async () => {
      const sink = createMemorySink();
      const { api } = createTracksApi(makeCtx(), sink);

      await api.span('first', () => 1);
      await api.span('second', () => 2);

      expect(sink.records).toHaveLength(2);
      expect(sink.records[0]?.name).toBe('first');
      expect(sink.records[1]?.name).toBe('second');
      expect(sink.records[0]?.id).not.toBe(sink.records[1]?.id);
    });

    test('skips sink writes when trace sampling is disabled', async () => {
      const sink = createMemorySink();
      const { api } = createTracksApi(makeCtx({ sampled: false }), sink);

      const result = await api.span('unsampled', () => 'done');

      expect(result).toBe('done');
      expect(sink.records).toHaveLength(0);
    });
  });

  describe('annotate()', () => {
    test('collects attributes without throwing', () => {
      const sink = createMemorySink();
      const { api } = createTracksApi(makeCtx(), sink);

      expect(() => api.annotate({ count: 42, key: 'value' })).not.toThrow();
    });

    test('getAnnotations returns merged attrs from annotate calls', () => {
      const sink = createMemorySink();
      const { api, getAnnotations } = createTracksApi(makeCtx(), sink);

      api.annotate({ first: 1 });
      api.annotate({ second: 2 });

      expect(getAnnotations()).toEqual({ first: 1, second: 2 });
    });

    test('getAnnotations returns empty object when no annotations', () => {
      const sink = createMemorySink();
      const { getAnnotations } = createTracksApi(makeCtx(), sink);

      expect(getAnnotations()).toEqual({});
    });

    test('later annotations override earlier ones with same key', () => {
      const sink = createMemorySink();
      const { api, getAnnotations } = createTracksApi(makeCtx(), sink);

      api.annotate({ key: 'old' });
      api.annotate({ key: 'new' });

      expect(getAnnotations()).toEqual({ key: 'new' });
    });
  });
});
