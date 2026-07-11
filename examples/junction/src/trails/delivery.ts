/**
 * Delivery trails: the outbound half of the relay.
 *
 * `delivery.send` POSTs a payload to one target and records the attempt.
 * Transient network failures recover through a bounded detour — three
 * retries with exponential backoff — and exhaustion leaves the delivery
 * marked `failed` with its last error, wrapped in RetryExhaustedError for
 * the composer. `delivery.list` carries the pagination layer;
 * `delivery.retry` re-sends one failed delivery through the same path.
 */

import {
  NetworkError,
  NotFoundError,
  Result,
  trail,
  ValidationError,
} from '@ontrails/core';
import type { TrailContext, TrailsError } from '@ontrails/core';
import { z } from 'zod';

import { paginatedOutput, paginationLayer } from '../layers/pagination.js';
import { outboundHttpResource } from '../resources/outbound-http.js';
import { relayStoreResource } from '../resources/relay-store.js';
import type { Delivery } from '../store.js';
import { deliverySchema, deliveryStatusSchema } from '../store.js';

const RETRY_BASE_DELAY_MS = 25;

const wait = async (ms: number) => {
  await Bun.sleep(ms);
};

const sendInputSchema = z.object({
  eventId: z
    .string()
    .optional()
    .describe('Event the delivery carries; omitted for target test pings'),
  payload: z.looseObject({}).describe('JSON payload to POST to the target'),
  targetId: z.string().describe('Target to deliver to'),
});

type SendInput = z.output<typeof sendInputSchema>;

/**
 * One delivery attempt: resolve the target, POST the payload, and record
 * the outcome on the delivery row. Shared by the implementation (first attempt) and
 * the detour recover (retries), so every attempt updates the same row.
 */
const attemptDelivery = async (
  input: SendInput,
  ctx: TrailContext
): Promise<Result<Delivery, TrailsError>> => {
  const store = relayStoreResource.from(ctx);
  const client = outboundHttpResource.from(ctx);

  const target = await store.target.get(input.targetId);
  if (!target) {
    return Result.err(
      new NotFoundError(`Target "${input.targetId}" not found`)
    );
  }
  if (!target.enabled) {
    return Result.err(
      new ValidationError(`Target "${input.targetId}" is disabled`)
    );
  }

  const targetDeliveries = await store.delivery.list({
    targetId: input.targetId,
  });
  const previous = targetDeliveries.find(
    (delivery) => delivery.eventId === (input.eventId ?? null)
  );

  const attempts = (previous?.attempts ?? 0) + 1;
  const record =
    previous ??
    (await store.delivery.insert({
      attempts: 0,
      eventId: input.eventId ?? null,
      status: 'pending',
      targetId: input.targetId,
    }));

  const response = await client.post(
    target.url,
    JSON.stringify(input.payload),
    { 'x-junction-delivery': record.id }
  );

  if (response.isErr()) {
    await store.delivery.update(record.id, {
      attempts,
      lastError: response.error.message,
      status: 'failed',
    });
    return Result.err(response.error);
  }

  const delivered = await store.delivery.update(record.id, {
    attempts,
    status: 'delivered',
  });
  return Result.ok(delivered ?? { ...record, attempts, status: 'delivered' });
};

export const send = trail('delivery.send', {
  description:
    'POST a payload to one target, recording attempts; network failures retry through the bounded backoff detour',
  detours: [
    {
      maxAttempts: 3,
      on: NetworkError,
      recover: async (attempt, ctx) => {
        await wait(RETRY_BASE_DELAY_MS * 2 ** (attempt.attempt - 1));
        return attemptDelivery(attempt.input as SendInput, ctx);
      },
    },
  ],
  examples: [
    {
      description: 'Deliver a payload to the reachable logbook target',
      input: {
        payload: { junction: 'ping' },
        targetId: 'tgt_logbook',
      },
      name: 'Deliver to a reachable target',
    },
    {
      description:
        'An unreachable target exhausts the three-retry detour and fails with RetryExhaustedError',
      error: 'RetryExhaustedError',
      input: {
        payload: { junction: 'ping' },
        targetId: 'tgt_unreachable',
      },
      name: 'Deliver to an unreachable target',
    },
    {
      description: 'Disabled targets are rejected before any POST',
      error: 'ValidationError',
      input: {
        payload: { junction: 'ping' },
        targetId: 'tgt_disabled',
      },
      name: 'Deliver to a disabled target',
    },
  ],
  implementation: (input, ctx) => attemptDelivery(input, ctx),
  input: sendInputSchema,
  intent: 'write',
  output: deliverySchema,
  permit: 'public',
  resources: [outboundHttpResource, relayStoreResource],
  visibility: 'internal',
});

export const list = trail('delivery.list', {
  description: 'List deliveries filtered by status or target',
  examples: [
    {
      description: 'List every delivery',
      input: {},
      name: 'List deliveries',
    },
    {
      description: 'List only failed deliveries',
      input: { status: 'failed' },
      name: 'List failed deliveries',
    },
  ],
  implementation: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const filters = {
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
    };
    const deliveries = await store.delivery.list(
      Object.keys(filters).length === 0 ? undefined : filters
    );
    return Result.ok({
      hasMore: false,
      items: [...deliveries],
      total: deliveries.length,
    });
  },
  input: z.object({
    status: deliveryStatusSchema.optional(),
    targetId: z.string().optional().describe('Only deliveries to this target'),
  }),
  intent: 'read',
  layers: [paginationLayer],
  output: paginatedOutput(deliverySchema),
  permit: { scopes: ['relay:read'] },
  resources: [relayStoreResource],
});

export const retry = trail('delivery.retry', {
  composes: ['delivery.send'],
  description: 'Re-send one failed delivery through the delivery path',
  examples: [
    {
      description:
        'Retrying the seeded failed delivery re-attempts its unreachable target and exhausts the detour',
      error: 'RetryExhaustedError',
      input: { id: 'dlv_seed_failed' },
      name: 'Retry a failed delivery',
    },
    {
      description: 'Returns NotFoundError for an unknown delivery id',
      error: 'NotFoundError',
      input: { id: 'dlv_missing' },
      name: 'Retry unknown delivery',
    },
  ],
  implementation: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const delivery = await store.delivery.get(input.id);
    if (!delivery) {
      return Result.err(new NotFoundError(`Delivery "${input.id}" not found`));
    }
    if (delivery.eventId === null) {
      return Result.err(
        new ValidationError(`Delivery "${input.id}" has no event to re-deliver`)
      );
    }
    const event = await store.event.get(delivery.eventId);
    if (!event) {
      return Result.err(
        new NotFoundError(`Event "${delivery.eventId}" not found`)
      );
    }
    const sent = await ctx.compose?.('delivery.send', {
      eventId: event.id,
      payload: event.payload,
      targetId: delivery.targetId,
    });
    if (sent === undefined) {
      return Result.err(
        new NotFoundError('delivery.send is not composable in this context')
      );
    }
    if (sent.isErr()) {
      return Result.err(sent.error);
    }
    return Result.ok(deliverySchema.parse(sent.value));
  },
  input: z.object({ id: z.string().describe('Delivery identifier') }),
  intent: 'write',
  output: deliverySchema,
  permit: { scopes: ['relay:write'] },
  resources: [relayStoreResource],
});
