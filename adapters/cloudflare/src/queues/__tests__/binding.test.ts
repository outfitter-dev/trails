import { expect, test } from 'bun:test';
import { NetworkError, ValidationError } from '@ontrails/core';

import { createCloudflareQueueBinding } from '../index.js';

const invalidBodies = (): unknown[] => {
  const cycle: Record<string, unknown> = {};
  cycle['self'] = cycle;
  return [
    undefined,
    Number.NaN,
    1n,
    new Date(),
    cycle,
    Object.defineProperty({}, '__proto__', {
      enumerable: true,
      value: undefined,
    }),
  ];
};

test('Queue validates and snapshots the complete submission before preserving native calls and receivers', async () => {
  const accepted: unknown[] = [];
  const native = {
    async send(body: unknown, options: unknown) {
      expect(this).toBe(native);
      accepted.push({ body, options });
    },
    async sendBatch(messages: unknown) {
      expect(this).toBe(native);
      accepted.push(messages);
    },
  };
  const client = createCloudflareQueueBinding(native);
  const body = JSON.parse('{"__proto__":{"kept":true},"constructor":2}');
  await client.send(body, { delaySeconds: 0 });
  const proto = Object.getOwnPropertyDescriptor(body, '__proto__');
  if (proto === undefined) {
    throw new Error('Missing own data property');
  }
  proto.value.kept = false;
  await client.send('default');
  const batch = [{ body: { id: 'first' } }, { body: null, delaySeconds: 0 }];
  await client.sendBatch(batch);
  batch[0] = { body: { id: 'changed' } };
  expect(accepted).toEqual([
    {
      body: JSON.parse('{"__proto__":{"kept":true},"constructor":2}'),
      options: { contentType: 'json', delaySeconds: 0 },
    },
    { body: 'default', options: { contentType: 'json' } },
    [
      { body: { id: 'first' }, contentType: 'json' },
      { body: null, contentType: 'json', delaySeconds: 0 },
    ],
  ]);
});

test('Queue rejects invalid complete batches and documented provider limits without native attempts', async () => {
  let attempts = 0;
  const client = createCloudflareQueueBinding({
    send: async () => {
      attempts += 1;
    },
    sendBatch: async () => {
      attempts += 1;
    },
  });
  for (const body of invalidBodies()) {
    await expect(client.send(body as never)).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(
      client.sendBatch([{ body: 'valid' }, { body: body as never }])
    ).rejects.toBeInstanceOf(ValidationError);
  }
  for (const delaySeconds of [-1, 0.5, 86_401]) {
    await expect(client.send('body', { delaySeconds })).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(
      client.sendBatch([{ body: 'valid' }, { body: 'later', delaySeconds }])
    ).rejects.toBeInstanceOf(ValidationError);
  }
  await expect(client.send('x'.repeat(128_001))).rejects.toBeInstanceOf(
    ValidationError
  );
  await expect(
    client.sendBatch(Array.from({ length: 101 }, () => ({ body: 'x' })))
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(
    client.sendBatch(
      Array.from({ length: 3 }, () => ({ body: 'x'.repeat(100_000) }))
    )
  ).rejects.toBeInstanceOf(ValidationError);
  await client.sendBatch([]);
  expect(attempts).toBe(0);
});

test('Queue preserves typed native failures and maps opaque native rejection to retryable NetworkError', async () => {
  const typed = new ValidationError('typed');
  const opaque = new Error('opaque');
  for (const error of [typed, opaque, 17]) {
    const rejectNative = async () => {
      // oxlint-disable-next-line no-throw-literal -- exercise native non-Error rejection handling
      throw error;
    };
    const client = createCloudflareQueueBinding({
      send: rejectNative,
      sendBatch: rejectNative,
    });
    for (const action of [
      () => client.send('body'),
      () => client.sendBatch([{ body: 'body' }]),
    ]) {
      await (error === typed
        ? expect(action()).rejects.toBe(typed)
        : expect(action()).rejects.toBeInstanceOf(NetworkError));
    }
  }
  expect(() => createCloudflareQueueBinding({})).toThrow(ValidationError);
});
