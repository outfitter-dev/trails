/**
 * Demo Worker for the miniflare integration lane.
 *
 * A small Trails app serving HTTP routes (read + write), a webhook route,
 * and a KV-backed trail — the wired combination the README teaches. Bundled
 * by `../miniflare.test.ts` and executed under workerd via miniflare.
 */

import {
  getWebhookHeader,
  PermissionError,
  Result,
  topo,
  trail,
  webhook,
} from '@ontrails/core';
import { z } from 'zod';

import { cloudflareKv } from '../../kv/index.js';
import { createWorkersHandler } from '../../workers/index.js';

const flags = cloudflareKv('flags', { binding: 'FLAGS' });

const ping = trail('ping', {
  blaze: (input) => Result.ok({ reply: `pong:${input.message}` }),
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
});

const saveFlag = trail('flag.save', {
  blaze: async (input, ctx) => {
    await flags.from(ctx).put(input.key, input.value);
    return Result.ok({ saved: true });
  },
  input: z.object({ key: z.string(), value: z.string() }),
  intent: 'write',
  output: z.object({ saved: z.boolean() }),
  resources: [flags],
});

const showFlag = trail('flag.show', {
  blaze: async (input, ctx) => {
    const value = await flags.from(ctx).get(input.key);
    return Result.ok({ value });
  },
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ value: z.string().nullable() }),
  resources: [flags],
});

const deploySecret = 'demo-secret';
const deployWebhook = webhook('webhook.deploy.finished', {
  parse: z.object({ deployId: z.string() }),
  path: '/webhooks/deploy',
  verify: (request) =>
    getWebhookHeader(request, 'x-webhook-secret') === deploySecret
      ? Result.ok()
      : Result.err(new PermissionError('Invalid webhook secret')),
});

const recordDeploy = trail('deploy.record', {
  blaze: async (input, ctx) => {
    await flags.from(ctx).put(`deploy/${input.deployId}`, 'finished');
    return Result.ok({ deployId: input.deployId });
  },
  input: z.object({ deployId: z.string() }),
  on: [deployWebhook],
  output: z.object({ deployId: z.string() }),
  resources: [flags],
});

const graph = topo('cf-demo', {
  flags,
  ping,
  recordDeploy,
  saveFlag,
  showFlag,
});

export default createWorkersHandler(graph);
