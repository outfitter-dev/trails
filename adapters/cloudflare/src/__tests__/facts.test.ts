/**
 * Lock facts overlay tests.
 *
 * The load-bearing guarantees: `cloudflareOverlay.derive` finds every
 * env-bound resource visible on the topo, its output satisfies the
 * overlay's own schema, and derivation is deterministic — the same topo
 * always yields a deeply-equal, identically ordered value.
 */

import { describe, expect, test } from 'bun:test';
import { Result, schedule, topo, trail } from '@ontrails/core';
import { store as defineStore } from '@ontrails/store';
import { z } from 'zod';

import { CLOUDFLARE_CRON_REALIZATION, cloudflareOverlay } from '../facts.js';
import { cloudflareD1 } from '../d1/index.js';
import { cloudflareKv } from '../kv/index.js';
import { cloudflareQueue } from '../queues/index.js';
import { cloudflareR2 } from '../r2/index.js';

const flags = cloudflareKv('flags', { binding: 'FLAGS' });
const notesStore = defineStore({
  notes: {
    identity: 'id',
    schema: z.object({ body: z.string(), id: z.string() }),
  },
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

describe('cloudflareOverlay', () => {
  test('owns the cloudflare namespace', () => {
    expect(cloudflareOverlay.namespace).toBe('cloudflare');
  });

  test('derives env-bound resource bindings from the topo', () => {
    const app = topo('cf-facts', { flags, showFlag });

    expect(cloudflareOverlay.derive(app)).toEqual({
      bindings: [{ binding: 'FLAGS', resourceId: 'flags' }],
      schedules: [],
    });
  });

  test('derived facts satisfy the overlay schema', () => {
    const app = topo('cf-facts-schema', { flags, showFlag });

    const parsed = cloudflareOverlay.schema.safeParse(
      cloudflareOverlay.derive(app)
    );
    expect(parsed.success).toBe(true);
  });

  test('derives D1 store resources through the shared env binding registry', () => {
    const notes = cloudflareD1(notesStore, {
      binding: 'DB',
      id: 'notes.store',
    });
    const saveNote = trail('note.save', {
      implementation: async (input, ctx) =>
        Result.ok(await notes.from(ctx).notes.upsert(input)),
      input: z.object({ body: z.string(), id: z.string() }),
      intent: 'write',
      output: z.object({ body: z.string(), id: z.string() }),
      resources: [notes],
    });
    const app = topo('cf-facts-d1', { notes, saveNote });

    expect(cloudflareOverlay.derive(app)).toEqual({
      bindings: [{ binding: 'DB', resourceId: 'notes.store' }],
      schedules: [],
    });
  });

  test('derives Queue producer resources through the shared env binding registry', () => {
    const jobs = cloudflareQueue<{ id: string }>('jobs', { binding: 'JOBS' });
    const enqueueJob = trail('job.enqueue', {
      implementation: async (input, ctx) => {
        await jobs.from(ctx).send(input);
        return Result.ok({ queued: true });
      },
      input: z.object({ id: z.string() }),
      intent: 'write',
      output: z.object({ queued: z.boolean() }),
      resources: [jobs],
    });
    const app = topo('cf-facts-queue', { enqueueJob, jobs });

    expect(cloudflareOverlay.derive(app)).toEqual({
      bindings: [{ binding: 'JOBS', resourceId: 'jobs' }],
      schedules: [],
    });
  });

  test('derives R2 bucket resources through the shared env binding registry', () => {
    const assets = cloudflareR2('assets', { binding: 'ASSETS' });
    const inspectAsset = trail('asset.inspect', {
      implementation: async (input, ctx) => {
        const object = await assets.from(ctx).head(input.key);
        return Result.ok({ size: object?.size ?? null });
      },
      input: z.object({ key: z.string() }),
      intent: 'read',
      output: z.object({ size: z.number().nullable() }),
      resources: [assets],
    });
    const app = topo('cf-facts-r2', { assets, inspectAsset });

    expect(cloudflareOverlay.derive(app)).toEqual({
      bindings: [{ binding: 'ASSETS', resourceId: 'assets' }],
      schedules: [],
    });
  });

  test('derive is deterministic: same topo, deeply-equal and identically ordered facts', () => {
    const sessions = cloudflareKv('sessions', { binding: 'SESSIONS' });
    const app = topo('cf-facts-deterministic', { flags, sessions, showFlag });

    const first = cloudflareOverlay.derive(app);
    const second = cloudflareOverlay.derive(app);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.bindings.map((entry) => entry.resourceId)).toEqual([
      'flags',
      'sessions',
    ]);
  });

  test('finds trail-declared env-bound resources not exported from the module', () => {
    const app = topo('cf-facts-trail-declared', { showFlag });

    expect(cloudflareOverlay.derive(app)).toEqual({
      bindings: [{ binding: 'FLAGS', resourceId: 'flags' }],
      schedules: [],
    });
  });

  test('a topo with no env-bound resources yields empty bindings', () => {
    const ping = trail('ping', {
      implementation: () => Result.ok({ pong: true }),
      input: z.object({}),
      intent: 'read',
      output: z.object({ pong: z.boolean() }),
    });
    const app = topo('cf-facts-empty', { ping });

    expect(cloudflareOverlay.derive(app)).toEqual({
      bindings: [],
      schedules: [],
    });
  });

  test('derives schedule() sources with normalized crons and the UTC-only realization', () => {
    const heartbeat = schedule('heartbeat', { cron: '*/5   *  * * *' });
    const nightly = schedule('nightly', {
      cron: '0 3 * * *',
      timezone: 'America/Chicago',
    });
    const beat = trail('heartbeat.record', {
      implementation: () => Result.ok({ beat: true }),
      input: z.object({}),
      on: [heartbeat],
      output: z.object({ beat: z.boolean() }),
    });
    const sweep = trail('sweep.run', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [nightly],
      output: z.object({ ok: z.boolean() }),
    });
    const app = topo('cf-facts-schedules', { beat, sweep });

    expect(cloudflareOverlay.derive(app)).toEqual({
      bindings: [],
      schedules: [
        {
          cron: '*/5 * * * *',
          realization: CLOUDFLARE_CRON_REALIZATION,
          sourceId: 'heartbeat',
          trailId: 'heartbeat.record',
        },
        {
          cron: '0 3 * * *',
          realization: CLOUDFLARE_CRON_REALIZATION,
          sourceId: 'nightly',
          timezone: 'America/Chicago',
          trailId: 'sweep.run',
        },
      ],
    });
    expect(
      cloudflareOverlay.schema.safeParse(cloudflareOverlay.derive(app)).success
    ).toBe(true);
  });

  test('schedule facts are ordered by trail id, source id, then cron', () => {
    const a = schedule('a', { cron: '1 * * * *' });
    const b = schedule('b', { cron: '2 * * * *' });
    const zeta = trail('zeta.run', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [b, a],
      output: z.object({ ok: z.boolean() }),
    });
    const alpha = trail('alpha.run', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [b],
      output: z.object({ ok: z.boolean() }),
    });
    const app = topo('cf-facts-schedule-order', { alpha, zeta });
    const first = cloudflareOverlay.derive(app);
    expect(JSON.stringify(cloudflareOverlay.derive(app))).toBe(
      JSON.stringify(first)
    );
    expect(
      first.schedules.map((entry) => `${entry.trailId}:${entry.sourceId}`)
    ).toEqual(['alpha.run:b', 'zeta.run:a', 'zeta.run:b']);
  });
});
