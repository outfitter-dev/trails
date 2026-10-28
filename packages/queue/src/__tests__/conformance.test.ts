import { expect, test } from 'bun:test';
import { ValidationError } from '@ontrails/core';

import { createQueueMock } from '../memory.js';
import { createQueueContractCases } from '../testing.js';

test('conformance disposes subjects when a producer fails', async () => {
  let disposed = false;
  const client = {
    ...createQueueMock(),
    send: async () => {
      throw new ValidationError('Fixture failed');
    },
  };
  const [entry] = createQueueContractCases({
    createSubject: () => ({
      attempts: () => client.messages().length,
      client,
      dispose: () => {
        disposed = true;
      },
      observe: client.messages,
    }),
  });
  if (entry === undefined) {
    throw new Error('Missing case');
  }
  await expect(entry.check()).rejects.toBeInstanceOf(ValidationError);
  expect(disposed).toBe(true);
});

test('conformance detects provider attempts before local batch rejection', async () => {
  let attempts = 0;
  const memory = createQueueMock();
  const client = {
    ...memory,
    sendBatch: async (messages: Parameters<typeof memory.sendBatch>[0]) => {
      attempts += 1;
      await memory.sendBatch(messages);
    },
  };
  const entry = createQueueContractCases({
    createSubject: () => ({
      attempts: () => attempts,
      client,
      observe: memory.messages,
    }),
  }).find((candidate) => candidate.name.includes('complete batches'));
  if (entry === undefined) {
    throw new Error('Missing case');
  }
  await expect(entry.check()).rejects.toThrow();
  expect(attempts).toBeGreaterThan(0);
  expect(memory.messages()).toEqual([]);
});
