/**
 * Outbound target management trails.
 *
 * Targets are the URLs junction re-delivers verified events to.
 * `target.test` proves a target is reachable by composing the same
 * `delivery.send` trail the relay pipeline uses, so a test ping exercises
 * the real delivery path including its retry detour.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { relayStoreResource } from '../resources/relay-store.js';
import { targetSchema } from '../store.js';

export const create = trail('target.create', {
  description: 'Register an outbound delivery target',
  examples: [
    {
      description: 'Register a target URL for deliveries',
      input: { name: 'Ops receiver', url: 'https://ops.example.test/hooks' },
      name: 'Create a target',
    },
    {
      description: 'Register a second target',
      input: { name: 'Audit log', url: 'https://audit.example.test/ingest' },
      name: 'Create another target',
    },
  ],
  implementation: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const target = await store.target.insert({
      enabled: true,
      name: input.name,
      url: input.url,
    });
    return Result.ok(target);
  },
  input: z.object({
    name: z.string().min(1).describe('Human-readable target name'),
    url: z.url().describe('URL deliveries are POSTed to'),
  }),
  intent: 'write',
  output: targetSchema,
  permit: { scopes: ['relay:write'] },
  resources: [relayStoreResource],
});

export const list = trail('target.list', {
  description: 'List registered delivery targets',
  examples: [
    {
      description: 'List every registered target',
      input: {},
      name: 'List targets',
    },
    {
      description: 'Listing is stable when called repeatedly',
      input: {},
      name: 'List targets again',
    },
  ],
  implementation: async (_input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const targets = await store.target.list();
    return Result.ok({ targets: [...targets] });
  },
  input: z.object({}),
  intent: 'read',
  output: z.object({ targets: z.array(targetSchema) }),
  permit: { scopes: ['relay:read'] },
  resources: [relayStoreResource],
});

export const get = trail('target.get', {
  description: 'Show one delivery target',
  examples: [
    {
      description: 'Look up the seeded logbook target',
      expected: {
        enabled: true,
        id: 'tgt_logbook',
        name: 'Logbook receiver',
        url: 'https://targets.junction.test/logbook',
      },
      input: { id: 'tgt_logbook' },
      name: 'Get a target',
    },
    {
      description: 'Returns NotFoundError for an unknown target id',
      error: 'NotFoundError',
      input: { id: 'tgt_missing' },
      name: 'Target not found',
    },
  ],
  implementation: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const target = await store.target.get(input.id);
    if (!target) {
      return Result.err(new NotFoundError(`Target "${input.id}" not found`));
    }
    return Result.ok(target);
  },
  input: z.object({ id: z.string().describe('Target identifier') }),
  intent: 'read',
  output: targetSchema,
  permit: { scopes: ['relay:read'] },
  resources: [relayStoreResource],
});

export const disable = trail('target.disable', {
  description: 'Stop delivering to a target',
  examples: [
    {
      description: 'Disable the seeded already-disabled target (idempotent)',
      expected: {
        enabled: false,
        id: 'tgt_disabled',
        name: 'Disabled receiver',
        url: 'https://targets.junction.test/disabled',
      },
      input: { id: 'tgt_disabled' },
      name: 'Disable a target',
    },
    {
      description: 'Returns NotFoundError for an unknown target id',
      error: 'NotFoundError',
      input: { id: 'tgt_missing' },
      name: 'Disable unknown target',
    },
  ],
  implementation: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const target = await store.target.update(input.id, { enabled: false });
    if (!target) {
      return Result.err(new NotFoundError(`Target "${input.id}" not found`));
    }
    return Result.ok(target);
  },
  input: z.object({ id: z.string().describe('Target identifier') }),
  intent: 'write',
  output: targetSchema,
  permit: { scopes: ['relay:write'] },
  resources: [relayStoreResource],
});

export const test = trail('target.test', {
  composes: ['delivery.send'],
  description: 'Send a ping payload through the real delivery path',
  examples: [
    {
      description: 'Ping the reachable logbook target',
      expected: { delivered: true, targetId: 'tgt_logbook' },
      input: { id: 'tgt_logbook' },
      name: 'Test a reachable target',
    },
    {
      description: 'Returns NotFoundError for an unknown target id',
      error: 'NotFoundError',
      input: { id: 'tgt_missing' },
      name: 'Test unknown target',
    },
  ],
  implementation: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const target = await store.target.get(input.id);
    if (!target) {
      return Result.err(new NotFoundError(`Target "${input.id}" not found`));
    }
    const sent = await ctx.compose?.('delivery.send', {
      payload: { junction: 'ping', targetId: target.id },
      targetId: target.id,
    });
    if (sent === undefined) {
      return Result.err(
        new NotFoundError('delivery.send is not composable in this context')
      );
    }
    if (sent.isErr()) {
      return Result.err(sent.error);
    }
    return Result.ok({ delivered: true, targetId: target.id });
  },
  input: z.object({ id: z.string().describe('Target identifier') }),
  intent: 'write',
  output: z.object({
    delivered: z.boolean().describe('Whether the ping was delivered'),
    targetId: z.string().describe('Target that received the ping'),
  }),
  permit: { scopes: ['relay:write'] },
  resources: [relayStoreResource],
});
