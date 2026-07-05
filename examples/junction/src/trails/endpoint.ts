/**
 * Inbound endpoint management trails.
 *
 * Endpoints carry the HMAC secret senders sign with. The secret is shown
 * exactly once — on create and on rotate — and every other read projects a
 * redacted summary, so the secret never leaks through list/get outputs or
 * error payloads.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { relayStoreResource } from '../resources/relay-store.js';
import type { Endpoint } from '../store.js';
import { endpointSchema } from '../store.js';
import { endpointSourceSchema } from '../verify.js';

/** Endpoint projection with the secret redacted. */
export const endpointSummarySchema = endpointSchema.omit({ secret: true });

const toSummary = (endpoint: Endpoint) => ({
  createdAt: endpoint.createdAt,
  enabled: endpoint.enabled,
  id: endpoint.id,
  name: endpoint.name,
  source: endpoint.source,
});

const generateSecret = (): string =>
  `jsec_${crypto.randomUUID().replaceAll('-', '')}`;

export const create = trail('endpoint.create', {
  blaze: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const endpoint = await store.endpoint.insert({
      enabled: true,
      name: input.name,
      secret: generateSecret(),
      source: input.source,
    });
    return Result.ok(endpoint);
  },
  description:
    'Register an inbound endpoint; returns the signing secret exactly once',
  examples: [
    {
      description: 'Register a GitHub endpoint and receive its secret',
      input: { name: 'CI hooks', source: 'github' },
      name: 'Create a GitHub endpoint',
    },
    {
      description: 'Register a generic HMAC endpoint',
      input: { name: 'Internal jobs', source: 'generic-hmac' },
      name: 'Create a generic endpoint',
    },
  ],
  input: z.object({
    name: z.string().min(1).describe('Human-readable endpoint name'),
    source: endpointSourceSchema,
  }),
  intent: 'write',
  output: endpointSchema,
  permit: { scopes: ['relay:write'] },
  resources: [relayStoreResource],
});

export const list = trail('endpoint.list', {
  blaze: async (_input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const endpoints = await store.endpoint.list();
    return Result.ok({ endpoints: endpoints.map(toSummary) });
  },
  description: 'List registered endpoints with secrets redacted',
  examples: [
    {
      description: 'List every registered endpoint',
      input: {},
      name: 'List endpoints',
    },
    {
      description: 'Listing is stable when called repeatedly',
      input: {},
      name: 'List endpoints again',
    },
  ],
  input: z.object({}),
  intent: 'read',
  output: z.object({ endpoints: z.array(endpointSummarySchema) }),
  permit: { scopes: ['relay:read'] },
  resources: [relayStoreResource],
});

export const get = trail('endpoint.get', {
  blaze: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const endpoint = await store.endpoint.get(input.id);
    if (!endpoint) {
      return Result.err(new NotFoundError(`Endpoint "${input.id}" not found`));
    }
    return Result.ok(toSummary(endpoint));
  },
  description: 'Show one endpoint with its secret redacted',
  examples: [
    {
      description: 'Look up the seeded GitHub endpoint',
      expected: {
        createdAt: '2026-07-01T00:00:00.000Z',
        enabled: true,
        id: 'ep_github_demo',
        name: 'GitHub demo endpoint',
        source: 'github',
      },
      input: { id: 'ep_github_demo' },
      name: 'Get an endpoint',
    },
    {
      description: 'Returns NotFoundError for an unknown endpoint id',
      error: 'NotFoundError',
      input: { id: 'ep_missing' },
      name: 'Endpoint not found',
    },
  ],
  input: z.object({ id: z.string().describe('Endpoint identifier') }),
  intent: 'read',
  output: endpointSummarySchema,
  permit: { scopes: ['relay:read'] },
  resources: [relayStoreResource],
});

export const disable = trail('endpoint.disable', {
  blaze: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const endpoint = await store.endpoint.update(input.id, { enabled: false });
    if (!endpoint) {
      return Result.err(new NotFoundError(`Endpoint "${input.id}" not found`));
    }
    return Result.ok(toSummary(endpoint));
  },
  description: 'Stop accepting webhooks on an endpoint',
  examples: [
    {
      description: 'Disable the seeded already-disabled endpoint (idempotent)',
      expected: {
        createdAt: '2026-07-01T00:00:00.000Z',
        enabled: false,
        id: 'ep_disabled_demo',
        name: 'Disabled endpoint',
        source: 'generic-hmac',
      },
      input: { id: 'ep_disabled_demo' },
      name: 'Disable an endpoint',
    },
    {
      description: 'Returns NotFoundError for an unknown endpoint id',
      error: 'NotFoundError',
      input: { id: 'ep_missing' },
      name: 'Disable unknown endpoint',
    },
  ],
  input: z.object({ id: z.string().describe('Endpoint identifier') }),
  intent: 'write',
  output: endpointSummarySchema,
  permit: { scopes: ['relay:write'] },
  resources: [relayStoreResource],
});

export const rotateSecret = trail('endpoint.rotate-secret', {
  blaze: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const endpoint = await store.endpoint.update(input.id, {
      secret: generateSecret(),
    });
    if (!endpoint) {
      return Result.err(new NotFoundError(`Endpoint "${input.id}" not found`));
    }
    return Result.ok(endpoint);
  },
  description:
    'Rotate an endpoint secret; the new secret is returned exactly once and previously stored events are unaffected',
  examples: [
    {
      description: 'Rotate the generic endpoint used for rotation demos',
      input: { id: 'ep_rotate_demo' },
      name: 'Rotate a secret',
    },
    {
      description: 'Returns NotFoundError for an unknown endpoint id',
      error: 'NotFoundError',
      input: { id: 'ep_missing' },
      name: 'Rotate unknown endpoint',
    },
  ],
  input: z.object({ id: z.string().describe('Endpoint identifier') }),
  intent: 'write',
  output: endpointSchema,
  permit: { scopes: ['relay:write'] },
  resources: [relayStoreResource],
});
