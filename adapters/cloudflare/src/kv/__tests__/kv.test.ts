import { describe, expect, test } from 'bun:test';
import { Result, topo, trail } from '@ontrails/core';
import { testAll } from '@ontrails/testing';
import { z } from 'zod';

import { cloudflareKv, createMemoryKv } from '../index.js';

describe('createMemoryKv', () => {
  test('round-trips put/get/delete', async () => {
    const kv = createMemoryKv();

    expect(await kv.get('color')).toBeNull();
    await kv.put('color', 'red');
    expect(await kv.get('color')).toBe('red');
    await kv.delete('color');
    expect(await kv.get('color')).toBeNull();
  });

  test('expires entries by expirationTtl', async () => {
    let nowMs = 1_000_000;
    const kv = createMemoryKv({ now: () => nowMs });

    await kv.put('session', 'abc', { expirationTtl: 60 });
    expect(await kv.get('session')).toBe('abc');

    nowMs += 59_999;
    expect(await kv.get('session')).toBe('abc');

    nowMs += 1;
    expect(await kv.get('session')).toBeNull();
  });

  test('expires entries by absolute expiration and prefers expirationTtl', async () => {
    let nowMs = 5_000_000;
    const kv = createMemoryKv({ now: () => nowMs });

    await kv.put('absolute', 'x', { expiration: 5100 });
    await kv.put('both', 'y', { expiration: 5100, expirationTtl: 300 });

    nowMs = 5_100_000;
    expect(await kv.get('absolute')).toBeNull();
    expect(await kv.get('both')).toBe('y');

    nowMs = 5_000_000 + 300_000;
    expect(await kv.get('both')).toBeNull();
  });

  test('lists keys sorted with prefix filtering and expirations', async () => {
    let nowMs = 1_000_000;
    const kv = createMemoryKv({ now: () => nowMs });

    await kv.put('flag/beta', 'on');
    await kv.put('flag/alpha', 'off', { expirationTtl: 120 });
    await kv.put('session/1', 'x');

    const listed = await kv.list({ prefix: 'flag/' });
    expect(listed.list_complete).toBe(true);
    expect(listed.cursor).toBeUndefined();
    expect(listed.keys).toEqual([
      { expiration: 1120, name: 'flag/alpha' },
      { name: 'flag/beta' },
    ]);

    nowMs += 121_000;
    const afterExpiry = await kv.list({ prefix: 'flag/' });
    expect(afterExpiry.keys).toEqual([{ name: 'flag/beta' }]);
  });

  test('paginates with limit and cursor', async () => {
    const kv = createMemoryKv();
    await kv.put('a', '1');
    await kv.put('b', '2');
    await kv.put('c', '3');

    const first = await kv.list({ limit: 2 });
    expect(first.keys.map((key) => key.name)).toEqual(['a', 'b']);
    expect(first.list_complete).toBe(false);
    expect(first.cursor).toBe('b');

    const second = await kv.list({ cursor: first.cursor, limit: 2 });
    expect(second.keys.map((key) => key.name)).toEqual(['c']);
    expect(second.list_complete).toBe(true);
    expect(second.cursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Resource definition + configuration-free testAll
// ---------------------------------------------------------------------------

const flags = cloudflareKv('flags', { binding: 'FLAGS' });

const saveFlag = trail('flag.save', {
  blaze: async (input, ctx) => {
    await flags.from(ctx).put(input.key, input.value);
    return Result.ok({ saved: true });
  },
  examples: [
    {
      expected: { saved: true },
      input: { key: 'color', value: 'red' },
      name: 'saves a flag',
    },
  ],
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
  examples: [
    {
      expected: { value: null },
      input: { key: 'missing' },
      name: 'reads a missing flag as null',
    },
  ],
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ value: z.string().nullable() }),
  resources: [flags],
});

const graph = topo('cf-kv', { flags, saveFlag, showFlag });

describe('cloudflareKv resource', () => {
  test('declares the binding on meta and a mock factory', () => {
    expect(flags.id).toBe('flags');
    expect(flags.meta?.['cloudflare.binding']).toBe('FLAGS');
    expect(typeof flags.mock).toBe('function');
  });

  test('create refuses to run outside a Workers env with guidance', async () => {
    const created = await flags.create({
      config: undefined,
      cwd: '/',
      env: {},
      workspaceRoot: undefined,
    });
    expect(created.isErr()).toBe(true);
    if (created.isErr()) {
      expect(created.error.message).toContain('FLAGS');
      expect(created.error.message).toContain('createWorkersHandler');
    }
  });
});

// Configuration-free contract suite: examples run against the in-memory mock.
testAll(graph);
