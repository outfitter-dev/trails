import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  InternalError,
  NotFoundError,
  Result,
  clearTraceSink,
  executeTrail,
  registerTraceSink,
  trail,
} from '@ontrails/core';
import type { TraceRecord } from '@ontrails/core';
import { z } from 'zod';

import { createMemorySink } from '../memory-sink.js';

/**
 * Intrinsic tracing behaviour is owned by `executeTrail` in `@ontrails/core`
 * since TRL-196. These tests pin the observable contract: every trail
 * execution produces a root `TraceRecord`, and `ctx.trace(label, fn)`
 * produces child span records under it.
 */

const emptyIO = z.object({});

const okTrail = trail('intrinsic.ok', {
  blaze: () => Result.ok({ value: 1 }),
  input: emptyIO,
  intent: 'read',
  output: z.object({ value: z.number() }),
});

const errTrail = trail('intrinsic.err', {
  blaze: () => Result.err(new NotFoundError('nope')),
  input: emptyIO,
  output: emptyIO,
});

const throwTrail = trail('intrinsic.throw', {
  blaze: () => {
    throw new InternalError('boom');
  },
  input: emptyIO,
  output: emptyIO,
});

const spanOkTrail = trail('intrinsic.span.ok', {
  blaze: async (_input, ctx) => {
    const value = await ctx.trace('inner', () => Promise.resolve(42));
    return Result.ok({ value });
  },
  input: emptyIO,
  output: z.object({ value: z.number() }),
});

const spanErrTrail = trail('intrinsic.span.err', {
  blaze: async (_input, ctx) => {
    try {
      await ctx.trace('doomed', () =>
        Promise.reject(new NotFoundError('missing'))
      );
    } catch (error) {
      return Result.err(error as Error);
    }
    return Result.ok({});
  },
  input: emptyIO,
  output: emptyIO,
});

const spanSiblingsTrail = trail('intrinsic.span.siblings', {
  blaze: async (_input, ctx) => {
    await ctx.trace('a', () => Promise.resolve(1));
    await ctx.trace('b', () => Promise.resolve(2));
    return Result.ok({});
  },
  input: emptyIO,
  output: emptyIO,
});

const noSinkTrail = trail('intrinsic.nosink', {
  blaze: async (_input, ctx) => {
    await ctx.trace('span', () => Promise.resolve(1));
    return Result.ok({});
  },
  input: emptyIO,
  output: emptyIO,
});

const routingTrail = trail('intrinsic.routing', {
  blaze: () => Result.ok({}),
  input: emptyIO,
  output: emptyIO,
});

/** Narrow the first trail-kind record in a sink for assertions. */
const firstTrailRecord = (records: readonly TraceRecord[]): TraceRecord => {
  const found = records.find((r) => r.kind === 'trail');
  expect(found).toBeDefined();
  return found as TraceRecord;
};

/** Narrow the first span-kind record in a sink for assertions. */
const firstSpanRecord = (records: readonly TraceRecord[]): TraceRecord => {
  const found = records.find((r) => r.kind === 'span');
  expect(found).toBeDefined();
  return found as TraceRecord;
};

describe('intrinsic tracing via executeTrail + ctx.trace', () => {
  let sink: ReturnType<typeof createMemorySink>;

  beforeEach(() => {
    sink = createMemorySink();
    registerTraceSink(sink);
  });

  afterEach(() => {
    clearTraceSink();
  });

  describe('root trace records', () => {
    test('executeTrail produces a root trace record on success', async () => {
      const result = await executeTrail(okTrail, {});
      expect(result.isOk()).toBe(true);
      const root = firstTrailRecord(sink.records);
      expect(root.trailId).toBe('intrinsic.ok');
      expect(root.name).toBe('intrinsic.ok');
      expect(root.intent).toBe('read');
      expect(root.status).toBe('ok');
      expect(root.errorCategory).toBeUndefined();
      expect(root.endedAt).toBeDefined();
    });

    test('root record startedAt is not after endedAt', async () => {
      await executeTrail(okTrail, {});
      const root = firstTrailRecord(sink.records);
      expect(root.endedAt).toBeGreaterThanOrEqual(root.startedAt);
    });

    test('executeTrail records err status and category on Result.err', async () => {
      await executeTrail(errTrail, {});
      const root = firstTrailRecord(sink.records);
      expect(root.status).toBe('err');
      expect(root.errorCategory).toBe('not_found');
    });

    test('unexpected throws are normalized into err records', async () => {
      const result = await executeTrail(throwTrail, {});
      expect(result.isErr()).toBe(true);
      const root = firstTrailRecord(sink.records);
      expect(root.status).toBe('err');
      expect(root.errorCategory).toBe('internal');
    });

    test('root record rootId equals its own id', async () => {
      await executeTrail(okTrail, {});
      const root = firstTrailRecord(sink.records);
      expect(root.rootId).toBe(root.id);
    });

    test('root record exposes a non-empty traceId', async () => {
      await executeTrail(okTrail, {});
      const root = firstTrailRecord(sink.records);
      expect(typeof root.traceId).toBe('string');
      expect(root.traceId.length).toBeGreaterThan(0);
    });
  });

  describe('ctx.trace child spans', () => {
    test('ctx.trace produces a child span with matching shape', async () => {
      const result = await executeTrail(spanOkTrail, {});
      expect(result.isOk()).toBe(true);
      const span = firstSpanRecord(sink.records);
      expect(span.name).toBe('inner');
      expect(span.status).toBe('ok');
      expect(span.endedAt).toBeDefined();
    });

    test('child span is parented to the root record', async () => {
      await executeTrail(spanOkTrail, {});
      const span = firstSpanRecord(sink.records);
      const root = firstTrailRecord(sink.records);
      expect(span.traceId).toBe(root.traceId);
      expect(span.rootId).toBe(root.id);
      expect(span.parentId).toBe(root.id);
    });

    test('ctx.trace records error on throw and rethrows', async () => {
      await executeTrail(spanErrTrail, {});
      const span = firstSpanRecord(sink.records);
      expect(span.status).toBe('err');
      expect(span.errorCategory).toBe('not_found');
    });

    test('multiple ctx.trace calls produce sibling spans under the root', async () => {
      await executeTrail(spanSiblingsTrail, {});
      const spans = sink.records.filter((r) => r.kind === 'span');
      expect(spans.map((s) => s.name).toSorted()).toEqual(['a', 'b']);
      const root = firstTrailRecord(sink.records);
      const parentIds = spans.map((s) => s.parentId);
      expect(parentIds.every((id) => id === root.id)).toBe(true);
    });
  });

  describe('sink registration', () => {
    test('the default no-op sink does not crash when no sink is registered', async () => {
      clearTraceSink();
      const result = await executeTrail(noSinkTrail, {});
      expect(result.isOk()).toBe(true);
    });

    test('registerTraceSink routes subsequent executions to the new sink', async () => {
      const firstSink = createMemorySink();
      const secondSink = createMemorySink();
      registerTraceSink(firstSink);
      await executeTrail(routingTrail, {});
      registerTraceSink(secondSink);
      await executeTrail(routingTrail, {});
      expect(firstSink.records).toHaveLength(1);
      expect(secondSink.records).toHaveLength(1);
    });
  });
});
