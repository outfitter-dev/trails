/**
 * Event read and replay trails.
 *
 * `event.list` carries the pagination layer: the trail's own input filters
 * by endpoint, status, and receipt time, while `limit`/`offset` come from
 * the layer's projected input on every surface. `event.replay` re-fires
 * `event.received` for one stored event so the relay pipeline runs again.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { paginatedOutput, paginationLayer } from '../layers/pagination.js';
import { relayStoreResource } from '../resources/relay-store.js';
import { eventReceived } from '../signals.js';
import { eventSchema, eventStatusSchema } from '../store.js';

export const list = trail('event.list', {
  description:
    'List received events, newest first, filtered by endpoint, status, or receipt time',
  examples: [
    {
      description: 'List every stored event',
      input: {},
      name: 'List events',
    },
    {
      description: 'List only events that failed signature verification',
      input: { status: 'dead' },
      name: 'List dead events',
    },
  ],
  implementation: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const filters = {
      ...(input.endpointId === undefined
        ? {}
        : { endpointId: input.endpointId }),
      ...(input.status === undefined ? {} : { status: input.status }),
    };
    const events = await store.event.list(
      Object.keys(filters).length === 0 ? undefined : filters
    );
    const { since } = input;
    const matching =
      since === undefined
        ? [...events]
        : events.filter((event) => event.receivedAt >= since);
    const ordered = matching.toSorted((left, right) =>
      right.receivedAt.localeCompare(left.receivedAt)
    );
    return Result.ok({
      hasMore: false,
      items: ordered,
      total: ordered.length,
    });
  },
  input: z.object({
    endpointId: z
      .string()
      .optional()
      .describe('Only events received on this endpoint'),
    since: z
      .string()
      .optional()
      .describe('Only events received at or after this ISO-8601 timestamp'),
    status: eventStatusSchema.optional(),
  }),
  intent: 'read',
  layers: [paginationLayer],
  output: paginatedOutput(eventSchema),
  permit: { scopes: ['relay:read'] },
  resources: [relayStoreResource],
});

export const get = trail('event.get', {
  description: 'Show one stored event including its payload and headers',
  examples: [
    {
      description: 'Look up the seeded push event',
      expected: {
        endpointId: 'ep_github_demo',
        headers: { 'x-github-event': 'push' },
        id: 'evt_seed_push',
        payload: { action: 'push', repository: 'outfitter-dev/trails' },
        receivedAt: '2026-07-01T08:00:00.000Z',
        signatureValid: true,
        status: 'relayed',
      },
      input: { id: 'evt_seed_push' },
      name: 'Get an event',
    },
    {
      description: 'Returns NotFoundError for an unknown event id',
      error: 'NotFoundError',
      input: { id: 'evt_missing' },
      name: 'Event not found',
    },
  ],
  implementation: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const event = await store.event.get(input.id);
    if (!event) {
      return Result.err(new NotFoundError(`Event "${input.id}" not found`));
    }
    return Result.ok(event);
  },
  input: z.object({ id: z.string().describe('Event identifier') }),
  intent: 'read',
  output: eventSchema,
  permit: { scopes: ['relay:read'] },
  resources: [relayStoreResource],
});

export const replay = trail('event.replay', {
  description: 'Re-fire event.received for one stored event',
  examples: [
    {
      description: 'Replay the seeded push event through the relay pipeline',
      expected: { eventId: 'evt_seed_push', replayed: true },
      input: { id: 'evt_seed_push' },
      name: 'Replay an event',
    },
    {
      description: 'Returns NotFoundError for an unknown event id',
      error: 'NotFoundError',
      input: { id: 'evt_missing' },
      name: 'Replay unknown event',
    },
  ],
  fires: [eventReceived],
  implementation: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const event = await store.event.get(input.id);
    if (!event) {
      return Result.err(new NotFoundError(`Event "${input.id}" not found`));
    }
    await ctx.fire?.(eventReceived, {
      endpointId: event.endpointId,
      eventId: event.id,
    });
    return Result.ok({ eventId: event.id, replayed: true });
  },
  input: z.object({ id: z.string().describe('Event identifier to replay') }),
  intent: 'write',
  output: z.object({
    eventId: z.string().describe('Event that was replayed'),
    replayed: z.boolean().describe('Whether the signal fired'),
  }),
  permit: { scopes: ['relay:write'] },
  resources: [relayStoreResource],
});
