import { expect, test } from 'bun:test';
import { InternalError, NetworkError, ValidationError } from '@ontrails/core';

import { createCloudflareKvBinding, createMemoryKv } from '../index.js';

const capture = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('Expected failure');
};

test('KV binding preserves receivers and translates TTL and explicit page completion', async () => {
  const memory = createMemoryKv();
  const received: unknown[] = [];
  const native = {
    delete(key: string) {
      expect(this).toBe(native);
      return memory.delete(key);
    },
    get(key: string) {
      expect(this).toBe(native);
      return memory.get(key);
    },
    list(options: Parameters<typeof memory.list>[0]) {
      expect(this).toBe(native);
      return memory.list(options);
    },
    put(key: string, value: string, options: Parameters<typeof memory.put>[2]) {
      expect(this).toBe(native);
      received.push(options);
      return memory.put(key, value, options);
    },
  };
  const client = createCloudflareKvBinding(native);
  await client.put('flag/a', 'a', { ttlSeconds: 60 });
  await client.put('flag/b', 'b');
  expect(received).toEqual([{ expirationTtl: 60 }, undefined]);
  const first = await client.list({ limit: 1, prefix: 'flag/' });
  expect(first.complete).toBe(false);
  if (first.complete) {
    throw new Error('Expected continuation');
  }
  expect(first.cursor).not.toBe('flag/a');
  const last = await client.list({
    cursor: first.cursor,
    limit: 1,
    prefix: 'flag/',
  });
  expect(last).toEqual({ complete: true, keys: ['flag/b'] });
  expect(await client.get('flag/a')).toBe('a');
  await client.delete('flag/a');
  expect(await client.get('flag/a')).toBeNull();
});

test('KV rejects invalid input and cursor scope before native I/O', async () => {
  let attempts = 0;
  const memory = createMemoryKv();
  await memory.put('flag/a', 'a');
  await memory.put('flag/b', 'b');
  const client = createCloudflareKvBinding({
    ...memory,
    list: async (options: Parameters<typeof memory.list>[0]) => {
      attempts += 1;
      return memory.list(options);
    },
    put: async () => {
      attempts += 1;
    },
  });
  for (const ttlSeconds of [0, 1, 59, 0.5, Number.POSITIVE_INFINITY]) {
    await expect(
      client.put('key', 'value', { ttlSeconds })
    ).rejects.toBeInstanceOf(ValidationError);
  }
  for (const input of [
    { limit: 0 },
    { limit: 1001 },
    { cursor: '' },
    { cursor: 'not JSON' },
  ]) {
    await expect(client.list(input)).rejects.toBeInstanceOf(ValidationError);
  }
  expect(attempts).toBe(0);
  const page = await client.list({ limit: 1, prefix: 'flag/' });
  if (page.complete) {
    throw new Error('Expected continuation');
  }
  attempts = 0;
  await expect(
    client.list({ cursor: page.cursor, prefix: 'other/' })
  ).rejects.toBeInstanceOf(ValidationError);
  const other = createCloudflareKvBinding({
    ...memory,
    list: async () => {
      attempts += 1;
      return { keys: [], list_complete: true };
    },
  });
  await expect(
    other.list({ cursor: page.cursor, prefix: 'flag/' })
  ).rejects.toBeInstanceOf(ValidationError);
  expect(attempts).toBe(0);
});

test('KV keeps empty incomplete native pages iterable', async () => {
  let calls = 0;
  const client = createCloudflareKvBinding({
    ...createMemoryKv(),
    list: async () => {
      calls += 1;
      return calls === 1
        ? { cursor: 'native-next', keys: [], list_complete: false }
        : { keys: [{ name: 'key' }], list_complete: true };
    },
  });
  const page = await client.list();
  if (page.complete) {
    throw new Error('Expected incomplete empty page');
  }
  expect(page.keys).toEqual([]);
  expect(await client.list({ cursor: page.cursor })).toEqual({
    complete: true,
    keys: ['key'],
  });
});

test('KV native errors preserve typed identity and map unknown rejections to NetworkError', async () => {
  const typed = new ValidationError('native typed rejection');
  const opaque = new Error('native opaque rejection');
  for (const error of [typed, opaque, 'non-error rejection']) {
    const client = createCloudflareKvBinding({
      ...createMemoryKv(),
      get: async () => {
        // oxlint-disable-next-line no-throw-literal -- exercise native non-Error rejection handling
        throw error;
      },
    });
    const failure = await capture(client.get('key'));
    if (error === typed) {
      expect(failure).toBe(typed);
    } else {
      expect(failure).toBeInstanceOf(NetworkError);
      expect(failure).toMatchObject({
        context: { operation: 'get', role: 'kv' },
        message: 'Cloudflare kv get failed',
        retryable: true,
      });
      if (error === opaque) {
        expect((failure as Error).cause).toBe(opaque);
      }
    }
  }
});

test('KV rejects malformed native results as internal failures, not caller validation or network failures', async () => {
  const client = createCloudflareKvBinding({
    ...createMemoryKv(),
    list: async () => ({ keys: [], list_complete: false }),
  });
  const error = await capture(client.list());
  expect(error).toBeInstanceOf(InternalError);
  expect(error).not.toBeInstanceOf(NetworkError);
  expect(error).not.toBeInstanceOf(ValidationError);
  const env: Record<string, unknown> = {};
  expect(() => createCloudflareKvBinding(env['MISSING'])).toThrow(
    ValidationError
  );
});
