/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import type { ActivationProvenance } from '../activation-provenance';
import { createFireFn } from '../fire';
import { clearTraceSink, registerTraceSink } from '../internal/tracing';
import type { TraceRecord, TraceSink } from '../internal/tracing';
import type { Layer } from '../layer';
import { Result } from '../result';
import { run } from '../run';
import {
  SIGNAL_DIAGNOSTICS_SINK_KEY,
  SIGNAL_DIAGNOSTICS_STRICT_MODE_KEY,
} from '../signal-diagnostics';
import type { SignalDiagnostic } from '../signal-diagnostics';
import { signal } from '../signal';
import type { Signal } from '../signal';
import { topo } from '../topo';
import { trail } from '../trail';
import type { Logger, TrailContext } from '../types';

const noopLogger: Logger = {
  child() {
    return noopLogger;
  },
  debug() {
    // noop
  },
  error() {
    // noop
  },
  fatal() {
    // noop
  },
  info() {
    // noop
  },
  trace() {
    // noop
  },
  warn() {
    // noop
  },
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const orderPlaced = signal('order.placed', {
  payload: z.object({ orderId: z.string(), total: z.number() }),
});

// Mutable capture box for assertions. Each test resets it.
interface Capture {
  invocations: { trailId: string; payload: unknown }[];
}
const createCapture = (): Capture => ({ invocations: [] });

const makeConsumer = (
  id: string,
  capture: Capture,
  behavior: 'ok' | 'err' = 'ok'
) =>
  trail(id, {
    blaze: (input) => {
      capture.invocations.push({ payload: input, trailId: id });
      if (behavior === 'err') {
        return Result.err(new Error(`${id} failed`));
      }
      return Result.ok({ received: input });
    },
    input: z.object({ orderId: z.string(), total: z.number() }),
    on: ['order.placed'],
  });

const makeWhereConsumer = (
  id: string,
  capture: Capture,
  where: (payload: {
    orderId: string;
    total: number;
  }) => boolean | Promise<boolean>
) =>
  trail(id, {
    blaze: (input) => {
      capture.invocations.push({ payload: input, trailId: id });
      return Result.ok({ received: input });
    },
    input: z.object({ orderId: z.string(), total: z.number() }),
    on: [{ source: orderPlaced, where }],
  });

const makeProducer = (fireCapture: { fired?: boolean }) =>
  trail('order.create', {
    blaze: async (input, ctx) => {
      await ctx.fire?.(orderPlaced, {
        orderId: input.orderId,
        total: input.total,
      });
      fireCapture.fired = true;
      return Result.ok({ ok: true });
    },
    fires: ['order.placed'],
    input: z.object({ orderId: z.string(), total: z.number() }),
  });

const READY = 'ready';

type Ready = typeof READY;
type ReadyGate = ReturnType<typeof Promise.withResolvers<Ready>>;

const createReadyGate = (): ReadyGate => Promise.withResolvers<Ready>();

const waitForReadyPair = async (
  left: Promise<Ready>,
  right: Promise<Ready>
): Promise<'started'> => {
  await left;
  await right;
  return 'started';
};

const observedConsumerIds = (capture: Capture): string[] =>
  capture.invocations.map((entry) => entry.trailId).toSorted();

const cyclePayload = z.object({ id: z.string() });

const loopA = signal('loop.a', { payload: cyclePayload });
const loopB = signal('loop.b', { payload: cyclePayload });

interface CycleLogEvent {
  fireStack?: unknown;
  level: 'debug' | 'warn';
  message: string;
  signalId?: unknown;
}

const createCycleLogger = (events: CycleLogEvent[]): Logger => ({
  child() {
    return this;
  },
  debug(message, data) {
    events.push({
      fireStack: data?.fireStack,
      level: 'debug',
      message,
      signalId: data?.signalId,
    });
  },
  error() {
    // noop
  },
  fatal() {
    // noop
  },
  info() {
    // noop
  },
  trace() {
    // noop
  },
  warn(message, data) {
    events.push({
      fireStack: data?.fireStack,
      level: 'warn',
      message,
      signalId: data?.signalId,
    });
  },
});

const cycleEventsAtLevel = (
  events: readonly CycleLogEvent[],
  level: CycleLogEvent['level']
): CycleLogEvent[] => events.filter((event) => event.level === level);

const expectCycleSuppressionLogs = (
  events: readonly CycleLogEvent[],
  signalId: string,
  fireStack: readonly string[]
): void => {
  expect(cycleEventsAtLevel(events, 'debug')).toEqual([
    {
      fireStack,
      level: 'debug',
      message: 'Signal fan-out suppressed due to cycle',
      signalId,
    },
  ]);
  expect(cycleEventsAtLevel(events, 'warn')).toEqual([
    {
      fireStack,
      level: 'warn',
      message: 'Signal cycle detected — skipping re-entrant fire',
      signalId,
    },
  ]);
};

const expectNoCycleSuppressionDebugLogs = (
  events: readonly CycleLogEvent[]
): void => {
  expect(cycleEventsAtLevel(events, 'debug')).toEqual([]);
};

const createWarningLogger = (
  warnings: {
    consumerId?: unknown;
    message: string;
    signalId?: unknown;
  }[]
): Logger => ({
  child() {
    return this;
  },
  debug() {
    // noop
  },
  error() {
    // noop
  },
  fatal() {
    // noop
  },
  info() {
    // noop
  },
  trace() {
    // noop
  },
  warn(message, data) {
    warnings.push({
      consumerId: data?.consumerId,
      message,
      signalId: data?.signalId,
    });
  },
});

interface WarningEvent {
  consumerId?: unknown;
  message: string;
  signalId?: unknown;
}

const createBlockingConsumer = (
  id: string,
  started: ReadyGate,
  release: Promise<Ready>
) =>
  trail(id, {
    blaze: async () => {
      started.resolve(READY);
      await release;
      return Result.ok({ ok: true });
    },
    input: z.object({ orderId: z.string(), total: z.number() }),
    on: ['order.placed'],
    output: z.object({ ok: z.boolean() }),
  });

const createIsolatedConsumer = (
  id: string,
  value: string,
  started: ReadyGate,
  release: Promise<Ready>,
  seen: Map<string, string>
) =>
  trail(id, {
    blaze: async (_input, ctx) => {
      const extensions = ctx.extensions as Record<string, unknown>;
      extensions.currentConsumer = value;
      started.resolve(READY);
      await release;
      seen.set(id, extensions.currentConsumer as string);
      return Result.ok({ consumer: extensions.currentConsumer });
    },
    input: z.object({ orderId: z.string(), total: z.number() }),
    on: ['order.placed'],
    output: z.object({ consumer: z.unknown() }),
  });

const createCycleConsumer = (
  id: string,
  signalId: 'loop.a' | 'loop.b',
  nextSignal: typeof loopA | typeof loopB,
  invocations: string[]
) =>
  trail(id, {
    blaze: async (input, ctx) => {
      invocations.push(signalId === 'loop.a' ? 'a' : 'b');
      await ctx.fire?.(nextSignal, { id: input.id });
      return Result.ok({ ok: true });
    },
    fires: [nextSignal],
    input: cyclePayload,
    on: [signalId],
  });

const createErrorIsolationScenario = () => {
  const capture = createCapture();
  const warnings: WarningEvent[] = [];
  const fireBox: { fired?: boolean } = {};
  const app = topo('fire-err', {
    failingConsumer: makeConsumer('notify.broken', capture, 'err'),
    healthyConsumer: makeConsumer('notify.email', capture),
    orderPlaced,
    producer: makeProducer(fireBox),
  });

  return {
    app,
    capture,
    fireBox,
    warnings,
  };
};

const expectConsumerFailureWarning = (warnings: WarningEvent[]): void => {
  expect(warnings).toEqual([
    {
      consumerId: 'notify.broken',
      message: 'Signal consumer failed',
      signalId: 'order.placed',
    },
  ]);
};

const createParallelStartScenario = () => {
  const leftStarted = createReadyGate();
  const rightStarted = createReadyGate();
  const release = createReadyGate();
  const app = topo('fire-parallel-start', {
    consumerA: createBlockingConsumer(
      'notify.email',
      leftStarted,
      release.promise
    ),
    consumerB: createBlockingConsumer(
      'notify.slack',
      rightStarted,
      release.promise
    ),
    orderPlaced,
    producer: makeProducer({}),
  });

  return {
    app,
    leftStarted,
    release,
    rightStarted,
  };
};

const createDispatchInitiationScenario = () => {
  const fireReturned = createReadyGate();
  const release = createReadyGate();
  const state = { consumerCompleted: false };
  const consumer = trail('notify.blocking', {
    blaze: async () => {
      await release.promise;
      state.consumerCompleted = true;
      return Result.ok({ ok: true });
    },
    input: z.object({ orderId: z.string(), total: z.number() }),
    on: ['order.placed'],
    output: z.object({ ok: z.boolean() }),
  });
  const producer = trail('order.create', {
    blaze: async (input, ctx) => {
      await ctx.fire?.(orderPlaced, {
        orderId: input.orderId,
        total: input.total,
      });
      fireReturned.resolve(READY);
      return Result.ok({ ok: true });
    },
    fires: ['order.placed'],
    input: z.object({ orderId: z.string(), total: z.number() }),
  });
  const app = topo('fire-dispatch-initiated', {
    consumer,
    orderPlaced,
    producer,
  });
  return { app, fireReturned, release, state };
};

const waitForConsumersToStart = async (
  left: ReadyGate,
  right: ReadyGate
): Promise<'started'> =>
  // Sequential fan-out would deadlock here: consumerA resolves `left` then
  // blocks on `release`, which only resolves after both consumers have
  // started. The test runner's own timeout catches the regression without
  // needing a wall-clock timer that flakes under CI load.
  await waitForReadyPair(left.promise, right.promise);

const createContextIsolationScenario = () => {
  const leftStarted = createReadyGate();
  const rightStarted = createReadyGate();
  const release = createReadyGate();
  const seen = new Map<string, string>();
  const app = topo('fire-context-isolation', {
    consumerA: createIsolatedConsumer(
      'notify.email',
      'email',
      leftStarted,
      release.promise,
      seen
    ),
    consumerB: createIsolatedConsumer(
      'notify.slack',
      'slack',
      rightStarted,
      release.promise,
      seen
    ),
    orderPlaced,
    producer: makeProducer({}),
  });

  return {
    app,
    leftStarted,
    release,
    rightStarted,
    seen,
  };
};

const createCycleScenario = (invocations: string[]) =>
  topo('fire-cycle', {
    consumerA: createCycleConsumer(
      'loop.consumer.a',
      'loop.a',
      loopB,
      invocations
    ),
    consumerB: createCycleConsumer(
      'loop.consumer.b',
      'loop.b',
      loopA,
      invocations
    ),
    loopA,
    loopB,
    producer: trail('loop.producer', {
      blaze: async (input, ctx) => {
        await ctx.fire?.(loopA, { id: input.id });
        return Result.ok({ ok: true });
      },
      fires: [loopA],
      input: cyclePayload,
    }),
  });

const createDepthChainScenario = (chainLength: number) => {
  const chainPayload = z.object({ n: z.number() });
  const signals = Array.from({ length: chainLength }, (_, i) =>
    signal(`chain.${i}`, { payload: chainPayload })
  );
  const [firstSignal] = signals;
  const consumers = Object.fromEntries(
    signals.slice(0, -1).map((sig, i) => [
      `consumer${i}`,
      trail(`chain.consumer.${i}`, {
        blaze: async (_input, ctx) => {
          const next = signals[i + 1];
          if (next !== undefined) {
            await ctx.fire?.(next, { n: i + 1 });
          }
          return Result.ok({ step: i });
        },
        fires: signals[i + 1] === undefined ? [] : [signals[i + 1]],
        input: chainPayload,
        on: [sig.id],
      }),
    ])
  );
  const signalEntries = Object.fromEntries(
    signals.map((s) => [s.id.replace('.', '_'), s])
  );
  return {
    app: topo('fire-depth', {
      ...consumers,
      ...signalEntries,
      producer: trail('chain.start', {
        blaze: async (input: { n: number }, ctx) => {
          if (firstSignal !== undefined) {
            await ctx.fire?.(firstSignal, input);
          }
          return Result.ok({ started: true });
        },
        fires: firstSignal === undefined ? [] : [firstSignal],
        input: chainPayload,
      }),
    }),
  };
};

const createCapturingSink = (records: TraceRecord[]): TraceSink => ({
  write(record) {
    records.push(record);
  },
});

const createPayloadWithThrowingGetter = (): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  Object.defineProperty(payload, 'secret', {
    enumerable: true,
    get() {
      throw new Error('payload getter exploded');
    },
  });
  return payload;
};

const createThrowingPayloadScenario = () => {
  const fragileSignal = signal('fragile.payload', { payload: z.any() });
  const invocations: unknown[] = [];
  const consumer = trail('fragile.consumer', {
    blaze: (input) => {
      invocations.push(input);
      return Result.ok({ ok: true });
    },
    input: z.any(),
    on: [fragileSignal.id],
  });
  const producer = trail('fragile.producer', {
    blaze: async (_input, ctx) => {
      await ctx.fire?.(fragileSignal, createPayloadWithThrowingGetter());
      return Result.ok({ ok: true });
    },
    fires: [fragileSignal],
    input: z.object({}),
  });
  return {
    app: topo('fragile-payload-summary', {
      consumer,
      fragileSignal,
      producer,
    }),
    invocations,
  };
};

const createTraceShapeScenario = () => {
  const leftStarted = createReadyGate();
  const rightStarted = createReadyGate();
  const release = createReadyGate();
  const app = topo('fire-trace-shape', {
    consumerA: createBlockingConsumer(
      'notify.email',
      leftStarted,
      release.promise
    ),
    consumerB: createBlockingConsumer(
      'notify.slack',
      rightStarted,
      release.promise
    ),
    orderPlaced,
    producer: makeProducer({}),
  });
  return { app, leftStarted, release, rightStarted };
};

const runTraceShapeScenario = async (
  scenario: ReturnType<typeof createTraceShapeScenario>
) => {
  const runPromise = run(scenario.app, 'order.create', {
    orderId: 'o-trace',
    total: 7,
  });
  // Both consumers must enter before either completes — this proves parallel
  // fan-out. Sequential fan-out would deadlock here.
  await waitForReadyPair(
    scenario.leftStarted.promise,
    scenario.rightStarted.promise
  );
  scenario.release.resolve(READY);
  return await runPromise;
};

const findTrailRecord = (
  records: readonly TraceRecord[],
  trailId: string
): TraceRecord => {
  const record = records.find(
    (entry) => entry.kind === 'trail' && entry.trailId === trailId
  );
  if (!record) {
    throw new Error(`Expected trail trace record for "${trailId}"`);
  }
  return record;
};

const expectSiblingParentage = (
  producer: TraceRecord,
  left: TraceRecord,
  right: TraceRecord
): void => {
  expect(left.parentId).toBe(producer.id);
  expect(right.parentId).toBe(producer.id);
  expect(left.traceId).toBe(producer.traceId);
  expect(right.traceId).toBe(producer.traceId);
  expect(left.rootId).toBe(producer.rootId);
  expect(right.rootId).toBe(producer.rootId);
};

const expectSiblingIdentity = (
  producer: TraceRecord,
  left: TraceRecord,
  right: TraceRecord
): void => {
  expect(left.id).not.toBe(right.id);
  expect(left.id).not.toBe(producer.id);
  expect(right.id).not.toBe(producer.id);
  expect(left.status).toBe('ok');
  expect(right.status).toBe('ok');
};

const expectSiblingOverlap = (left: TraceRecord, right: TraceRecord): void => {
  const leftEnd = left.endedAt;
  const rightEnd = right.endedAt;
  if (leftEnd === undefined || rightEnd === undefined) {
    throw new Error('Expected both sibling records to have completed timings');
  }
  // Overlap means each span ended after the other started — i.e. they were
  // both in-flight at some point. Sequential execution would fail this.
  expect(leftEnd).toBeGreaterThanOrEqual(right.startedAt);
  expect(rightEnd).toBeGreaterThanOrEqual(left.startedAt);
};

const expectSiblingTraceShape = (
  records: readonly TraceRecord[],
  ids: {
    producerTrailId: string;
    leftTrailId: string;
    rightTrailId: string;
  }
): void => {
  const producer = findTrailRecord(records, ids.producerTrailId);
  const left = findTrailRecord(records, ids.leftTrailId);
  const right = findTrailRecord(records, ids.rightTrailId);
  expectSiblingParentage(producer, left, right);
  expectSiblingIdentity(producer, left, right);
  expectSiblingOverlap(left, right);
};

const createConsumerCrossScenario = () => {
  const crossTarget = trail('notify.audit', {
    blaze: () => Result.ok({ audited: true }),
    input: z.object({ orderId: z.string() }),
    output: z.object({ audited: z.boolean() }),
  });
  const consumer = trail('notify.email', {
    blaze: async (input, ctx) => {
      const crossFn = ctx.cross as NonNullable<typeof ctx.cross>;
      return (await crossFn(crossTarget, {
        orderId: input.orderId,
      })) as Result<unknown, Error>;
    },
    crosses: [crossTarget],
    input: z.object({ orderId: z.string(), total: z.number() }),
    on: ['order.placed'],
  });
  const fireBox: { fired?: boolean } = {};
  return topo('fire-consumer-cross-attribution', {
    consumer,
    crossTarget,
    orderPlaced,
    producer: makeProducer(fireBox),
  });
};

const expectConsumerCrossAttribution = (
  records: readonly TraceRecord[]
): void => {
  const producerRecord = findTrailRecord(records, 'order.create');
  const consumerRecord = findTrailRecord(records, 'notify.email');
  const crossRecord = findTrailRecord(records, 'notify.audit');
  // The consumer span parents the crossed call — NOT the producer.
  // Before the forkCtx fix, the consumer inherited the producer's
  // `cross` closure, which attributed the crossed span to the
  // producer's scope.
  expect(crossRecord.parentId).toBe(consumerRecord.id);
  expect(crossRecord.parentId).not.toBe(producerRecord.id);
  expect(crossRecord.traceId).toBe(producerRecord.traceId);
};

const signalTraceRecords = (records: readonly TraceRecord[]): TraceRecord[] =>
  records.filter((record) => record.kind === 'signal');

const findSignalTraceRecord = (
  records: readonly TraceRecord[],
  name: string,
  handlerTrailId?: string
): TraceRecord => {
  const record = signalTraceRecords(records).find(
    (entry) =>
      entry.name === name &&
      (handlerTrailId === undefined ||
        entry.attrs['trails.signal.handler_trail.id'] === handlerTrailId)
  );
  if (!record) {
    throw new Error(`Expected signal trace record "${name}"`);
  }
  return record;
};

const expectSignalRecordParentedToProducer = (
  record: TraceRecord,
  producer: TraceRecord
): void => {
  expect(record.parentId).toBe(producer.id);
  expect(record.rootId).toBe(producer.rootId);
  expect(record.traceId).toBe(producer.traceId);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fire', () => {
  describe('fan-out', () => {
    test('invokes every consumer with validated payload', async () => {
      const capture = createCapture();
      const fireBox: { fired?: boolean } = {};
      const app = topo('fire-test', {
        consumerA: makeConsumer('notify.email', capture),
        consumerB: makeConsumer('notify.slack', capture),
        orderPlaced,
        producer: makeProducer(fireBox),
      });
      const result = await run(app, 'order.create', {
        orderId: 'o-1',
        total: 42,
      });
      expect(result.isOk()).toBe(true);
      expect(fireBox.fired).toBe(true);
      expect(capture.invocations).toHaveLength(2);
      expect(capture.invocations.map((i) => i.trailId).toSorted()).toEqual([
        'notify.email',
        'notify.slack',
      ]);
      expect(capture.invocations[0]?.payload).toEqual({
        orderId: 'o-1',
        total: 42,
      });
      expect(capture.invocations[1]?.payload).toEqual({
        orderId: 'o-1',
        total: 42,
      });
    });

    test('no-consumer fan-out resolves without producer-facing Result plumbing', async () => {
      const fireBox: { fired?: boolean } = {};
      const producer = makeProducer(fireBox);
      const app = topo('fire-empty', { orderPlaced, producer });

      const result = await run(app, 'order.create', {
        orderId: 'o-2',
        total: 0,
      });

      expect(result.isOk()).toBe(true);
      expect(fireBox.fired).toBe(true);
    });

    test('ctx.fire resolves after dispatch is initiated, not after consumers complete', async () => {
      const scenario = createDispatchInitiationScenario();
      const runPromise = run(scenario.app, 'order.create', {
        orderId: 'o-dispatch',
        total: 1,
      });

      await scenario.fireReturned.promise;
      expect(scenario.state.consumerCompleted).toBe(false);

      scenario.release.resolve(READY);
      const result = await runPromise;

      expect(result.isOk()).toBe(true);
      expect(scenario.state.consumerCompleted).toBe(true);
    });
    test('object-form where predicates match or skip only their consumer trail', async () => {
      const capture = createCapture();
      const app = topo('fire-where-match-skip', {
        matched: makeWhereConsumer(
          'notify.large-order',
          capture,
          async (payload) => payload.total > 10
        ),
        orderPlaced,
        plain: makeConsumer('notify.audit', capture),
        producer: makeProducer({}),
        skipped: makeWhereConsumer(
          'notify.huge-order',
          capture,
          (payload) => payload.total > 100
        ),
      });

      const result = await run(app, 'order.create', {
        orderId: 'o-where',
        total: 42,
      });

      expect(result.isOk()).toBe(true);
      expect(observedConsumerIds(capture)).toEqual([
        'notify.audit',
        'notify.large-order',
      ]);
    });

    test('duplicate signal activation entries dispatch one consumer edge', async () => {
      const capture = createCapture();
      const consumer = trail('notify.dedupe', {
        blaze: (input) => {
          capture.invocations.push({
            payload: input,
            trailId: 'notify.dedupe',
          });
          return Result.ok({ received: input });
        },
        input: z.object({ orderId: z.string(), total: z.number() }),
        on: [
          'order.placed',
          {
            source: orderPlaced,
            where: () => true,
          },
        ],
      });
      const app = topo('fire-dedupe-activation-edge', {
        consumer,
        orderPlaced,
        producer: makeProducer({}),
      });

      const result = await run(app, 'order.create', {
        orderId: 'o-dedupe',
        total: 42,
      });

      expect(result.isOk()).toBe(true);
      expect(capture.invocations).toHaveLength(1);
      expect(capture.invocations[0]?.trailId).toBe('notify.dedupe');
    });

    test('duplicate guarded signal entries match when any predicate matches', async () => {
      const capture = createCapture();
      const consumer = trail('notify.guarded-dedupe', {
        blaze: (input) => {
          capture.invocations.push({
            payload: input,
            trailId: 'notify.guarded-dedupe',
          });
          return Result.ok({ received: input });
        },
        input: z.object({ orderId: z.string(), total: z.number() }),
        on: [
          {
            source: orderPlaced,
            where: (payload) => payload.total > 100,
          },
          {
            source: orderPlaced,
            where: (payload) => payload.total > 10,
          },
        ],
      });
      const app = topo('fire-guarded-dedupe-activation-edge', {
        consumer,
        orderPlaced,
        producer: makeProducer({}),
      });

      const result = await run(app, 'order.create', {
        orderId: 'o-guarded-dedupe',
        total: 42,
      });

      expect(result.isOk()).toBe(true);
      expect(capture.invocations).toHaveLength(1);
      expect(capture.invocations[0]?.trailId).toBe('notify.guarded-dedupe');
    });

    test('consumer contexts carry signal activation provenance', async () => {
      const activations: ActivationProvenance[] = [];
      const consumer = trail('provenance.consumer', {
        blaze: (_input, ctx) => {
          if (ctx.activation !== undefined) {
            activations.push(ctx.activation);
          }
          return Result.ok({ ok: true });
        },
        input: z.object({ orderId: z.string(), total: z.number() }),
        on: [orderPlaced],
        output: z.object({ ok: z.boolean() }),
      });
      const producer = trail('provenance.producer', {
        blaze: async (input, ctx) => {
          await ctx.fire?.(orderPlaced, input);
          return Result.ok({ ok: true });
        },
        fires: [orderPlaced],
        input: z.object({ orderId: z.string(), total: z.number() }),
        output: z.object({ ok: z.boolean() }),
      });
      const app = topo('fire-provenance', { consumer, orderPlaced, producer });

      const result = await run(app, 'provenance.producer', {
        orderId: 'o-provenance',
        total: 11,
      });

      expect(result.isOk()).toBe(true);
      expect(activations).toHaveLength(1);
      const [activation] = activations;
      expect(activation?.fireId).toBeString();
      expect(activation?.parentFireId).toBeUndefined();
      expect(activation?.rootFireId).toBe(activation?.fireId);
      expect(activation?.source).toEqual({
        id: 'order.placed',
        kind: 'signal',
        producerTrailId: 'provenance.producer',
      });
    });

    test('nested signal fires preserve root and parent fire provenance', async () => {
      const firstSignal = signal('provenance.first', {
        payload: z.object({ id: z.string() }),
      });
      const secondSignal = signal('provenance.second', {
        payload: z.object({ id: z.string() }),
      });
      const activations: ActivationProvenance[] = [];
      const producer = trail('provenance.root', {
        blaze: async (_input, ctx) => {
          await ctx.fire?.(firstSignal, { id: 'chain' });
          return Result.ok({ ok: true });
        },
        fires: [firstSignal],
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
      });
      const firstConsumer = trail('provenance.first.consumer', {
        blaze: async (input, ctx) => {
          if (ctx.activation !== undefined) {
            activations.push(ctx.activation);
          }
          await ctx.fire?.(secondSignal, input);
          return Result.ok({ ok: true });
        },
        fires: [secondSignal],
        input: z.object({ id: z.string() }),
        on: [firstSignal],
        output: z.object({ ok: z.boolean() }),
      });
      const secondConsumer = trail('provenance.second.consumer', {
        blaze: (_input, ctx) => {
          if (ctx.activation !== undefined) {
            activations.push(ctx.activation);
          }
          return Result.ok({ ok: true });
        },
        input: z.object({ id: z.string() }),
        on: [secondSignal],
        output: z.object({ ok: z.boolean() }),
      });
      const app = topo('fire-nested-provenance', {
        firstConsumer,
        firstSignal,
        producer,
        secondConsumer,
        secondSignal,
      });

      const result = await run(app, 'provenance.root', {});

      expect(result.isOk()).toBe(true);
      expect(activations).toHaveLength(2);
      const [first, second] = activations;
      expect(first?.fireId).toBeString();
      expect(first?.parentFireId).toBeUndefined();
      expect(first?.rootFireId).toBe(first?.fireId);
      expect(first?.source).toEqual({
        id: 'provenance.first',
        kind: 'signal',
        producerTrailId: 'provenance.root',
      });
      expect(second?.fireId).toBeString();
      expect(second?.fireId).not.toBe(first?.fireId);
      expect(second?.parentFireId).toBe(first?.fireId);
      expect(second?.rootFireId).toBe(first?.rootFireId);
      expect(second?.source).toEqual({
        id: 'provenance.second',
        kind: 'signal',
        producerTrailId: 'provenance.first.consumer',
      });
    });
  });

  describe('validation', () => {
    test('loose string signal ids are blocked by the public fire path', async () => {
      const capture = createCapture();
      const consumer = makeConsumer('notify.email', capture);
      const badProducer = trail('bad.producer', {
        blaze: async (_input, ctx) => {
          const fireByString = ctx.fire as unknown as (
            signalId: string,
            payload: unknown
          ) => Promise<void>;
          await fireByString('order.placed', { orderId: 'o-loose', total: 1 });
          return Result.ok({ ok: true });
        },
        input: z.object({}),
      });

      const app = topo('fire-loose-string', {
        badProducer,
        consumer,
        orderPlaced,
      });
      const result = await run(app, 'bad.producer', {});

      expect(result.isOk()).toBe(true);
      expect(capture.invocations).toHaveLength(0);
    });

    test('unknown signal values do not fail the producer', async () => {
      const ghostSignal = signal('ghost.signal', { payload: z.object({}) });
      const badProducer = trail('bad.producer', {
        blaze: async (_input, ctx) => {
          await ctx.fire?.(ghostSignal, {});
          return Result.ok({ ok: true });
        },
        input: z.object({}),
      });

      const app = topo('fire-unknown', { badProducer });
      const result = await run(app, 'bad.producer', {});

      expect(result.isOk()).toBe(true);
    });

    test('unknown signal values record a signal.unknown diagnostic', async () => {
      const diagnostics: SignalDiagnostic[] = [];
      const ghostSignal = signal('ghost.signal', { payload: z.object({}) });
      const badProducer = trail('bad.producer', {
        blaze: async (_input, ctx) => {
          await ctx.fire?.(ghostSignal, {});
          return Result.ok({ ok: true });
        },
        input: z.object({}),
      });

      const app = topo('fire-unknown-diagnostic', { badProducer });
      const result = await run(
        app,
        'bad.producer',
        {},
        {
          ctx: {
            extensions: {
              [SIGNAL_DIAGNOSTICS_SINK_KEY]: (diagnostic: SignalDiagnostic) => {
                diagnostics.push(diagnostic);
              },
            },
          },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(diagnostics).toEqual([
        expect.objectContaining({
          activation: expect.objectContaining({
            fireId: expect.any(String),
            rootFireId: expect.any(String),
            source: {
              id: 'ghost.signal',
              kind: 'signal',
              producerTrailId: 'bad.producer',
            },
          }),
          category: 'topology',
          code: 'signal.unknown',
          level: 'error',
          origin: 'fire-boundary',
          producerTrailId: 'bad.producer',
          signalId: 'ghost.signal',
        }),
      ]);
      expect(diagnostics[0]?.activation?.rootFireId).toBe(
        diagnostics[0]?.activation?.fireId
      );
    });

    test('bad payload resolves and skips consumers', async () => {
      const capture = createCapture();
      const consumer = makeConsumer('notify.email', capture);

      const badProducer = trail('bad.payload', {
        blaze: async (_input, ctx) => {
          await ctx.fire?.(orderPlaced as Signal<unknown>, { orderId: 123 });
          return Result.ok({ ok: true });
        },
        input: z.object({}),
      });

      const app = topo('fire-bad-payload', {
        badProducer,
        consumer,
        orderPlaced,
      });
      const result = await run(app, 'bad.payload', {});

      expect(result.isOk()).toBe(true);
      expect(capture.invocations).toHaveLength(0);
    });

    test('bad payload records a signal.invalid diagnostic at the fire boundary', async () => {
      const capture = createCapture();
      const diagnostics: SignalDiagnostic[] = [];
      const consumer = makeConsumer('notify.email', capture);

      const badProducer = trail('bad.payload', {
        blaze: async (_input, ctx) => {
          await ctx.fire?.(orderPlaced as Signal<unknown>, {
            orderId: 'o-redacted',
            total: 'secret-total',
          });
          return Result.ok({ ok: true });
        },
        fires: ['order.placed'],
        input: z.object({}),
      });

      const app = topo('fire-bad-payload-diagnostics', {
        badProducer,
        consumer,
        orderPlaced,
      });
      const result = await run(
        app,
        'bad.payload',
        {},
        {
          ctx: {
            extensions: {
              [SIGNAL_DIAGNOSTICS_SINK_KEY]: (diagnostic: SignalDiagnostic) => {
                diagnostics.push(diagnostic);
              },
            },
          },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(capture.invocations).toHaveLength(0);
      expect(diagnostics).toHaveLength(1);

      const [diagnostic] = diagnostics;
      expect(diagnostic).toMatchObject({
        category: 'validation',
        code: 'signal.invalid',
        level: 'error',
        origin: 'fire-boundary',
        producerTrailId: 'bad.payload',
        signalId: 'order.placed',
      });
      if (diagnostic?.code !== 'signal.invalid') {
        throw new Error('Expected signal.invalid diagnostic');
      }
      expect(diagnostic.schemaIssues).toContainEqual(
        expect.objectContaining({ path: ['total'] })
      );
      expect(diagnostic.payload).toMatchObject({
        redacted: true,
        shape: 'object',
        topLevelEntryCount: 2,
      });
      expect(diagnostic.payload.digest).toHaveLength(64);
      expect(JSON.stringify(diagnostic)).not.toContain('secret-total');
    });

    test('bad payload with throwing getters still records diagnostics and resolves', async () => {
      const capture = createCapture();
      const diagnostics: SignalDiagnostic[] = [];
      const consumer = makeConsumer('notify.email', capture);
      const payload = {
        total: 'secret-total',
      };
      Object.defineProperty(payload, 'orderId', {
        enumerable: true,
        get() {
          throw new Error('getter exploded');
        },
      });

      const badProducer = trail('bad.payload.getter', {
        blaze: async (_input, ctx) => {
          await ctx.fire?.(orderPlaced as Signal<unknown>, payload);
          return Result.ok({ ok: true });
        },
        fires: ['order.placed'],
        input: z.object({}),
      });

      const app = topo('fire-bad-payload-getter-diagnostics', {
        badProducer,
        consumer,
        orderPlaced,
      });
      const result = await run(
        app,
        'bad.payload.getter',
        {},
        {
          ctx: {
            extensions: {
              [SIGNAL_DIAGNOSTICS_SINK_KEY]: (diagnostic: SignalDiagnostic) => {
                diagnostics.push(diagnostic);
              },
            },
          },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(capture.invocations).toHaveLength(0);
      expect(diagnostics).toEqual([
        expect.objectContaining({
          code: 'signal.invalid',
          origin: 'fire-boundary',
          signalId: 'order.placed',
        }),
      ]);
      const [diagnostic] = diagnostics;
      if (diagnostic?.code !== 'signal.invalid') {
        throw new Error('Expected signal.invalid diagnostic');
      }
      expect(diagnostic.schemaIssues).toContainEqual(
        expect.objectContaining({
          message:
            'Payload schema validation could not read the payload safely',
          path: [],
        })
      );
      expect(JSON.stringify(diagnostics[0])).not.toContain('secret-total');
      expect(JSON.stringify(diagnostics[0])).not.toContain('getter exploded');
    });

    test('bad payload with revoked proxies still records diagnostics and resolves', async () => {
      const capture = createCapture();
      const diagnostics: SignalDiagnostic[] = [];
      const consumer = makeConsumer('notify.email', capture);
      const { proxy, revoke } = Proxy.revocable(
        {
          orderId: 'o-redacted',
          total: 'secret-total',
        },
        {}
      );
      revoke();

      const badProducer = trail('bad.payload.revoked-proxy', {
        blaze: async (_input, ctx) => {
          await ctx.fire?.(orderPlaced as Signal<unknown>, proxy);
          return Result.ok({ ok: true });
        },
        fires: ['order.placed'],
        input: z.object({}),
      });

      const app = topo('fire-bad-payload-revoked-proxy-diagnostics', {
        badProducer,
        consumer,
        orderPlaced,
      });
      const result = await run(
        app,
        'bad.payload.revoked-proxy',
        {},
        {
          ctx: {
            extensions: {
              [SIGNAL_DIAGNOSTICS_SINK_KEY]: (diagnostic: SignalDiagnostic) => {
                diagnostics.push(diagnostic);
              },
            },
          },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(capture.invocations).toHaveLength(0);
      expect(diagnostics).toEqual([
        expect.objectContaining({
          code: 'signal.invalid',
          origin: 'fire-boundary',
          signalId: 'order.placed',
        }),
      ]);
      const [diagnostic] = diagnostics;
      if (diagnostic?.code !== 'signal.invalid') {
        throw new Error('Expected signal.invalid diagnostic');
      }
      expect(diagnostic.payload).toMatchObject({
        redacted: true,
        shape: 'object',
        topLevelEntryCount: undefined,
      });
      expect(JSON.stringify(diagnostics[0])).not.toContain('secret-total');
    });

    test('signal.invalid diagnostics carry trace and run ids when tracing is enabled', async () => {
      const diagnostics: SignalDiagnostic[] = [];
      const records: TraceRecord[] = [];
      const traceSink: TraceSink = {
        write(record) {
          records.push(record);
        },
      };
      const badProducer = trail('bad.payload', {
        blaze: async (_input, ctx) => {
          await ctx.fire?.(orderPlaced as Signal<unknown>, { orderId: 123 });
          return Result.ok({ ok: true });
        },
        fires: ['order.placed'],
        input: z.object({}),
      });
      const app = topo('fire-bad-payload-traced-diagnostics', {
        badProducer,
        orderPlaced,
      });

      registerTraceSink(traceSink);
      try {
        const result = await run(
          app,
          'bad.payload',
          {},
          {
            ctx: {
              extensions: {
                [SIGNAL_DIAGNOSTICS_SINK_KEY]: (
                  diagnostic: SignalDiagnostic
                ) => {
                  diagnostics.push(diagnostic);
                },
              },
            },
          }
        );

        expect(result.isOk()).toBe(true);
      } finally {
        clearTraceSink();
      }

      const producerRecord = records.find(
        (record) => record.trailId === 'bad.payload'
      );
      expect(producerRecord).toBeDefined();
      expect(diagnostics).toHaveLength(1);
      const [diagnostic] = diagnostics;
      expect(diagnostic?.runId).toBe(producerRecord?.id);
      expect(diagnostic?.traceId).toBe(producerRecord?.traceId);

      const invalidRecord = findSignalTraceRecord(records, 'signal.invalid');
      expect(invalidRecord.status).toBe('err');
      expect(invalidRecord.errorCategory).toBe('validation');
      expect(invalidRecord.attrs).toMatchObject({
        'trails.signal.id': 'order.placed',
        'trails.signal.payload.redacted': true,
        'trails.signal.payload.shape': 'object',
        'trails.signal.producer_trail.id': 'bad.payload',
        'trails.signal.schema_issue_count': 2,
      });
      expect(invalidRecord.attrs['trails.signal.payload.digest']).toBeString();
      expect(invalidRecord.attrs['trails.signal.schema_issue_paths']).toContain(
        'orderId'
      );
      if (producerRecord) {
        expectSignalRecordParentedToProducer(invalidRecord, producerRecord);
      }
    });

    test('consumer fires are rebound to the consumer trace context before diagnostics', async () => {
      const diagnostics: SignalDiagnostic[] = [];
      const records: TraceRecord[] = [];
      const producerReady = signal('producer.ready', {
        payload: z.object({ orderId: z.string() }),
      });
      const consumerInvalid = signal('consumer.invalid', {
        payload: z.object({ chargeId: z.string() }),
      });
      const producer = trail('producer.ready-fire', {
        blaze: async (input, ctx) => {
          await ctx.fire?.(producerReady, { orderId: input.orderId });
          return Result.ok({ ok: true });
        },
        fires: [producerReady],
        input: z.object({ orderId: z.string() }),
      });
      const consumer = trail('consumer.invalid-fire', {
        blaze: async (_input, ctx) => {
          await ctx.fire?.(consumerInvalid as Signal<unknown>, {
            chargeId: 123,
          });
          return Result.ok({ ok: true });
        },
        fires: [consumerInvalid],
        input: z.object({ orderId: z.string() }),
        on: [producerReady.id],
      });
      const app = topo('consumer-fire-diagnostic-context', {
        consumer,
        consumerInvalid,
        producer,
        producerReady,
      });

      registerTraceSink(createCapturingSink(records));
      try {
        const result = await run(
          app,
          producer.id,
          { orderId: 'o-consumer-diagnostic' },
          {
            ctx: {
              extensions: {
                [SIGNAL_DIAGNOSTICS_SINK_KEY]: (
                  diagnostic: SignalDiagnostic
                ) => {
                  diagnostics.push(diagnostic);
                },
              },
            },
          }
        );
        expect(result.isOk()).toBe(true);
      } finally {
        clearTraceSink();
      }

      const producerRecord = findTrailRecord(records, producer.id);
      const consumerRecord = findTrailRecord(records, consumer.id);
      expect(diagnostics).toHaveLength(1);
      const [diagnostic] = diagnostics;
      expect(diagnostic).toMatchObject({
        code: 'signal.invalid',
        producerTrailId: consumer.id,
        signalId: consumerInvalid.id,
      });
      expect(diagnostic?.runId).toBe(consumerRecord.id);
      expect(diagnostic?.runId).not.toBe(producerRecord.id);
      expect(diagnostic?.traceId).toBe(consumerRecord.traceId);
      expect(diagnostic?.traceId).toBe(producerRecord.traceId);
    });

    test('strict mode marks signal.invalid diagnostics for promotion without failing the producer', async () => {
      const diagnostics: SignalDiagnostic[] = [];
      const promotions: Record<string, unknown>[] = [];
      const strictLogger: Logger = {
        ...noopLogger,
        child() {
          return this;
        },
        warn(message, data) {
          if (message === 'Signal diagnostic promoted by strict mode') {
            promotions.push({ message, ...data });
          }
        },
      };
      const badProducer = trail('bad.payload', {
        blaze: async (_input, ctx) => {
          await ctx.fire?.(orderPlaced as Signal<unknown>, { orderId: 123 });
          return Result.ok({ ok: true });
        },
        fires: ['order.placed'],
        input: z.object({}),
      });
      const app = topo('fire-bad-payload-strict-diagnostics', {
        badProducer,
        orderPlaced,
      });

      const result = await run(
        app,
        'bad.payload',
        {},
        {
          ctx: {
            extensions: {
              [SIGNAL_DIAGNOSTICS_SINK_KEY]: (diagnostic: SignalDiagnostic) => {
                diagnostics.push(diagnostic);
              },
              [SIGNAL_DIAGNOSTICS_STRICT_MODE_KEY]: ['signal.invalid'],
            },
            logger: strictLogger,
          },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(diagnostics).toHaveLength(1);
      expect(promotions).toEqual([
        expect.objectContaining({
          code: 'signal.invalid',
          message: 'Signal diagnostic promoted by strict mode',
          producerTrailId: 'bad.payload',
          signalId: 'order.placed',
        }),
      ]);
    });
  });

  describe('error isolation', () => {
    test('consumer error does not fail successful siblings or the producer', async () => {
      const scenario = createErrorIsolationScenario();
      const result = await run(
        scenario.app,
        'order.create',
        {
          orderId: 'o-3',
          total: 1,
        },
        {
          ctx: { logger: createWarningLogger(scenario.warnings) },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(scenario.fireBox.fired).toBe(true);
      expect(observedConsumerIds(scenario.capture)).toEqual([
        'notify.broken',
        'notify.email',
      ]);
      expectConsumerFailureWarning(scenario.warnings);
    });

    test('consumer errors record a signal.handler.failed diagnostic', async () => {
      const diagnostics: SignalDiagnostic[] = [];
      const scenario = createErrorIsolationScenario();
      const result = await run(
        scenario.app,
        'order.create',
        {
          orderId: 'o-3',
          total: 1,
        },
        {
          ctx: {
            extensions: {
              [SIGNAL_DIAGNOSTICS_SINK_KEY]: (diagnostic: SignalDiagnostic) => {
                diagnostics.push(diagnostic);
              },
            },
            logger: createWarningLogger(scenario.warnings),
          },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          category: 'handler',
          code: 'signal.handler.failed',
          handlerTrailId: 'notify.broken',
          level: 'error',
          origin: 'handler',
          producerTrailId: 'order.create',
          signalId: 'order.placed',
        })
      );
      const [diagnostic] = diagnostics;
      if (diagnostic?.code !== 'signal.handler.failed') {
        throw new Error('Expected signal.handler.failed diagnostic');
      }
      expect(diagnostic.cause).toEqual({
        message: 'notify.broken failed',
        name: 'Error',
      });
      expect(diagnostic.payload).toMatchObject({
        redacted: true,
        shape: 'object',
      });
    });

    test('predicate failures record diagnostics and do not block siblings', async () => {
      const capture = createCapture();
      const diagnostics: SignalDiagnostic[] = [];
      const app = topo('fire-where-failure', {
        broken: makeWhereConsumer('notify.broken-predicate', capture, () => {
          throw new Error('predicate exploded');
        }),
        healthy: makeConsumer('notify.audit', capture),
        orderPlaced,
        producer: makeProducer({}),
      });

      const result = await run(
        app,
        'order.create',
        { orderId: 'o-where-failure', total: 42 },
        {
          ctx: {
            extensions: {
              [SIGNAL_DIAGNOSTICS_SINK_KEY]: (diagnostic: SignalDiagnostic) => {
                diagnostics.push(diagnostic);
              },
            },
          },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(observedConsumerIds(capture)).toEqual(['notify.audit']);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          category: 'activation',
          code: 'signal.handler.predicate_failed',
          handlerTrailId: 'notify.broken-predicate',
          origin: 'predicate',
          producerTrailId: 'order.create',
          signalId: 'order.placed',
        })
      );
    });

    test('executor rejections record a signal.handler.rejected diagnostic', async () => {
      const diagnostics: SignalDiagnostic[] = [];
      const diagnosticRecorded = Promise.withResolvers<undefined>();
      const consumer = makeConsumer('notify.email', createCapture());
      const app = topo('fire-rejected-diagnostic', { consumer, orderPlaced });
      const fire = createFireFn(
        app,
        {
          abortSignal: AbortSignal.timeout(5000),
          extensions: {
            [SIGNAL_DIAGNOSTICS_SINK_KEY]: (diagnostic: SignalDiagnostic) => {
              diagnostics.push(diagnostic);
              diagnosticRecorded.resolve();
            },
          },
          requestId: 'fire-rejected-diagnostic',
        },
        async () => {
          throw new Error('executor rejected');
        },
        'manual.producer'
      );

      await fire(orderPlaced, { orderId: 'o-rejected', total: 1 });
      await diagnosticRecorded.promise;

      expect(diagnostics).toEqual([
        expect.objectContaining({
          category: 'handler',
          code: 'signal.handler.rejected',
          handlerTrailId: 'notify.email',
          level: 'error',
          origin: 'handler',
          producerTrailId: 'manual.producer',
          signalId: 'order.placed',
        }),
      ]);
      const [diagnostic] = diagnostics;
      if (diagnostic?.code !== 'signal.handler.rejected') {
        throw new Error('Expected signal.handler.rejected diagnostic');
      }
      expect(diagnostic.cause).toEqual({
        message: 'executor rejected',
        name: 'Error',
      });
    });

    test('consumer error records a signal.handler.failed trace record', async () => {
      const records: TraceRecord[] = [];
      registerTraceSink(createCapturingSink(records));

      try {
        const scenario = createErrorIsolationScenario();
        const result = await run(
          scenario.app,
          'order.create',
          {
            orderId: 'o-3',
            total: 1,
          },
          {
            ctx: { logger: createWarningLogger(scenario.warnings) },
          }
        );

        expect(result.isOk()).toBe(true);
        const producer = findTrailRecord(records, 'order.create');
        const failed = findSignalTraceRecord(
          records,
          'signal.handler.failed',
          'notify.broken'
        );
        const completed = findSignalTraceRecord(
          records,
          'signal.handler.completed',
          'notify.email'
        );

        expectSignalRecordParentedToProducer(failed, producer);
        expectSignalRecordParentedToProducer(completed, producer);
        expect(failed.status).toBe('err');
        expect(failed.errorCategory).toBe('internal');
        expect(failed.attrs).toMatchObject({
          'trails.signal.error.name': 'Error',
          'trails.signal.handler_trail.id': 'notify.broken',
          'trails.signal.id': 'order.placed',
          'trails.signal.payload.redacted': true,
          'trails.signal.producer_trail.id': 'order.create',
        });
        expect(completed.status).toBe('ok');
      } finally {
        clearTraceSink();
      }
    });

    test('starts sibling consumers before the first one settles', async () => {
      const scenario = createParallelStartScenario();
      const runPromise = run(scenario.app, 'order.create', {
        orderId: 'o-parallel',
        total: 1,
      });
      const started = await waitForConsumersToStart(
        scenario.leftStarted,
        scenario.rightStarted
      );

      scenario.release.resolve(READY);
      const result = await runPromise;

      expect(result.isOk()).toBe(true);
      expect(started).toBe('started');
    });

    test('gives each consumer its own derived top-level context', async () => {
      const scenario = createContextIsolationScenario();
      const runPromise = run(
        scenario.app,
        'order.create',
        { orderId: 'o-isolated', total: 1 },
        { ctx: { extensions: { source: 'producer' } } }
      );

      await waitForReadyPair(
        scenario.leftStarted.promise,
        scenario.rightStarted.promise
      );
      scenario.release.resolve(READY);
      const result = await runPromise;

      expect(result.isOk()).toBe(true);
      expect(scenario.seen.get('notify.email')).toBe('email');
      expect(scenario.seen.get('notify.slack')).toBe('slack');
    });
  });

  describe('context binding', () => {
    test('ctx.fire is undefined when executeTrail is called without a topo', async () => {
      const { executeTrail } = await import('../execute');
      const standalone = trail('standalone', {
        blaze: async (_input, ctx) =>
          Result.ok({ hasFire: ctx.fire !== undefined }),
        input: z.object({}),
      });

      const result = await executeTrail(standalone, {});
      expect(result.isOk()).toBe(true);
      expect((result.unwrap() as { hasFire: boolean }).hasFire).toBe(false);
    });

    test('caller-supplied ctx.fire is preserved even when topo is provided', async () => {
      // Symmetry with bindCrossToCtx: a test harness or runtime that injects
      // a custom ctx.fire mock should observe its calls, not have them
      // silently rebound to the topo-backed dispatcher.
      const { executeTrail } = await import('../execute');
      const captured: { signalId?: string; payload?: unknown } = {};
      const fireMock: NonNullable<TrailContext['fire']> = ((
        signalArg: unknown,
        payload: unknown
      ) => {
        captured.signalId = (signalArg as { id: string }).id;
        captured.payload = payload;
        return Promise.resolve();
      }) as NonNullable<TrailContext['fire']>;

      const producer = trail('order.create-with-injected-fire', {
        blaze: async (_input, ctx) => {
          await ctx.fire?.(orderPlaced, {
            orderId: 'o-injected',
            total: 1,
          });
          return Result.ok({ ok: true });
        },
        fires: ['order.placed'],
        input: z.object({}),
      });
      const consumer = makeConsumer('notify.email', createCapture());
      const app = topo('preserve-fire', { consumer, orderPlaced, producer });

      const result = await executeTrail(
        producer,
        {},
        { ctx: { fire: fireMock }, topo: app }
      );

      expect(result.isOk()).toBe(true);
      expect(captured.signalId).toBe('order.placed');
      expect(captured.payload).toEqual({ orderId: 'o-injected', total: 1 });
    });
  });

  describe('signal-value overload', () => {
    test('ctx.fire(signal, payload) accepts a signal value and fans out', async () => {
      const capture = createCapture();
      const consumerA = makeConsumer('notify.email', capture);
      const valueProducer = trail('order.create-by-value', {
        blaze: async (input, ctx) => {
          await ctx.fire?.(orderPlaced, {
            orderId: input.orderId,
            total: input.total,
          });
          return Result.ok({ ok: true });
        },
        fires: ['order.placed'],
        input: z.object({ orderId: z.string(), total: z.number() }),
      });
      const app = topo('fire-signal-value', {
        consumerA,
        orderPlaced,
        valueProducer,
      });
      const result = await run(app, 'order.create-by-value', {
        orderId: 'o-value',
        total: 99,
      });
      expect(result.isOk()).toBe(true);
      expect(capture.invocations).toHaveLength(1);
      expect(capture.invocations[0]?.payload).toEqual({
        orderId: 'o-value',
        total: 99,
      });
    });
  });

  describe('option forwarding', () => {
    test('consumer inherits producer layers applied via options.layers', async () => {
      const layerCalls: string[] = [];
      const tagging: Layer = {
        name: 'tag',
        wrap: (_trail, implementation) => (input, ctx) => {
          layerCalls.push('wrap');
          return implementation(input, ctx);
        },
      };

      const consumer = trail('layered.consumer', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ orderId: z.string(), total: z.number() }),
        on: ['order.placed'],
      });
      const fireBox: { fired?: boolean } = {};
      const producer = makeProducer(fireBox);
      const app = topo('fire-layer-forward', {
        consumer,
        orderPlaced,
        producer,
      });

      const result = await run(
        app,
        'order.create',
        { orderId: 'o-layer', total: 1 },
        { layers: [tagging] }
      );

      expect(result.isOk()).toBe(true);
      // Layer runs once for producer and once for consumer when forwarded.
      expect(layerCalls.length).toBe(2);
    });
  });

  describe('cycle detection', () => {
    test('skips re-entrant signal cycles and logs suppression details', async () => {
      const events: CycleLogEvent[] = [];
      const invocations: string[] = [];
      const cycleLogger = createCycleLogger(events);
      const app = createCycleScenario(invocations);

      const result = await run(
        app,
        'loop.producer',
        { id: 'loop-1' },
        { ctx: { logger: cycleLogger } }
      );

      expect(result.isOk()).toBe(true);
      expect(invocations).toEqual(['a', 'b']);
      expectCycleSuppressionLogs(events, 'loop.a', ['loop.a', 'loop.b']);
    });

    test('cycle suppression records a signal.fire.suppressed diagnostic', async () => {
      const diagnostics: SignalDiagnostic[] = [];
      const invocations: string[] = [];
      const app = createCycleScenario(invocations);

      const result = await run(
        app,
        'loop.producer',
        { id: 'loop-1' },
        {
          ctx: {
            extensions: {
              [SIGNAL_DIAGNOSTICS_SINK_KEY]: (diagnostic: SignalDiagnostic) => {
                diagnostics.push(diagnostic);
              },
            },
          },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(diagnostics).toEqual([
        expect.objectContaining({
          category: 'activation',
          code: 'signal.fire.suppressed',
          fireStack: ['loop.a', 'loop.b'],
          level: 'warning',
          origin: 'fan-out-guard',
          producerTrailId: 'loop.consumer.b',
          reason: 'cycle',
          signalId: 'loop.a',
        }),
      ]);
    });

    test('does not emit suppression debug logs for ordinary fan-out', async () => {
      const events: CycleLogEvent[] = [];
      const app = topo('fire-no-cycle-debug', {
        consumer: makeConsumer('notify.email', createCapture()),
        orderPlaced,
        producer: makeProducer({}),
      });

      const result = await run(
        app,
        'order.create',
        { orderId: 'o-no-cycle', total: 1 },
        { ctx: { logger: createCycleLogger(events) } }
      );

      expect(result.isOk()).toBe(true);
      expectNoCycleSuppressionDebugLogs(events);
      expect(cycleEventsAtLevel(events, 'warn')).toEqual([]);
    });

    test('stops at max depth for distinct-signal chains', async () => {
      const events: CycleLogEvent[] = [];
      const logger = createCycleLogger(events);
      const { app } = createDepthChainScenario(20);

      const result = await run(
        app,
        'chain.start',
        { n: 0 },
        { ctx: { logger } }
      );

      expect(result.isOk()).toBe(true);
      const depthWarning = cycleEventsAtLevel(events, 'warn').find((event) =>
        event.message.includes('depth limit')
      );
      expect(depthWarning).toBeDefined();
    });
  });

  describe('trace shape', () => {
    test('sibling consumers emit overlapping trace records parented to the producer', async () => {
      const records: TraceRecord[] = [];
      registerTraceSink(createCapturingSink(records));

      try {
        const scenario = createTraceShapeScenario();
        const result = await runTraceShapeScenario(scenario);
        expect(result.isOk()).toBe(true);
        expectSiblingTraceShape(records, {
          leftTrailId: 'notify.email',
          producerTrailId: 'order.create',
          rightTrailId: 'notify.slack',
        });
      } finally {
        clearTraceSink();
      }
    });

    test('records signal lifecycle trace records with redacted payload summaries', async () => {
      const records: TraceRecord[] = [];
      registerTraceSink(createCapturingSink(records));

      try {
        const scenario = createTraceShapeScenario();
        const result = await runTraceShapeScenario(scenario);
        expect(result.isOk()).toBe(true);

        const producer = findTrailRecord(records, 'order.create');
        const emailTrail = findTrailRecord(records, 'notify.email');
        const slackTrail = findTrailRecord(records, 'notify.slack');
        const fired = findSignalTraceRecord(records, 'signal.fired');
        const emailInvoked = findSignalTraceRecord(
          records,
          'signal.handler.invoked',
          'notify.email'
        );
        const emailCompleted = findSignalTraceRecord(
          records,
          'signal.handler.completed',
          'notify.email'
        );
        const slackInvoked = findSignalTraceRecord(
          records,
          'signal.handler.invoked',
          'notify.slack'
        );
        const slackCompleted = findSignalTraceRecord(
          records,
          'signal.handler.completed',
          'notify.slack'
        );
        const fireId = fired.attrs['trails.activation.fire_id'];
        expect(fireId).toBeString();

        for (const record of [
          fired,
          emailInvoked,
          emailCompleted,
          slackInvoked,
          slackCompleted,
        ]) {
          expectSignalRecordParentedToProducer(record, producer);
          expect(record.status).toBe('ok');
          expect(record.attrs).toMatchObject({
            'trails.activation.fire_id': fireId,
            'trails.activation.root_fire_id': fireId,
            'trails.activation.source.id': 'order.placed',
            'trails.activation.source.kind': 'signal',
            'trails.activation.source.producer_trail.id': 'order.create',
            'trails.signal.id': 'order.placed',
            'trails.signal.payload.redacted': true,
            'trails.signal.payload.shape': 'object',
            'trails.signal.producer_trail.id': 'order.create',
            'trails.signal.run.id': producer.id,
          });
          expect(record.attrs['trails.signal.payload.digest']).toBeString();
        }
        for (const record of [emailTrail, slackTrail]) {
          expect(record.attrs).toMatchObject({
            'trails.activation.fire_id': fireId,
            'trails.activation.root_fire_id': fireId,
            'trails.activation.source.id': 'order.placed',
            'trails.activation.source.kind': 'signal',
            'trails.activation.source.producer_trail.id': 'order.create',
          });
        }
        expect(producer.attrs['trails.activation.fire_id']).toBeUndefined();

        expect(fired.attrs).toMatchObject({
          'trails.signal.consumer_count': 2,
          'trails.signal.consumer_ids': 'notify.email,notify.slack',
        });
        expect(JSON.stringify(signalTraceRecords(records))).not.toContain(
          'o-trace'
        );
      } finally {
        clearTraceSink();
      }
    });

    test('records predicate match, skip, and failure trace records', async () => {
      const capture = createCapture();
      const records: TraceRecord[] = [];
      const app = topo('fire-where-trace', {
        failed: makeWhereConsumer('notify.failed-predicate', capture, () => {
          throw new Error('predicate failed');
        }),
        matched: makeWhereConsumer(
          'notify.matched-predicate',
          capture,
          (payload) => payload.total > 10
        ),
        orderPlaced,
        producer: makeProducer({}),
        skipped: makeWhereConsumer(
          'notify.skipped-predicate',
          capture,
          (payload) => payload.total > 100
        ),
      });
      registerTraceSink(createCapturingSink(records));

      try {
        const result = await run(app, 'order.create', {
          orderId: 'o-where-trace',
          total: 42,
        });

        expect(result.isOk()).toBe(true);
        expect(
          findSignalTraceRecord(
            records,
            'signal.handler.predicate_matched',
            'notify.matched-predicate'
          ).status
        ).toBe('ok');
        expect(
          findSignalTraceRecord(
            records,
            'signal.handler.predicate_skipped',
            'notify.skipped-predicate'
          ).status
        ).toBe('ok');
        const failed = findSignalTraceRecord(
          records,
          'signal.handler.predicate_failed',
          'notify.failed-predicate'
        );
        expect(failed.status).toBe('err');
        expect(failed.errorCategory).toBe('internal');
      } finally {
        clearTraceSink();
      }
    });

    test('skips payload summaries when signal tracing is inactive', async () => {
      clearTraceSink();
      const scenario = createThrowingPayloadScenario();

      const result = await run(scenario.app, 'fragile.producer', {});

      expect(result.isOk()).toBe(true);
      expect(scenario.invocations).toHaveLength(1);
    });

    test('records redacted payload attrs when trace payload getters throw', async () => {
      const records: TraceRecord[] = [];
      registerTraceSink(createCapturingSink(records));

      try {
        const scenario = createThrowingPayloadScenario();
        const result = await run(scenario.app, 'fragile.producer', {});
        expect(result.isOk()).toBe(true);
        expect(scenario.invocations).toHaveLength(1);

        const producer = findTrailRecord(records, 'fragile.producer');
        const fired = findSignalTraceRecord(records, 'signal.fired');
        const invoked = findSignalTraceRecord(
          records,
          'signal.handler.invoked',
          'fragile.consumer'
        );
        const completed = findSignalTraceRecord(
          records,
          'signal.handler.completed',
          'fragile.consumer'
        );

        for (const record of [fired, invoked, completed]) {
          expectSignalRecordParentedToProducer(record, producer);
          expect(record.status).toBe('ok');
          expect(record.attrs).toMatchObject({
            'trails.signal.id': 'fragile.payload',
            'trails.signal.payload.redacted': true,
            'trails.signal.payload.shape': 'object',
            'trails.signal.producer_trail.id': 'fragile.producer',
            'trails.signal.run.id': producer.id,
          });
          expect(record.attrs['trails.signal.payload.digest']).toBeString();
        }
        expect(JSON.stringify(signalTraceRecords(records))).not.toContain(
          'payload getter exploded'
        );
      } finally {
        clearTraceSink();
      }
    });
  });

  describe('per-consumer cross binding', () => {
    test('cross calls from a consumer are attributed to the consumer span', async () => {
      const records: TraceRecord[] = [];
      registerTraceSink(createCapturingSink(records));

      try {
        const app = createConsumerCrossScenario();
        const result = await run(app, 'order.create', {
          orderId: 'o-cross-attr',
          total: 4,
        });
        expect(result.isOk()).toBe(true);
        expectConsumerCrossAttribution(records);
      } finally {
        clearTraceSink();
      }
    });
  });

  describe('producer context inheritance', () => {
    test('consumer inherits producer logger and requestId', async () => {
      const captured: { requestId: string; loggerExists: boolean }[] = [];
      const consumer = trail('inherit.consumer', {
        blaze: (_input, ctx) => {
          captured.push({
            loggerExists: ctx.logger !== undefined,
            requestId: ctx.requestId,
          });
          return Result.ok({ ok: true });
        },
        input: z.object({ orderId: z.string(), total: z.number() }),
        on: ['order.placed'],
      });
      const fireBox: { fired?: boolean } = {};
      const app = topo('fire-inherit', {
        consumer,
        orderPlaced,
        producer: makeProducer(fireBox),
      });
      const result = await run(
        app,
        'order.create',
        { orderId: 'o-inherit', total: 1 },
        { ctx: { logger: noopLogger, requestId: 'producer-request-id' } }
      );
      expect(result.isOk()).toBe(true);
      expect(captured).toHaveLength(1);
      expect(captured[0]?.loggerExists).toBe(true);
      expect(captured[0]?.requestId).toBe('producer-request-id');
    });

    test('consumer inherits layer-mutated producer requestId', async () => {
      const captured: string[] = [];
      const consumer = trail('inherit.layered.consumer', {
        blaze: (_input, ctx) => {
          captured.push(ctx.requestId);
          return Result.ok({ ok: true });
        },
        input: z.object({ orderId: z.string(), total: z.number() }),
        on: ['order.placed'],
      });
      const requestIdLayer: Layer = {
        name: 'request-id-layer',
        wrap: (_trail, implementation) => (input, ctx) =>
          implementation(input, {
            ...ctx,
            requestId: 'layer-request-id',
          }),
      };
      const fireBox: { fired?: boolean } = {};
      const app = topo('fire-inherit-layered', {
        consumer,
        orderPlaced,
        producer: makeProducer(fireBox),
      });

      const result = await run(
        app,
        'order.create',
        { orderId: 'o-layered-inherit', total: 1 },
        {
          ctx: { requestId: 'producer-request-id' },
          layers: [requestIdLayer],
        }
      );

      expect(result.isOk()).toBe(true);
      expect(captured).toEqual(['layer-request-id']);
    });

    test('extracted fire inherits layer-mutated producer requestId', async () => {
      const captured: string[] = [];
      const consumer = trail('inherit.extracted.consumer', {
        blaze: (_input, ctx) => {
          captured.push(ctx.requestId);
          return Result.ok({ ok: true });
        },
        input: z.object({ orderId: z.string(), total: z.number() }),
        on: ['order.placed'],
      });
      const producer = trail('inherit.extracted.producer', {
        blaze: async (input, ctx) => {
          const { fire } = ctx;
          await fire?.(orderPlaced, {
            orderId: input.orderId,
            total: input.total,
          });
          return Result.ok({ ok: true });
        },
        fires: ['order.placed'],
        input: z.object({ orderId: z.string(), total: z.number() }),
      });
      const requestIdLayer: Layer = {
        name: 'request-id-layer',
        wrap: (_trail, implementation) => (input, ctx) =>
          implementation(input, {
            ...ctx,
            requestId: 'layer-request-id',
          }),
      };
      const app = topo('fire-inherit-extracted', {
        consumer,
        orderPlaced,
        producer,
      });

      const result = await run(
        app,
        'inherit.extracted.producer',
        { orderId: 'o-layered-inherit', total: 1 },
        {
          ctx: { requestId: 'producer-request-id' },
          layers: [requestIdLayer],
        }
      );

      expect(result.isOk()).toBe(true);
      expect(captured).toEqual(['layer-request-id']);
    });
  });
});
