import { expect, test } from 'bun:test';
import { ValidationError } from '@ontrails/core';

import { createKvMock } from '../index.js';
import type { KvListPage } from '../index.js';
import { createKvContractCases } from '../testing.js';

const findCase = (
  name: string,
  options: Parameters<typeof createKvContractCases>[0]
) => {
  const entry = createKvContractCases(options).find(
    (candidate) => candidate.name === name
  );
  if (entry === undefined) {
    throw new Error('Missing conformance case');
  }
  return entry;
};

test('conformance follows an empty incomplete page instead of stopping early', async () => {
  let call = 0;
  const client = createKvMock();
  client.list = async (): Promise<KvListPage> => {
    call += 1;
    if (call === 1) {
      return { complete: false, cursor: 'next', keys: [] };
    }
    if (call === 2) {
      return { complete: false, cursor: 'last', keys: ['flag/a'] };
    }
    return { complete: true, keys: ['flag/b'] };
  };
  await findCase('KV prefix pagination follows explicit completion', {
    createSubject: () => ({ advanceTime: () => {}, client }),
  }).check();
  expect(call).toBe(3);
});

test('conformance disposes its subject when the contract fails', async () => {
  let disposed = false;
  const client = createKvMock();
  client.get = async () => {
    throw new ValidationError('Fixture binding failed');
  };
  await expect(
    findCase('KV missing, overwrite, and idempotent delete', {
      createSubject: () => ({
        advanceTime: () => {},
        client,
        dispose: () => {
          disposed = true;
        },
      }),
    }).check()
  ).rejects.toBeInstanceOf(ValidationError);
  expect(disposed).toBe(true);
});
