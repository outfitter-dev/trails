/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../errors';
import { clearTraceSink, registerTraceSink } from '../internal/tracing';
import type { TraceRecord, TraceSink } from '../internal/tracing';
import type { Layer } from '../layer';
import { Result } from '../result';
import { run } from '../run';
import { signal } from '../signal';
import { topo } from '../topo';
import { trail } from '../trail';
import type { Logger } from '../types';

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

const makeProducer = (fireResultKey: { result?: Result<void, Error> }) =>
  trail('order.create', {
    blaze: async (input, ctx) => {
      const fired = await ctx.fire?.('order.placed', {
        orderId: input.orderId,
        total: input.total,
      });
      fireResultKey.result = fired;
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
  nextSignalId: 'loop.a' | 'loop.b',
  invocations: string[]
) =>
  trail(id, {
    blaze: async (input, ctx) => {
      invocations.push(signalId === 'loop.a' ? 'a' : 'b');
      const fired = await ctx.fire?.(nextSignalId, { id: input.id });
      return fired as Result<unknown, Error>;
    },
    fires: [nextSignalId],
    input: cyclePayload,
    on: [signalId],
  });

const createErrorIsolationScenario = () => {
  const capture = createCapture();
  const warnings: WarningEvent[] = [];
  const fireBox: { result?: Result<void, Error> } = {};
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
      'loop.b',
      invocations
    ),
    consumerB: createCycleConsumer(
      'loop.consumer.b',
      'loop.b',
      'loop.a',
      invocations
    ),
    loopA,
    loopB,
    producer: trail('loop.producer', {
      blaze: async (input, ctx) =>
        (await ctx.fire?.('loop.a', { id: input.id })) as Result<
          unknown,
          Error
        >,
      fires: ['loop.a'],
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
          await ctx.fire?.(next?.id ?? '', { n: i + 1 });
          return Result.ok({ step: i });
        },
        fires: [signals[i + 1]?.id ?? ''],
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
          await ctx.fire?.(firstSignal?.id ?? '', input);
          return Result.ok({ started: true });
        },
        fires: [firstSignal?.id ?? ''],
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
  const fireBox: { result?: Result<void, Error> } = {};
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fire', () => {
  describe('fan-out', () => {
    test('invokes every consumer with validated payload', async () => {
      const capture = createCapture();
      const fireBox: { result?: Result<void, Error> } = {};
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
      expect(fireBox.result?.isOk()).toBe(true);
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

    test('no-consumer fan-out returns Result.ok', async () => {
      const fireBox: { result?: Result<void, Error> } = {};
      const producer = makeProducer(fireBox);
      const app = topo('fire-empty', { orderPlaced, producer });

      const result = await run(app, 'order.create', {
        orderId: 'o-2',
        total: 0,
      });

      expect(result.isOk()).toBe(true);
      expect(fireBox.result?.isOk()).toBe(true);
    });
  });

  describe('validation', () => {
    test('unknown signal id returns Result.err(NotFoundError)', async () => {
      const badProducer = trail('bad.producer', {
        blaze: async (_input, ctx) => {
          const fired = await ctx.fire?.('ghost.signal', {});
          return fired as Result<unknown, Error>;
        },
        input: z.object({}),
      });

      const app = topo('fire-unknown', { badProducer });
      const result = await run(app, 'bad.producer', {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(NotFoundError);
    });

    test('bad payload returns Result.err(ValidationError) and skips consumers', async () => {
      const capture = createCapture();
      const consumer = makeConsumer('notify.email', capture);

      const badProducer = trail('bad.payload', {
        blaze: async (_input, ctx) => {
          const fired = await ctx.fire?.('order.placed', { orderId: 123 });
          return fired as Result<unknown, Error>;
        },
        input: z.object({}),
      });

      const app = topo('fire-bad-payload', {
        badProducer,
        consumer,
        orderPlaced,
      });
      const result = await run(app, 'bad.payload', {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(capture.invocations).toHaveLength(0);
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
      expect(scenario.fireBox.result?.isOk()).toBe(true);
      expect(observedConsumerIds(scenario.capture)).toEqual([
        'notify.broken',
        'notify.email',
      ]);
      expectConsumerFailureWarning(scenario.warnings);
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
  });

  describe('signal-value overload', () => {
    test('ctx.fire(signal, payload) accepts a signal value and fans out', async () => {
      const capture = createCapture();
      const consumerA = makeConsumer('notify.email', capture);
      const valueProducer = trail('order.create-by-value', {
        blaze: async (input, ctx) => {
          const fired = await ctx.fire?.(orderPlaced, {
            orderId: input.orderId,
            total: input.total,
          });
          return fired as Result<unknown, Error>;
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
      const fireBox: { result?: Result<void, Error> } = {};
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
      const fireBox: { result?: Result<void, Error> } = {};
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
      const fireBox: { result?: Result<void, Error> } = {};
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
          const fired = await fire?.('order.placed', {
            orderId: input.orderId,
            total: input.total,
          });
          return fired as Result<unknown, Error>;
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
