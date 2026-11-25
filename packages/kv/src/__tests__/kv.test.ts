import { describe, expect, test } from 'bun:test';
import {
  InternalError,
  Result,
  TrailsError,
  ValidationError,
  run,
  topo,
  trail,
} from '@ontrails/core';
import { testAll } from '@ontrails/testing';
import { z } from 'zod';

import {
  createKvMock,
  kv,
  kvListOptionsSchema,
  kvListPageSchema,
  kvPutOptionsSchema,
} from '../index.js';
import { createKvContractCases } from '../testing.js';

const createSubject = () => {
  let nowMs = 1_000_000;
  return {
    advanceTime: (milliseconds: number) => {
      nowMs += milliseconds;
    },
    client: createKvMock({ now: () => nowMs }),
  };
};

for (const contractCase of createKvContractCases({ createSubject })) {
  test(contractCase.name, contractCase.check);
}

describe('KV schemas', () => {
  test('validates portable options without accepting provider fields', () => {
    expect(kvPutOptionsSchema.safeParse({ ttlSeconds: 1 }).success).toBe(true);
    expect(kvPutOptionsSchema.safeParse({ ttlSeconds: 0 }).success).toBe(false);
    expect(kvPutOptionsSchema.safeParse({ ttlSeconds: 0.5 }).success).toBe(
      false
    );
    expect(kvPutOptionsSchema.safeParse({ expirationTtl: 60 }).success).toBe(
      false
    );
    expect(kvListOptionsSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  test('incomplete pages require a continuation cursor, even when empty', () => {
    expect(
      kvListPageSchema.safeParse({ complete: false, keys: [] }).success
    ).toBe(false);
    expect(
      kvListPageSchema.safeParse({
        complete: false,
        cursor: 'opaque',
        keys: [],
      }).success
    ).toBe(true);
    expect(
      kvListPageSchema.safeParse({ complete: true, keys: [] }).success
    ).toBe(true);
    expect(
      kvListPageSchema.safeParse({
        complete: true,
        cursor: 'leftover',
        keys: [],
      }).success
    ).toBe(false);
  });
});

describe('memory-specific isolation', () => {
  test('expires exactly at the deadline', async () => {
    const subject = createSubject();
    await subject.client.put('key', 'value', { ttlSeconds: 1 });
    subject.advanceTime(999);
    expect(await subject.client.get('key')).toBe('value');
    subject.advanceTime(1);
    expect(await subject.client.get('key')).toBeNull();
  });
  test('rejects cursors from another binding or query with a typed error', async () => {
    const first = createKvMock();
    await first.put('a', '1');
    await first.put('b', '2');
    const page = await first.list({ limit: 1 });
    expect(page.complete).toBe(false);
    if (page.complete) {
      throw new Error('Expected a continuation page');
    }
    await expect(
      first.list({ cursor: page.cursor, prefix: 'b' })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createKvMock().list({ cursor: page.cursor })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('rejects malformed runtime arguments without changing stored data', async () => {
    const client = createKvMock();
    await client.put('a', 'before');
    await expect(client.put('a', 1 as never)).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(
      client.put('a', 'after', { ttlSeconds: -1 })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      client.put('a', 'after', { ttlSeconds: Number.MAX_SAFE_INTEGER })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(client.list({ limit: -1 })).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(
      client.list({ cursor: 'unrecognized' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await client.get('a')).toBe('before');
  });
});

const flags = kv('flags');
const show = trail('flag.show', {
  examples: [
    {
      expected: { value: null },
      input: { key: 'missing' },
      name: 'missing value',
    },
  ],
  implementation: async (input, ctx) => {
    try {
      return Result.ok({ value: await flags.from(ctx).get(input.key) });
    } catch (error) {
      return Result.err(
        error instanceof TrailsError
          ? error
          : new InternalError('KV binding failed')
      );
    }
  },
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ value: z.string().nullable() }),
  resources: [flags],
});

test('unbound resources fail explicitly and include a default mock', async () => {
  expect(typeof flags.mock).toBe('function');
  expect(flags.role).toBe('kv');
  expect(flags.kind).toBe('resource');
  expect(Object.isFrozen(flags)).toBe(true);
  expect(topo('inspect-role', { flags }).getResource('flags')).toBe(flags);
  const result = await flags.create({
    config: undefined,
    cwd: '/',
    env: {},
    workspaceRoot: undefined,
  });
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message).toContain('resource overrides');
    if (result.error instanceof ValidationError) {
      expect(result.error.context?.['resourceId']).toBe('flags');
    }
  }
});

test('ordinary overrides resolve through the role resource accessor', async () => {
  const client = createKvMock();
  await client.put('color', 'blue');
  const result = await run(
    topo('kv-override', { flags, show }),
    'flag.show',
    { key: 'color' },
    { resources: { flags: client } }
  );
  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    expect(result.value).toEqual({ value: 'blue' });
  }
});

test('default mocks are isolated between resolutions', async () => {
  const first = await flags.mock?.();
  const second = await flags.mock?.();
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  await first?.put('color', 'red');
  expect(await second?.get('color')).toBeNull();
});

testAll(topo('kv-contract', { flags, show }));
