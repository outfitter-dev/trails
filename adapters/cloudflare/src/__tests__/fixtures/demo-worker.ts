/**
 * Demo Worker for the miniflare integration lane.
 *
 * A small Trails app serving HTTP routes (read + write), a webhook route,
 * a KV-backed schedule, and a KV-backed trail — the wired combination the README teaches. Bundled
 * by `../miniflare.test.ts` and executed under workerd via miniflare.
 */

import {
  getWebhookHeader,
  PermissionError,
  Result,
  schedule,
  topo,
  trail,
  webhook,
} from '@ontrails/core';
import { store as defineStore } from '@ontrails/store';
import { z } from 'zod';

import { cloudflareD1 } from '../../d1/index.js';
import { cloudflareKv } from '../../kv/index.js';
import { createWorkersHandler } from '../../workers/index.js';

const flags = cloudflareKv('flags', { binding: 'FLAGS' });
const notesStore = defineStore({
  notes: {
    identity: 'id',
    schema: z.object({ body: z.string(), id: z.string() }),
  },
});
const notes = cloudflareD1(notesStore, {
  autoCreate: true,
  binding: 'DB',
  id: 'notes.store',
});

const ping = trail('ping', {
  implementation: (input) => Result.ok({ reply: `pong:${input.message}` }),
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
});

const saveFlag = trail('flag.save', {
  implementation: async (input, ctx) => {
    await flags.from(ctx).put(input.key, input.value);
    return Result.ok({ saved: true });
  },
  input: z.object({ key: z.string(), value: z.string() }),
  intent: 'write',
  output: z.object({ saved: z.boolean() }),
  resources: [flags],
});

const showFlag = trail('flag.show', {
  implementation: async (input, ctx) => {
    const value = await flags.from(ctx).get(input.key);
    return Result.ok({ value });
  },
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ value: z.string().nullable() }),
  resources: [flags],
});

const saveNote = trail('note.save', {
  implementation: async (input, ctx) =>
    Result.ok(await notes.from(ctx).notes.upsert(input)),
  input: z.object({ body: z.string(), id: z.string() }),
  intent: 'write',
  output: z.object({ body: z.string(), id: z.string() }),
  resources: [notes],
});

const showNote = trail('note.show', {
  implementation: async (input, ctx) =>
    Result.ok({ note: await notes.from(ctx).notes.get(input.id) }),
  input: z.object({ id: z.string() }),
  intent: 'read',
  output: z.object({
    note: z.object({ body: z.string(), id: z.string() }).nullable(),
  }),
  resources: [notes],
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
  implementation: async (input, ctx) => {
    await flags.from(ctx).put(`deploy/${input.deployId}`, 'finished');
    return Result.ok({ deployId: input.deployId });
  },
  input: z.object({ deployId: z.string() }),
  on: [deployWebhook],
  output: z.object({ deployId: z.string() }),
  resources: [flags],
});

const heartbeat = schedule('heartbeat', { cron: '*/5 * * * *' });

const recordHeartbeat = trail('heartbeat.record', {
  implementation: async (_input, ctx) => {
    await flags.from(ctx).put('heartbeat', 'beat');
    return Result.ok({ beat: true });
  },
  input: z.object({}),
  on: [heartbeat],
  output: z.object({ beat: z.boolean() }),
  resources: [flags],
});

const graph = topo('cf-demo', {
  flags,
  notes,
  ping,
  recordDeploy,
  recordHeartbeat,
  saveFlag,
  saveNote,
  showFlag,
  showNote,
});

export default createWorkersHandler(graph);
