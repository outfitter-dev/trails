/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../errors';
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
  });
});
