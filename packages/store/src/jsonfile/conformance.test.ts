import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStoreAccessorContractCases } from '@ontrails/store/testing';
import { z } from 'zod';

import { store as defineStore } from '../store.js';

import { connectJsonFile } from './index.js';

const userSchema = z.object({
  email: z.string().email(),
  id: z.string(),
});

const userStore = defineStore({
  users: {
    generated: ['id'] as const,
    identity: 'id',
    schema: userSchema,
  },
});

const contractCases = createStoreAccessorContractCases({
  createInput: () => ({ email: 'contract@example.com' }),
  async createSubject() {
    const dir = await mkdtemp(join(tmpdir(), 'jsonfile-conformance-'));
    const connection = await connectJsonFile(userStore, { dir });

    return {
      accessor: connection.users,
      dispose: async () => {
        await rm(dir, { force: true, recursive: true });
      },
    };
  },
  expectCreated(entity, input) {
    expect(entity).toEqual(
      expect.objectContaining({
        email: input.email,
        id: expect.any(String),
      })
    );
  },
  expectUpdated(entity, previous, input) {
    expect(entity).toEqual({
      email: input.email,
      id: previous.id,
    });
  },
  missingId: 'missing-user-id',
  table: userStore.tables.users,
  updateInput(existing) {
    return {
      email: 'contract+updated@example.com',
      id: existing.id,
    };
  },
});

for (const contractCase of contractCases) {
  test(contractCase.name, async () => {
    await contractCase.run();
  });
}
