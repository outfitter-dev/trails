import { expect, test } from 'bun:test';
import { ValidationError } from '@ontrails/core';

import { createBlobMock } from '../memory.js';
import type { BlobListPage } from '../schemas.js';
import { createBlobContractCases } from '../testing.js';

test('conformance continues after an empty incomplete page', async () => {
  const client = createBlobMock();
  let calls = 0;
  const list = async (): Promise<BlobListPage> => {
    calls += 1;
    if (calls === 1) {
      return { complete: false, cursor: 'next', objects: [] };
    }
    if (calls === 2) {
      return {
        complete: false,
        cursor: 'last',
        objects: [{ key: 'file/a', mimeType: 'text/plain', size: 1 }],
      };
    }
    return {
      complete: true,
      objects: [{ key: 'file/b', mimeType: 'image/example', size: 2 }],
    };
  };
  const entry = createBlobContractCases({
    createSubject: () => ({ client: { ...client, list } }),
  }).find((candidate) => candidate.name.includes('listing'));
  if (entry === undefined) {
    throw new Error('Missing case');
  }
  await entry.check();
  expect(calls).toBe(3);
});

test('conformance disposes a subject when its assertion fails', async () => {
  let disposed = false;
  const client = {
    ...createBlobMock(),
    get: async () => {
      throw new ValidationError('Fixture failed');
    },
  };
  const [entry] = createBlobContractCases({
    createSubject: () => ({
      client,
      dispose: () => {
        disposed = true;
      },
    }),
  });
  if (entry === undefined) {
    throw new Error('Missing case');
  }
  await expect(entry.check()).rejects.toBeInstanceOf(ValidationError);
  expect(disposed).toBe(true);
});

test('cursor conformance disposes both bindings when prefix rejection fails', async () => {
  const disposed: number[] = [];
  let created = 0;
  const cases = createBlobContractCases({
    createSubject: () => {
      const id = created;
      created += 1;
      const memory = createBlobMock();
      const client = {
        ...memory,
        list: async (options: Parameters<typeof memory.list>[0]) =>
          options?.prefix === 'other/'
            ? { complete: true as const, objects: [] }
            : await memory.list(options),
      };
      return {
        client,
        dispose: () => {
          disposed.push(id);
        },
      };
    },
  });
  const entry = cases.find((candidate) => candidate.name.includes('cursors'));
  if (entry === undefined) {
    throw new Error('Missing cursor case');
  }
  await expect(entry.check()).rejects.toThrow();
  expect(created).toBe(2);
  expect(disposed.toSorted()).toEqual([0, 1]);
});
