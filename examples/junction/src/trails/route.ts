/**
 * Route management trails.
 *
 * A route binds one endpoint to one target with an optional payload filter
 * (`{ filterPath, filterEquals }`). `route.create` validates that both ends
 * of the binding exist before writing, so dangling routes cannot be
 * authored.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { relayStoreResource } from '../resources/relay-store.js';
import type { Route } from '../store.js';
import { routeSchema } from '../store.js';

export const create = trail('route.create', {
  blaze: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const endpoint = await store.endpoint.get(input.endpointId);
    if (!endpoint) {
      return Result.err(
        new NotFoundError(`Endpoint "${input.endpointId}" not found`)
      );
    }
    const target = await store.target.get(input.targetId);
    if (!target) {
      return Result.err(
        new NotFoundError(`Target "${input.targetId}" not found`)
      );
    }
    const route = await store.route.insert({
      enabled: true,
      endpointId: input.endpointId,
      filterEquals: input.filterEquals ?? null,
      filterPath: input.filterPath ?? null,
      targetId: input.targetId,
    });
    return Result.ok(route);
  },
  description: 'Bind an endpoint to a target with an optional payload filter',
  examples: [
    {
      description: 'Route the rotation-demo endpoint to the logbook target',
      input: { endpointId: 'ep_rotate_demo', targetId: 'tgt_logbook' },
      name: 'Create a route',
    },
    {
      description: 'Returns NotFoundError when the endpoint does not exist',
      error: 'NotFoundError',
      input: { endpointId: 'ep_missing', targetId: 'tgt_logbook' },
      name: 'Route with unknown endpoint',
    },
    {
      description: 'Returns NotFoundError when the target does not exist',
      error: 'NotFoundError',
      input: { endpointId: 'ep_github_demo', targetId: 'tgt_missing' },
      name: 'Route with unknown target',
    },
  ],
  input: z.object({
    endpointId: z.string().describe('Endpoint the route listens on'),
    filterEquals: z
      .string()
      .optional()
      .describe('Value the payload path must equal for the route to match'),
    filterPath: z
      .string()
      .optional()
      .describe('Dot-separated payload path the filter reads'),
    targetId: z.string().describe('Target the route delivers to'),
  }),
  intent: 'write',
  output: routeSchema,
  permit: { scopes: ['relay:write'] },
  resources: [relayStoreResource],
});

export const list = trail('route.list', {
  blaze: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const routes = await store.route.list(
      input.endpointId === undefined
        ? undefined
        : { endpointId: input.endpointId }
    );
    return Result.ok({ routes: [...routes] });
  },
  description: 'List routes, optionally scoped to one endpoint',
  examples: [
    {
      description: 'List every route',
      input: {},
      name: 'List routes',
    },
    {
      description: 'List routes for the seeded Stripe endpoint',
      expected: {
        routes: [
          {
            enabled: true,
            endpointId: 'ep_stripe_demo',
            filterEquals: 'payment_intent.succeeded',
            filterPath: 'type',
            id: 'rt_stripe_payments',
            targetId: 'tgt_logbook',
          },
        ],
      },
      input: { endpointId: 'ep_stripe_demo' },
      name: 'List routes for one endpoint',
    },
  ],
  input: z.object({
    endpointId: z
      .string()
      .optional()
      .describe('Only list routes bound to this endpoint'),
  }),
  intent: 'read',
  output: z.object({ routes: z.array(routeSchema) }),
  permit: { scopes: ['relay:read'] },
  resources: [relayStoreResource],
});

const setEnabled = async (
  ctx: TrailContext,
  id: string,
  enabled: boolean
): Promise<Result<Route, NotFoundError>> => {
  const store = relayStoreResource.from(ctx);
  const route = await store.route.update(id, { enabled });
  if (!route) {
    return Result.err(new NotFoundError(`Route "${id}" not found`));
  }
  return Result.ok(route);
};

export const enable = trail('route.enable', {
  blaze: (input, ctx) => setEnabled(ctx, input.id, true),
  description: 'Resume relaying events across a route',
  examples: [
    {
      description: 'Enable the seeded toggle demo route',
      input: { id: 'rt_toggle_demo' },
      name: 'Enable a route',
    },
    {
      description: 'Returns NotFoundError for an unknown route id',
      error: 'NotFoundError',
      input: { id: 'rt_missing' },
      name: 'Enable unknown route',
    },
  ],
  input: z.object({ id: z.string().describe('Route identifier') }),
  intent: 'write',
  output: routeSchema,
  permit: { scopes: ['relay:write'] },
  resources: [relayStoreResource],
});

export const disable = trail('route.disable', {
  blaze: (input, ctx) => setEnabled(ctx, input.id, false),
  description: 'Pause relaying events across a route',
  examples: [
    {
      description: 'Disable the seeded already-disabled route (idempotent)',
      expected: {
        enabled: false,
        endpointId: 'ep_github_demo',
        filterEquals: null,
        filterPath: null,
        id: 'rt_disabled',
        targetId: 'tgt_disabled',
      },
      input: { id: 'rt_disabled' },
      name: 'Disable a route',
    },
    {
      description: 'Returns NotFoundError for an unknown route id',
      error: 'NotFoundError',
      input: { id: 'rt_missing' },
      name: 'Disable unknown route',
    },
  ],
  input: z.object({ id: z.string().describe('Route identifier') }),
  intent: 'write',
  output: routeSchema,
  permit: { scopes: ['relay:write'] },
  resources: [relayStoreResource],
});
