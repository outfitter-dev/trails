/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../errors';
import type { Layer } from '../layer';
import { Result } from '../result';
import { run } from '../run';
import { signal } from '../signal';
import { topo } from '../topo';
import { trail } from '../trail';

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

const cyclePayload = z.object({ id: z.string() });

const resolveFireResult = (
  fired: Result<void, Error> | undefined
): Result<{ ok: true }, Error> =>
  fired?.match({
    err: (error) => Result.err(error),
    ok: () => Result.ok({ ok: true }),
  }) ?? Result.ok({ ok: true });

const createCycleLogger = (
  warnings: { message: string; signalId?: unknown }[]
): Logger => {
  const logger: Logger = {
    ...noopLogger,
    child() {
      return logger;
    },
    warn(message, data) {
      warnings.push({ message, signalId: data?.signalId });
    },
  };
  return logger;
};

const createCycleConsumer = (
  id: string,
  onSignalId: string,
  nextSignalId: string,
  marker: string,
  invocations: string[]
) =>
  trail(id, {
    blaze: async (input: { readonly id: string }, ctx: TrailContext) => {
      invocations.push(marker);
      return resolveFireResult(await ctx.fire?.(nextSignalId, input));
    },
    input: cyclePayload,
    on: [onSignalId],
  });

const createCycleScenario = (invocations: string[]) => {
  const signalA = signal('loop.a', { payload: cyclePayload });
  const signalB = signal('loop.b', { payload: cyclePayload });
  const consumerA = createCycleConsumer(
    'loop.consumer-a',
    'loop.a',
    'loop.b',
    'a',
    invocations
  );
  const consumerB = createCycleConsumer(
    'loop.consumer-b',
    'loop.b',
    'loop.a',
    'b',
    invocations
  );
  const producer = trail('loop.producer', {
    blaze: async (input: { readonly id: string }, ctx: TrailContext) =>
      resolveFireResult(await ctx.fire?.('loop.a', input)),
    fires: ['loop.a'],
    input: cyclePayload,
  });

  return topo('fire-cycle', {
    consumerA,
    consumerB,
    producer,
    signalA,
    signalB,
  });
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

    test('invalid ctx.fire input returns Result.err(ValidationError)', async () => {
      const badProducer = trail('bad.fire-input', {
        blaze: async (_input, ctx) => {
          const fire = ctx.fire as (
            signalOrId: unknown,
            payload: unknown
          ) => Promise<Result<void, Error>>;
          const fired = await fire(123, {});
          return fired as Result<unknown, Error>;
        },
        input: z.object({}),
      });

      const app = topo('fire-bad-input', { badProducer, orderPlaced });
      const result = await run(app, 'bad.fire-input', {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
    });
  });

  describe('error isolation', () => {
    test('consumer error does not fail the producer', async () => {
      const capture = createCapture();
      const failingConsumer = makeConsumer('notify.broken', capture, 'err');
      const fireBox: { result?: Result<void, Error> } = {};
      const producer = makeProducer(fireBox);

      const app = topo('fire-err', { failingConsumer, orderPlaced, producer });
      const result = await run(app, 'order.create', {
        orderId: 'o-3',
        total: 1,
      });

      expect(result.isOk()).toBe(true);
      expect(fireBox.result?.isOk()).toBe(true);
      expect(capture.invocations).toHaveLength(1);
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
});
