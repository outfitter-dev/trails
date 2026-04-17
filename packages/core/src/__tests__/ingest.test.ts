/* oxlint-disable require-await -- layer wrappers satisfy async interfaces without awaiting */
import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { ValidationError } from '../errors.js';
import type { Layer } from '../layer.js';
import { Result } from '../result.js';
import { run } from '../run.js';
import { signal } from '../signal.js';
import { topo } from '../topo.js';
import { trail } from '../trail.js';
import { ingest } from '../trails/index.js';

const withExamples = <TSchema extends z.ZodType>(
  schema: TSchema,
  examples: readonly z.input<TSchema>[]
): TSchema & { readonly examples: readonly z.input<TSchema>[] } =>
  Object.assign(schema, { examples });

const paymentCompleted = signal('payment.completed', {
  payload: z.object({
    amount: z.number(),
    paymentId: z.string(),
  }),
});

const rawPaymentEvent = z.object({
  amount: z.number(),
  paymentId: z.string(),
});

const stripeEvent = z.object({
  data: z.object({
    object: z.object({
      amount: z.number(),
      id: z.string(),
    }),
  }),
});

const createConsumer = (
  id: string,
  capture: { payloads: unknown[] },
  source = paymentCompleted
) =>
  trail(id, {
    blaze: (input) => {
      capture.payloads.push(input);
      return Result.ok({ ok: true });
    },
    input: source.payload,
    on: [source],
  });

describe('ingest()', () => {
  test('derives id, intent, fires, output schema, and examples from schema examples', () => {
    const schema = withExamples(rawPaymentEvent, [
      { amount: 42, paymentId: 'pay_1' },
      { amount: 7, paymentId: 'pay_2' },
    ]);

    const paymentIngest = ingest({
      schema,
      signal: paymentCompleted,
    });

    expect(paymentIngest.id).toBe('payment.completed.ingest');
    expect(paymentIngest.intent).toBe('write');
    expect(paymentIngest.pattern).toBe('ingest');
    expect(paymentIngest.fires).toEqual(['payment.completed']);
    expect(paymentIngest.output?.safeParse().success).toBe(true);
    expect(paymentIngest.examples).toEqual([
      {
        input: { amount: 42, paymentId: 'pay_1' },
        name: 'Ingest payment.completed 1',
      },
      {
        input: { amount: 7, paymentId: 'pay_2' },
        name: 'Ingest payment.completed 2',
      },
    ]);
  });

  test('validates input before attempting to emit the signal', async () => {
    const capture = { payloads: [] as unknown[] };
    const paymentIngest = ingest({
      schema: rawPaymentEvent,
      signal: paymentCompleted,
    });

    const app = topo('ingest-validation', {
      consumer: createConsumer('payments.capture', capture),
      paymentCompleted,
      paymentIngest,
    });

    const result = await run(app, paymentIngest.id, {
      amount: '42',
      paymentId: 'pay_1',
    });

    expect(result.isErr()).toBe(true);
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(capture.payloads).toEqual([]);
  });

  test('applies the verification layer when provided', async () => {
    const wrapped: string[] = [];
    const verify: Layer = {
      name: 'verify',
      wrap: (trailDef, implementation) => async (input, ctx) => {
        wrapped.push(trailDef.id);
        return await implementation(input, ctx);
      },
    };
    const capture = { payloads: [] as unknown[] };
    const paymentIngest = ingest({
      schema: rawPaymentEvent,
      signal: paymentCompleted,
      verify,
    });

    const app = topo('ingest-verify', {
      consumer: createConsumer('payments.capture', capture),
      paymentCompleted,
      paymentIngest,
    });

    const result = await run(app, paymentIngest.id, {
      amount: 42,
      paymentId: 'pay_1',
    });

    expect(result.isOk()).toBe(true);
    expect(wrapped).toEqual(['payment.completed.ingest']);
    expect(capture.payloads).toEqual([{ amount: 42, paymentId: 'pay_1' }]);
  });

  test('emits the declared signal after successful ingestion', async () => {
    const capture = { payloads: [] as unknown[] };
    const paymentIngest = ingest({
      schema: rawPaymentEvent,
      signal: paymentCompleted,
    });

    const app = topo('ingest-fire', {
      consumer: createConsumer('payments.capture', capture),
      paymentCompleted,
      paymentIngest,
    });

    const result = await run(app, paymentIngest.id, {
      amount: 42,
      paymentId: 'pay_1',
    });

    expect(result.isOk()).toBe(true);
    expect(capture.payloads).toEqual([{ amount: 42, paymentId: 'pay_1' }]);
  });

  test('applies the transform before emitting the signal payload', async () => {
    const capture = { payloads: [] as unknown[] };
    const paymentIngest = ingest({
      schema: stripeEvent,
      signal: paymentCompleted,
      transform: (payload) => ({
        amount: payload.data.object.amount,
        paymentId: payload.data.object.id,
      }),
    });

    const app = topo('ingest-transform', {
      consumer: createConsumer('payments.capture', capture),
      paymentCompleted,
      paymentIngest,
    });

    const result = await run(app, paymentIngest.id, {
      data: {
        object: {
          amount: 99,
          id: 'pay_99',
        },
      },
    });

    expect(result.isOk()).toBe(true);
    expect(capture.payloads).toEqual([{ amount: 99, paymentId: 'pay_99' }]);
  });
});
