/**
 * Relay dispatch: the reactive core of junction.
 *
 * `relay.dispatch` consumes `event.received` (fired by `webhook.receive`
 * and `event.replay`), matches the event against enabled routes and their
 * payload filters, and composes `delivery.send` once per matching route.
 * The event ends `relayed` when at least one route matched and `dead` when
 * none did. Delivery failures stay on the delivery rows; a failed target
 * does not fail the dispatch.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { relayStoreResource } from '../resources/relay-store.js';
import { eventReceived, eventReceivedPayloadSchema } from '../signals.js';
import type { Route } from '../store.js';

const readPayloadPath = (
  payload: Readonly<Record<string, unknown>>,
  path: string
): unknown => {
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const routeMatches = (
  route: Route,
  payload: Readonly<Record<string, unknown>>
): boolean => {
  if (route.filterPath === null) {
    return true;
  }
  const value = readPayloadPath(payload, route.filterPath);
  return String(value) === route.filterEquals;
};

export const dispatch = trail('relay.dispatch', {
  composes: ['delivery.send'],
  description:
    'Match one received event against enabled routes and compose delivery.send per match',
  examples: [
    {
      description:
        'Dispatch the seeded push event across its single enabled GitHub route',
      expected: { dispatched: 1, eventId: 'evt_seed_push', matched: 1 },
      input: { endpointId: 'ep_github_demo', eventId: 'evt_seed_push' },
      name: 'Dispatch a matched event',
    },
    {
      description: 'Returns NotFoundError for an unknown event id',
      error: 'NotFoundError',
      input: { endpointId: 'ep_github_demo', eventId: 'evt_missing' },
      name: 'Dispatch unknown event',
    },
  ],
  implementation: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const event = await store.event.get(input.eventId);
    if (!event) {
      return Result.err(
        new NotFoundError(`Event "${input.eventId}" not found`)
      );
    }

    const routes = await store.route.list({ endpointId: event.endpointId });
    const matching: Route[] = [];
    for (const route of routes) {
      if (!route.enabled || !routeMatches(route, event.payload)) {
        continue;
      }
      const target = await store.target.get(route.targetId);
      if (target?.enabled) {
        matching.push(route);
      }
    }

    let dispatched = 0;
    for (const route of matching) {
      const sent = await ctx.compose?.('delivery.send', {
        eventId: event.id,
        payload: event.payload,
        targetId: route.targetId,
      });
      if (sent?.isOk()) {
        dispatched += 1;
      }
    }

    await store.event.update(event.id, {
      status: matching.length > 0 ? 'relayed' : 'dead',
    });

    return Result.ok({
      dispatched,
      eventId: event.id,
      matched: matching.length,
    });
  },
  input: eventReceivedPayloadSchema,
  intent: 'write',
  on: [eventReceived],
  output: z.object({
    dispatched: z
      .number()
      .int()
      .describe('Deliveries that were sent successfully'),
    eventId: z.string().describe('Event that was dispatched'),
    matched: z.number().int().describe('Enabled routes that matched'),
  }),
  permit: 'public',
  resources: [relayStoreResource],
  visibility: 'internal',
});
