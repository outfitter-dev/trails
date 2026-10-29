import { describe, expect, test } from 'bun:test';
import { ValidationError } from '@ontrails/core';

import { createQueueMock } from '../memory.js';
import { queueBodySchema } from '../schemas.js';

describe('JSON wire domain', () => {
  test('preserves valid __proto__ data and validates its value', async () => {
    const body = JSON.parse('{"__proto__":{"id":"job"},"constructor":2}');
    const client = createQueueMock();
    await client.send(body);
    expect(JSON.stringify(client.messages()[0]?.body)).toBe(
      '{"__proto__":{"id":"job"},"constructor":2}'
    );
    const invalid = Object.defineProperty({}, '__proto__', {
      enumerable: true,
      value: undefined,
    });
    await expect(client.send(invalid)).rejects.toBeInstanceOf(ValidationError);
    expect(client.messages().length).toBe(1);
  });
  test('shared references remain valid and snapshots contain plain JSON', async () => {
    const shared = { id: 'job' };
    const client = createQueueMock();
    await client.send({ first: shared, second: shared });
    shared.id = 'changed';
    expect(client.messages()).toEqual([
      { body: { first: { id: 'job' }, second: { id: 'job' } } },
    ]);
  });
  test('rejects getters without executing them', async () => {
    let called = false;
    const body = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        called = true;
        return 1;
      },
    });
    await expect(createQueueMock().send(body)).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(called).toBe(false);
  });
  test('rejects hidden/symbol fields and sparse or decorated arrays', () => {
    const hidden = Object.defineProperty({}, 'hidden', { value: undefined });
    const symbol = { [Symbol('hidden')]: 1 };
    const sparse = Array.from({ length: 1 });
    const decorated = Object.assign([1], { extra: 2 });
    for (const body of [
      hidden,
      symbol,
      sparse,
      decorated,
      () => 1,
      Symbol('value'),
    ]) {
      expect(queueBodySchema.safeParse(body).success).toBe(false);
    }
  });
  test('hostile proxies fail with a typed infrastructure error', async () => {
    const body = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('inspection failed');
        },
      }
    );
    await expect(createQueueMock().send(body)).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});

test('inspections are isolated and clearing affects only this recorder', async () => {
  const first = createQueueMock();
  const second = createQueueMock();
  await first.send({ nested: { id: 'job' } }, { delaySeconds: 0 });
  const inspection = first.messages();
  const body = inspection[0]?.body;
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    body['nested'] = 'changed';
  }
  expect(first.messages()).toEqual([
    { body: { nested: { id: 'job' } }, delaySeconds: 0 },
  ]);
  expect(second.messages()).toEqual([]);
  first.clear();
  expect(first.messages()).toEqual([]);
  expect(second.messages()).toEqual([]);
});
