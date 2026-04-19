import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  InternalError,
  NOOP_SINK,
  NotFoundError,
  Result,
  clearTraceSink,
  executeTrail,
  getTraceSink,
  registerTraceSink,
  run,
  signal,
  trail,
  topo,
} from '@ontrails/core';
import { TRACE_CONTEXT_KEY } from '@ontrails/core/internal/tracing';
import type {
  AnyTrail,
  CrossBatchOptions,
  Layer,
  TraceContext,
  TraceRecord,
  TrailContext,
} from '@ontrails/core';
import { z } from 'zod';

import { createMemorySink } from '../memory-sink.js';

/**
 * Intrinsic tracing behaviour is owned by `executeTrail` in `@ontrails/core`
 * since TRL-196. These tests pin the observable contract: every trail
 * execution produces a root `TraceRecord`, and `ctx.trace(label, fn)`
 * produces child span records under it.
 */

const emptyIO = z.object({});
const completedOutput = z.object({ completed: z.boolean() });
const SIGNAL = 'signal';

type Signal = typeof SIGNAL;
type SignalController = ReturnType<typeof Promise.withResolvers<Signal>>;

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

const genericErrTrail = trail('intrinsic.err.generic', {
  blaze: () => Result.err(new Error('boom')),
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

const childTrail = trail('trace.child', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
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

const trailRecord = (
  records: readonly TraceRecord[],
  trailId: string
): TraceRecord => {
  const found = records.find((record) => record.trailId === trailId);
  expect(found).toBeDefined();
  return found as TraceRecord;
};

const requireCross = (
  ctx: TrailContext
): NonNullable<TrailContext['cross']> => {
  expect(ctx.cross).toBeDefined();
  return ctx.cross as NonNullable<TrailContext['cross']>;
};

const recordsOverlap = (left: TraceRecord, right: TraceRecord): boolean => {
  expect(left.endedAt).toBeDefined();
  expect(right.endedAt).toBeDefined();
  return (
    left.startedAt <= (right.endedAt as number) &&
    right.startedAt <= (left.endedAt as number)
  );
};

const createSignalController = (): SignalController =>
  Promise.withResolvers<Signal>();

const waitForSignalPair = async (
  left: Promise<unknown>,
  right: Promise<unknown>
): Promise<void> => {
  await left;
  await right;
};

const createReleasedSignal = (): Promise<Signal> => {
  const controller = createSignalController();
  controller.resolve(SIGNAL);
  return controller.promise;
};

const createBatchCrossParent = (
  id: string,
  children: readonly [AnyTrail, ...AnyTrail[]],
  options?: CrossBatchOptions
) =>
  trail(id, {
    blaze: async (_input, ctx) => {
      const calls = children.map((child) => [child, {}] as const);
      await requireCross(ctx)(calls, options);
      return Result.ok({ completed: true });
    },
    crosses: [...children],
    input: emptyIO,
    output: completedOutput,
  });

const createGatedCrossChild = (
  id: string,
  started: SignalController,
  gate: Promise<unknown>
) =>
  trail(id, {
    blaze: async () => {
      started.resolve(SIGNAL);
      await gate;
      return Result.ok({ ok: true });
    },
    input: emptyIO,
    output: z.object({ ok: z.boolean() }),
    visibility: 'internal',
  });

const createTimedCrossChild = (
  id: string,
  startedIds: string[],
  started: SignalController,
  gate: Promise<unknown>,
  delayMs: number
) =>
  trail(id, {
    blaze: async () => {
      startedIds.push(id);
      started.resolve(SIGNAL);
      await gate;
      await Bun.sleep(delayMs);
      return Result.ok({ id });
    },
    input: emptyIO,
    output: z.object({ id: z.string() }),
    visibility: 'internal',
  });

const createConcurrentCrossBatchScenario = () => {
  const leftStarted = createSignalController();
  const rightStarted = createSignalController();
  const release = createSignalController();
  const left = createGatedCrossChild(
    'trace.cross.concurrent.left',
    leftStarted,
    waitForSignalPair(rightStarted.promise, release.promise)
  );
  const right = createGatedCrossChild(
    'trace.cross.concurrent.right',
    rightStarted,
    waitForSignalPair(leftStarted.promise, release.promise)
  );
  const parent = createBatchCrossParent('trace.cross.concurrent.parent', [
    left,
    right,
  ]);
  const app = topo('trace-cross-concurrent-topo', { left, parent, right });

  return {
    app,
    left,
    parent,
    release,
    right,
    started: waitForSignalPair(leftStarted.promise, rightStarted.promise),
  };
};

const createLimitedCrossBatchChildren = (
  startedIds: string[],
  releaseFirstBatch: Promise<unknown>
) => {
  const slowStarted = createSignalController();
  const fastStarted = createSignalController();
  const queuedStarted = createSignalController();
  const slow = createTimedCrossChild(
    'trace.cross.limited.slow',
    startedIds,
    slowStarted,
    releaseFirstBatch,
    20
  );
  const fast = createTimedCrossChild(
    'trace.cross.limited.fast',
    startedIds,
    fastStarted,
    releaseFirstBatch,
    1
  );
  const queued = createTimedCrossChild(
    'trace.cross.limited.queued',
    startedIds,
    queuedStarted,
    createReleasedSignal(),
    1
  );

  return {
    fast,
    fastStarted,
    queued,
    queuedStarted,
    slow,
    slowStarted,
  };
};

const createLimitedCrossBatchScenario = () => {
  const releaseFirstBatch = createSignalController();
  const startedIds: string[] = [];
  const { fast, fastStarted, queued, queuedStarted, slow, slowStarted } =
    createLimitedCrossBatchChildren(startedIds, releaseFirstBatch.promise);
  const parent = createBatchCrossParent(
    'trace.cross.limited.parent',
    [slow, fast, queued],
    { concurrency: 2 }
  );
  const app = topo('trace-cross-limited-topo', {
    fast,
    parent,
    queued,
    slow,
  });

  return {
    app,
    fast,
    firstBatchStarted: waitForSignalPair(
      slowStarted.promise,
      fastStarted.promise
    ),
    parent,
    queued,
    queuedStarted: queuedStarted.promise,
    releaseFirstBatch,
    slow,
    startedIds,
  };
};

const createParallelSignalFanoutScenario = () => {
  const emitted = signal('trace.signal.parallel', {
    payload: z.object({ id: z.string() }),
  });
  const leftStarted = createSignalController();
  const rightStarted = createSignalController();
  const release = createSignalController();
  const createSignalConsumer = (id: string, started: SignalController) =>
    trail(id, {
      blaze: async (_input, ctx) => {
        await ctx.trace('work', async () => {
          started.resolve(SIGNAL);
          await release.promise;
        });
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      on: [emitted.id],
      output: z.object({ ok: z.boolean() }),
      visibility: 'internal',
    });
  const left = createSignalConsumer('trace.signal.left', leftStarted);
  const right = createSignalConsumer('trace.signal.right', rightStarted);
  const producer = trail('trace.signal.producer', {
    blaze: async (input, ctx) => {
      const fired = await ctx.fire?.(emitted.id, input);
      return (fired as Result<void, Error>).match({
        err: (error) => Result.err(error),
        ok: () => Result.ok({ ok: true }),
      });
    },
    fires: [emitted.id],
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  });
  const app = topo('trace-signal-parallel-topo', {
    emitted,
    left,
    producer,
    right,
  });

  return {
    app,
    left,
    producer,
    release,
    right,
    started: waitForSignalPair(leftStarted.promise, rightStarted.promise),
  };
};

const expectSiblingCrossTrailOverlap = (
  records: readonly TraceRecord[],
  parentTrailId: string,
  leftTrailId: string,
  rightTrailId: string
) => {
  const parentRecord = trailRecord(records, parentTrailId);
  const leftRecord = trailRecord(records, leftTrailId);
  const rightRecord = trailRecord(records, rightTrailId);
  expect(leftRecord.parentId).toBe(parentRecord.id);
  expect(rightRecord.parentId).toBe(parentRecord.id);
  expect(recordsOverlap(leftRecord, rightRecord)).toBe(true);
};

const expectLimitedCrossTrailWaveShape = (
  records: readonly TraceRecord[],
  parentTrailId: string,
  slowTrailId: string,
  fastTrailId: string,
  queuedTrailId: string
) => {
  const parentRecord = trailRecord(records, parentTrailId);
  const slowRecord = trailRecord(records, slowTrailId);
  const fastRecord = trailRecord(records, fastTrailId);
  const queuedRecord = trailRecord(records, queuedTrailId);
  expect(slowRecord.parentId).toBe(parentRecord.id);
  expect(fastRecord.parentId).toBe(parentRecord.id);
  expect(queuedRecord.parentId).toBe(parentRecord.id);
  expect(queuedRecord.startedAt).toBeGreaterThanOrEqual(
    fastRecord.endedAt as number
  );
  expect(recordsOverlap(slowRecord, queuedRecord)).toBe(true);
};

const expectParallelSignalFanoutTraceShape = (
  records: readonly TraceRecord[],
  producerTrailId: string,
  leftTrailId: string,
  rightTrailId: string
) => {
  const producerRecord = trailRecord(records, producerTrailId);
  const leftRecord = trailRecord(records, leftTrailId);
  const rightRecord = trailRecord(records, rightTrailId);
  expect(leftRecord.parentId).toBe(producerRecord.id);
  expect(rightRecord.parentId).toBe(producerRecord.id);
  expect(recordsOverlap(leftRecord, rightRecord)).toBe(true);
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

    test('generic Result.err values are normalized to internal category', async () => {
      await executeTrail(genericErrTrail, {});
      const root = firstTrailRecord(sink.records);
      expect(root.status).toBe('err');
      expect(root.errorCategory).toBe('internal');
    });

    test('unexpected throws are normalized into err records', async () => {
      const result = await executeTrail(throwTrail, {});
      expect(result.isErr()).toBe(true);
      const root = firstTrailRecord(sink.records);
      expect(root.status).toBe('err');
      expect(root.errorCategory).toBe('internal');
    });

    test('layer composition failures still write an err root record', async () => {
      const explodingLayer: Layer = {
        name: 'explode-wrap',
        wrap: () => {
          throw new Error('layer boom');
        },
      };

      const result = await executeTrail(
        okTrail,
        {},
        { layers: [explodingLayer] }
      );

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toBe('layer boom');

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

  describe('parent trace context inheritance', () => {
    test('child trail invoked with a parent TraceContext shares traceId and parents to it', async () => {
      const parent: TraceContext = {
        rootId: 'parent-root',
        sampled: true,
        spanId: 'parent-span',
        traceId: 'parent-trace',
      };
      await executeTrail(
        childTrail,
        {},
        {
          ctx: { extensions: { [TRACE_CONTEXT_KEY]: parent } },
        }
      );
      const child = sink.records
        .filter((r) => r.kind === 'trail')
        .find((r) => r.trailId === 'trace.child');
      expect(child).toBeDefined();
      expect(child?.traceId).toBe('parent-trace');
      expect(child?.rootId).toBe('parent-root');
      expect(child?.parentId).toBe('parent-span');
    });
  });

  describe('cross-trail tracing', () => {
    test('single ctx.cross() produces a child trail record under the parent trail', async () => {
      const crossed = trail('trace.cross.single.child', {
        blaze: () => Result.ok({ ok: true }),
        input: emptyIO,
        output: z.object({ ok: z.boolean() }),
        visibility: 'internal',
      });
      const parent = trail('trace.cross.single.parent', {
        blaze: async (_input, ctx) => {
          const result = await requireCross(ctx)(crossed, {});
          return result.match({
            err: (error) => Result.err(error),
            ok: (value) => Result.ok(value),
          });
        },
        crosses: [crossed],
        input: emptyIO,
        output: z.object({ ok: z.boolean() }),
      });
      const app = topo('trace-cross-single-topo', { crossed, parent });

      await executeTrail(parent, {}, { topo: app });

      const parentRecord = trailRecord(sink.records, parent.id);
      const childRecord = trailRecord(sink.records, crossed.id);
      expect(childRecord.parentId).toBe(parentRecord.id);
      expect(childRecord.rootId).toBe(parentRecord.id);
      expect(childRecord.traceId).toBe(parentRecord.traceId);
    });

    test('batch ctx.cross([...]) produces sibling child trail records with overlapping timings', async () => {
      const scenario = createConcurrentCrossBatchScenario();
      const execution = executeTrail(
        scenario.parent,
        {},
        { topo: scenario.app }
      );
      await scenario.started;
      scenario.release.resolve(SIGNAL);
      await execution;
      expectSiblingCrossTrailOverlap(
        sink.records,
        scenario.parent.id,
        scenario.left.id,
        scenario.right.id
      );
    });

    test('concurrency-limited batch crossings emit a second wave only after a slot frees up', async () => {
      const scenario = createLimitedCrossBatchScenario();
      const execution = executeTrail(
        scenario.parent,
        {},
        { topo: scenario.app }
      );
      await scenario.firstBatchStarted;
      expect(scenario.startedIds).toEqual([scenario.slow.id, scenario.fast.id]);
      scenario.releaseFirstBatch.resolve(SIGNAL);
      await scenario.queuedStarted;
      await execution;

      expectLimitedCrossTrailWaveShape(
        sink.records,
        scenario.parent.id,
        scenario.slow.id,
        scenario.fast.id,
        scenario.queued.id
      );
    });
  });

  describe('signal fan-out tracing', () => {
    test('parallel signal consumers trace as overlapping sibling trails under the producer', async () => {
      const scenario = createParallelSignalFanoutScenario();
      const runPromise = run(scenario.app, scenario.producer.id, {
        id: 'trace-signal-1',
      });
      await scenario.started;
      scenario.release.resolve(SIGNAL);

      const result = await runPromise;
      expect(result.isOk()).toBe(true);
      expectParallelSignalFanoutTraceShape(
        sink.records,
        scenario.producer.id,
        scenario.left.id,
        scenario.right.id
      );
    });
  });

  describe('sink registration', () => {
    test('the default no-op sink does not crash when no sink is registered', async () => {
      clearTraceSink();
      const result = await executeTrail(noSinkTrail, {});
      expect(result.isOk()).toBe(true);
    });

    test('clearTraceSink restores the NOOP_SINK sentinel', () => {
      registerTraceSink({ write: () => 0 });
      clearTraceSink();
      expect(getTraceSink()).toBe(NOOP_SINK);
    });

    test('NOOP_SINK fast path preserves trail results', async () => {
      const tracedNoopSink = { write: () => 0 };

      registerTraceSink(NOOP_SINK);
      const fastPath = await executeTrail(spanOkTrail, {});

      registerTraceSink(tracedNoopSink);
      const traced = await executeTrail(spanOkTrail, {});

      expect(fastPath).toEqual(traced);
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
