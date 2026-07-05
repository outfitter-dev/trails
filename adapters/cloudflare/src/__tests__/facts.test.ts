/**
 * Lock facts overlay tests.
 *
 * The load-bearing guarantees: `cloudflareOverlay.derive` finds every
 * env-bound resource visible on the topo, its output satisfies the
 * overlay's own schema, and derivation is deterministic — the same topo
 * always yields a deeply-equal, identically ordered value.
 */

import { describe, expect, test } from 'bun:test';
import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { cloudflareOverlay } from '../facts.js';
import { cloudflareKv } from '../kv/index.js';

const flags = cloudflareKv('flags', { binding: 'FLAGS' });

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

describe('cloudflareOverlay', () => {
  test('owns the cloudflare namespace', () => {
    expect(cloudflareOverlay.namespace).toBe('cloudflare');
  });

  test('derives env-bound resource bindings from the topo', () => {
    const app = topo('cf-facts', { flags, showFlag });

    expect(cloudflareOverlay.derive(app)).toEqual({
      bindings: [{ binding: 'FLAGS', resourceId: 'flags' }],
    });
  });

  test('derived facts satisfy the overlay schema', () => {
    const app = topo('cf-facts-schema', { flags, showFlag });

    const parsed = cloudflareOverlay.schema.safeParse(
      cloudflareOverlay.derive(app)
    );
    expect(parsed.success).toBe(true);
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
    });
  });

  test('a topo with no env-bound resources yields empty bindings', () => {
    const ping = trail('ping', {
      blaze: () => Result.ok({ pong: true }),
      input: z.object({}),
      intent: 'read',
      output: z.object({ pong: z.boolean() }),
    });
    const app = topo('cf-facts-empty', { ping });

    expect(cloudflareOverlay.derive(app)).toEqual({ bindings: [] });
  });
});
