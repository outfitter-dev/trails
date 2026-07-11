import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  ConflictError,
  createTrailContext,
  Result,
  topo,
  trail,
  ValidationError,
} from '@ontrails/core';
import { store as defineStore } from '@ontrails/store';
import { createStoreAccessorContractCases } from '@ontrails/store/testing';
import { testAll } from '@ontrails/testing';
import { Miniflare } from 'miniflare';
import { z } from 'zod';

import { getEnvBinding } from '../../env.js';
import { cloudflareD1, connectD1 } from '../index.js';
import type {
  CloudflareD1Database,
  CloudflareD1PreparedStatement,
} from '../index.js';

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

const datedStore = defineStore({
  entries: {
    identity: 'id',
    schema: z.object({
      id: z.string(),
      observedAt: z.coerce.date(),
    }),
  },
});

const versionedDocumentSchema = z.object({
  body: z.string(),
  id: z.string(),
});

const versionedDocumentStore = defineStore({
  documents: {
    identity: 'id',
    schema: versionedDocumentSchema,
    versioned: true,
  },
});

const createD1Fixture = async (): Promise<{
  readonly database: CloudflareD1Database;
  readonly dispose: () => Promise<void>;
}> => {
  const mf = new Miniflare({
    compatibilityDate: '2026-06-01',
    d1Databases: ['DB'],
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
  });
  await mf.ready;
  return {
    database: (await mf.getD1Database('DB')) as CloudflareD1Database,
    dispose: () => mf.dispose(),
  };
};

let sharedD1Fixture: Awaited<ReturnType<typeof createD1Fixture>> | undefined;
let d1FixtureSerial = 0;

beforeAll(async () => {
  sharedD1Fixture = await createD1Fixture();
}, 120_000);

afterAll(async () => {
  await sharedD1Fixture?.dispose();
});

const nextD1Fixture = async () => {
  if (sharedD1Fixture === undefined) {
    throw new Error('D1 fixture was used before test setup completed.');
  }
  d1FixtureSerial += 1;
  return {
    database: sharedD1Fixture.database,
    dispose: async () => {},
    tablePrefix: `test_${d1FixtureSerial}`,
  };
};

const withD1Fixture = async <TResult>(
  run: (fixture: Awaited<ReturnType<typeof nextD1Fixture>>) => Promise<TResult>
): Promise<TResult> => {
  const fixture = await nextD1Fixture();

  try {
    return await run(fixture);
  } finally {
    await fixture.dispose();
  }
};

const interceptD1 = (
  database: CloudflareD1Database,
  hooks: {
    readonly beforeFirst?: (
      sql: string,
      values: readonly unknown[]
    ) => Promise<void>;
    readonly beforeRun?: (
      sql: string,
      values: readonly unknown[]
    ) => Promise<void>;
  }
): CloudflareD1Database => ({
  exec: (query) => database.exec(query),
  prepare(sql) {
    let values: readonly unknown[] = [];
    const statement: CloudflareD1PreparedStatement = {
      all: async <TRow>() =>
        await database
          .prepare(sql)
          .bind(...values)
          .all<TRow>(),
      bind: (...nextValues) => {
        values = nextValues;
        return statement;
      },
      first: async <TRow>() => {
        await hooks.beforeFirst?.(sql, values);
        return await database
          .prepare(sql)
          .bind(...values)
          .first<TRow>();
      },
      run: async () => {
        await hooks.beforeRun?.(sql, values);
        return await database
          .prepare(sql)
          .bind(...values)
          .run();
      },
    };
    return statement;
  },
});

const contractCases = createStoreAccessorContractCases({
  createInput: () => ({ email: 'contract@example.com' }),
  async createSubject() {
    const { database, dispose, tablePrefix } = await nextD1Fixture();
    const connection = connectD1(userStore, database, {
      generateIdentity: () => 'user-contract-id',
      tablePrefix,
    });

    return {
      accessor: connection.users,
      dispose,
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
  test(`D1 store contract: ${contractCase.name}`, async () => {
    await contractCase.run();
  });
}

describe('connectD1', () => {
  test('enforces optimistic concurrency on versioned tables', async () => {
    await withD1Fixture(async ({ database, tablePrefix }) => {
      const connection = connectD1(versionedDocumentStore, database, {
        tablePrefix,
      });

      const created = await connection.documents.upsert({
        body: 'first',
        id: 'doc_1',
      });
      expect(created).toEqual({ body: 'first', id: 'doc_1', version: 1 });

      const updated = await connection.documents.upsert({
        ...created,
        body: 'second',
      });
      expect(updated).toEqual({ body: 'second', id: 'doc_1', version: 2 });

      await expect(
        connection.documents.upsert({ ...created, body: 'stale' })
      ).rejects.toThrow(ConflictError);

      expect(await connection.documents.remove(created.id)).toEqual({
        deleted: true,
      });
      await expect(
        connection.documents.upsert({ ...updated, body: 'resurrected' })
      ).rejects.toThrow(ConflictError);
    });
  });

  test('reports a removal only when D1 deletes a row', async () => {
    let deleteWasRun = false;
    const database: CloudflareD1Database = {
      async exec() {},
      prepare(sql) {
        const statement: CloudflareD1PreparedStatement = {
          all: async <TRow>() => ({ results: [] as TRow[] }),
          bind: () => statement,
          first: async () => {
            deleteWasRun = sql.startsWith('DELETE');
            return null;
          },
          run: async () => ({ meta: { changes: 0 } }),
        };
        return statement;
      },
    };
    const connection = connectD1(userStore, database);

    expect(await connection.users.remove('missing')).toEqual({
      deleted: false,
    });
    expect(deleteWasRun).toBe(true);
  });

  test('throws when an expected-version D1 update reports no changed rows', async () => {
    let selectCount = 0;
    let sawExpectedVersionUpdate = false;
    const database: CloudflareD1Database = {
      async exec() {},
      prepare(sql) {
        const statement: CloudflareD1PreparedStatement = {
          all: async <TRow>() => ({ results: [] as TRow[] }),
          bind: () => statement,
          first: async <TRow>() => {
            if (!sql.startsWith('SELECT')) {
              return null;
            }
            selectCount += 1;
            const row =
              selectCount === 1
                ? { body: 'current', id: 'doc_1', version: 1 }
                : { body: 'other writer', id: 'doc_1', version: 2 };
            return { entity: JSON.stringify(row) } as TRow;
          },
          run: async () => {
            if (sql.startsWith('UPDATE')) {
              sawExpectedVersionUpdate = sql.includes(
                'WHERE id = ? AND entity = ? AND version = ?'
              );
              return { meta: { changes: 0 } };
            }
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    };
    const connection = connectD1(versionedDocumentStore, database);

    await expect(
      connection.documents.upsert({
        body: 'mine',
        id: 'doc_1',
        version: 1,
      })
    ).rejects.toThrow(ConflictError);
    expect(sawExpectedVersionUpdate).toBe(true);
    expect(selectCount).toBe(2);
  });

  test('applies runtime seed rows during lazy initialization', async () => {
    await withD1Fixture(async ({ database, tablePrefix }) => {
      const connection = connectD1(userStore, database, {
        seed: { users: [{ email: 'seed@example.com', id: 'seeded' }] },
        tablePrefix,
      });

      expect(await connection.users.get('seeded')).toEqual({
        email: 'seed@example.com',
        id: 'seeded',
      });
    });
  });

  test('treats versioned runtime seed rows as initial state', async () => {
    await withD1Fixture(async ({ database, tablePrefix }) => {
      const connection = connectD1(versionedDocumentStore, database, {
        seed: {
          documents: [{ body: 'seed body', id: 'seeded', version: 3 }],
        },
        tablePrefix,
      });

      expect(await connection.documents.get('seeded')).toEqual({
        body: 'seed body',
        id: 'seeded',
        version: 3,
      });
    });
  });

  test('runtime seed rematerialization preserves user edits', async () => {
    await withD1Fixture(async ({ database, tablePrefix }) => {
      const options = {
        seed: { users: [{ email: 'seed@example.com', id: 'seeded' }] },
        tablePrefix,
      } as const;
      const first = connectD1(userStore, database, options);
      expect(await first.users.get('seeded')).toEqual({
        email: 'seed@example.com',
        id: 'seeded',
      });
      await first.users.upsert({
        email: 'user-edit@example.com',
        id: 'seeded',
      });

      const rematerialized = connectD1(userStore, database, options);

      expect(await rematerialized.users.get('seeded')).toEqual({
        email: 'user-edit@example.com',
        id: 'seeded',
      });
    });
  });

  test('runtime seed rows require stable identities', async () => {
    await withD1Fixture(async ({ database, tablePrefix }) => {
      const connection = connectD1(userStore, database, {
        seed: { users: [{ email: 'seed@example.com' }] },
        tablePrefix,
      });

      await expect(connection.users.list()).rejects.toThrow(ValidationError);
    });
  });
});

describe('cloudflareD1 resource', () => {
  test('declares binding metadata, store shape, signals, and mock factory', () => {
    const db = cloudflareD1(userStore, {
      binding: 'DB',
      id: 'users.store',
    });

    expect(db.access).toBe('readwrite');
    expect(db.id).toBe('users.store');
    expect(db.meta?.['cloudflare.binding']).toBe('DB');
    expect(db.meta?.['cloudflare.service']).toBe('d1');
    expect(db.signals.map((signal) => signal.id)).toEqual([
      'users.store:users.created',
      'users.store:users.updated',
      'users.store:users.removed',
    ]);
    expect(db.store.tables.users.signals.created.id).toBe(
      'users.store:users.created'
    );
    expect(typeof db.mock).toBe('function');
    expect(getEnvBinding(db)?.binding).toBe('DB');
  });

  test('create refuses to run outside a Workers env with guidance', async () => {
    const db = cloudflareD1(userStore, {
      binding: 'DB',
      id: 'users.store',
    });
    const created = await db.create({
      config: undefined,
      cwd: '/',
      env: {},
      workspaceRoot: undefined,
    });

    expect(created.isErr()).toBe(true);
    if (created.isErr()) {
      expect(created.error.message).toContain('DB');
      expect(created.error.message).toContain('createWorkersHandler');
    }
  });

  test('rejects a non-D1 env binding', () => {
    const db = cloudflareD1(userStore, {
      binding: 'DB',
      id: 'users.store',
    });
    const result = getEnvBinding(db)?.fromEnv('not-a-d1');

    expect(result?.isErr()).toBe(true);
    if (result?.isErr()) {
      expect(result.error.message).toContain('d1_databases');
    }
  });

  test('env materialization honors an explicit table prefix', async () => {
    const statements: string[] = [];
    const database: CloudflareD1Database = {
      async exec(query) {
        statements.push(query);
      },
      prepare(sql) {
        statements.push(sql);
        const statement: CloudflareD1PreparedStatement = {
          all: async <TRow>() => ({ results: [] as TRow[] }),
          bind: () => statement,
          first: async () => null,
          run: async () => ({ meta: { changes: 0 } }),
        };
        return statement;
      },
    };
    const db = cloudflareD1(userStore, {
      binding: 'DB',
      id: 'users.store',
      tablePrefix: 'legacy',
    });
    const resolved = getEnvBinding(db)?.fromEnv(database);

    expect(resolved?.isOk()).toBe(true);
    if (resolved?.isOk()) {
      await resolved.value.users.get('missing');
    }
    expect(statements.some((sql) => sql.includes('"legacy.users"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('"users.store.users"'))).toBe(
      false
    );
  });

  test('mock factory seeds table fixtures and mockSeed overrides', async () => {
    const fixtureStore = defineStore({
      users: {
        fixtures: [{ email: 'fixture@example.com', id: 'fixture' }],
        identity: 'id',
        schema: userSchema,
      },
    });
    const db = cloudflareD1(fixtureStore, {
      binding: 'DB',
      id: 'fixture.store',
      mockSeed: {
        users: [{ email: 'override@example.com', id: 'override' }],
      },
    });

    const connection = await db.mock?.();

    expect(connection).toBeDefined();
    expect(await connection?.users.get('fixture')).toBeNull();
    expect(await connection?.users.get('override')).toEqual({
      email: 'override@example.com',
      id: 'override',
    });
  });

  test('mock seed preserves explicit generated versions', async () => {
    const db = cloudflareD1(versionedDocumentStore, {
      binding: 'DB',
      id: 'documents.store',
      mockSeed: {
        documents: [{ body: 'seed body', id: 'seeded', version: 3 }],
      },
    });

    const connection = await db.mock?.();

    expect(await connection?.documents.get('seeded')).toEqual({
      body: 'seed body',
      id: 'seeded',
      version: 3,
    });
  });

  test('mock seed requires the same stable identities as runtime D1', async () => {
    const db = cloudflareD1(userStore, {
      binding: 'DB',
      id: 'users.store',
      mockSeed: { users: [{ email: 'seed@example.com' }] },
    });

    await expect(db.mock?.()).rejects.toThrow(ValidationError);
  });

  test('from(ctx) emits store-derived signals after writes', async () => {
    await withD1Fixture(async ({ database, tablePrefix }) => {
      const db = cloudflareD1(userStore, {
        binding: 'DB',
        generateIdentity: () => 'signal-user',
        id: 'signal.store',
      });
      const connection = connectD1(db.store, database, {
        generateIdentity: () => 'signal-user',
        tablePrefix,
      });
      const events: { readonly payload: unknown; readonly signalId: string }[] =
        [];
      const ctx = createTrailContext({
        abortSignal: new AbortController().signal,
        extensions: { [db.id]: connection },
        fire: async (signal, payload) => {
          events.push({ payload, signalId: signal.id });
        },
        requestId: 'd1-signals',
      });

      const bound = db.from(ctx);
      const created = await bound.users.upsert({ email: 'signal@example.com' });
      const updated = await bound.users.upsert({
        ...created,
        email: 'signal+updated@example.com',
      });
      await bound.users.remove(created.id);

      expect(events.map((event) => event.signalId)).toEqual([
        'signal.store:users.created',
        'signal.store:users.updated',
        'signal.store:users.removed',
      ]);
      expect(events[0]?.payload).toEqual(created);
      expect(events[1]?.payload).toEqual(updated);
      expect(events[2]?.payload).toEqual(updated);
    });
  });

  test('concurrent explicit-id upserts emit one created and one updated signal', async () => {
    await withD1Fixture(async ({ database, tablePrefix }) => {
      const db = cloudflareD1(userStore, {
        binding: 'DB',
        id: 'race.store',
      });
      const connection = connectD1(db.store, database, { tablePrefix });
      const signalIds: string[] = [];
      const ctx = createTrailContext({
        abortSignal: new AbortController().signal,
        extensions: { [db.id]: connection },
        fire: async (signal) => {
          signalIds.push(signal.id);
        },
        requestId: 'd1-signal-race',
      });
      const bound = db.from(ctx);

      await Promise.all([
        bound.users.upsert({ email: 'first@example.com', id: 'same' }),
        bound.users.upsert({ email: 'second@example.com', id: 'same' }),
      ]);

      expect(signalIds).toEqual([
        'race.store:users.created',
        'race.store:users.updated',
      ]);
    });
  });

  test('upsert emits created when a concurrent remove wins before commit', async () => {
    await withD1Fixture(async ({ database, tablePrefix }) => {
      const base = connectD1(userStore, database, { tablePrefix });
      await base.users.upsert({ email: 'before@example.com', id: 'same' });
      let removed = false;
      const racingDatabase = interceptD1(database, {
        async beforeRun(sql) {
          if (!removed && sql.startsWith('UPDATE')) {
            removed = true;
            await base.users.remove('same');
          }
        },
      });
      const db = cloudflareD1(userStore, {
        binding: 'DB',
        id: 'recreate.store',
        tablePrefix,
      });
      const connection = connectD1(userStore, racingDatabase, { tablePrefix });
      const events: string[] = [];
      const ctx = createTrailContext({
        abortSignal: new AbortController().signal,
        extensions: { [db.id]: connection },
        fire: async (signal) => {
          events.push(signal.id);
        },
        requestId: 'd1-recreate-race',
      });

      await db.from(ctx).users.upsert({
        email: 'after@example.com',
        id: 'same',
      });

      expect(events).toEqual(['recreate.store:users.created']);
    });
  });

  test('remove signal carries the row deleted after a concurrent update', async () => {
    await withD1Fixture(async ({ database, tablePrefix }) => {
      const base = connectD1(userStore, database, { tablePrefix });
      await base.users.upsert({ email: 'before@example.com', id: 'same' });
      let updated = false;
      const racingDatabase = interceptD1(database, {
        async beforeFirst(sql) {
          if (!updated && sql.startsWith('DELETE')) {
            updated = true;
            await base.users.upsert({ email: 'after@example.com', id: 'same' });
          }
        },
      });
      const db = cloudflareD1(userStore, {
        binding: 'DB',
        id: 'remove.store',
        tablePrefix,
      });
      const connection = connectD1(userStore, racingDatabase, { tablePrefix });
      const events: unknown[] = [];
      const ctx = createTrailContext({
        abortSignal: new AbortController().signal,
        extensions: { [db.id]: connection },
        fire: async (_signal, payload) => {
          events.push(payload);
        },
        requestId: 'd1-remove-race',
      });

      await db.from(ctx).users.remove('same');

      expect(events).toEqual([{ email: 'after@example.com', id: 'same' }]);
    });
  });

  test('date-only updates emit the derived updated signal', async () => {
    await withD1Fixture(async ({ database, tablePrefix }) => {
      const db = cloudflareD1(datedStore, {
        binding: 'DB',
        id: 'dated.store',
      });
      const connection = connectD1(db.store, database, { tablePrefix });
      const signalIds: string[] = [];
      const ctx = createTrailContext({
        abortSignal: new AbortController().signal,
        extensions: { [db.id]: connection },
        fire: async (signal) => {
          signalIds.push(signal.id);
        },
        requestId: 'd1-date-change',
      });
      const bound = db.from(ctx);

      await bound.entries.upsert({
        id: 'dated',
        observedAt: new Date('2026-07-10T00:00:00.000Z'),
      });
      await bound.entries.upsert({
        id: 'dated',
        observedAt: new Date('2026-07-11T00:00:00.000Z'),
      });

      expect(signalIds).toEqual([
        'dated.store:entries.created',
        'dated.store:entries.updated',
      ]);
    });
  });

  test('filters D1 rows by Date value instead of object identity', async () => {
    await withD1Fixture(async ({ database, tablePrefix }) => {
      const db = cloudflareD1(datedStore, {
        binding: 'DB',
        id: 'dated.filter.store',
      });
      const connection = connectD1(db.store, database, { tablePrefix });
      const ctx = createTrailContext({
        abortSignal: new AbortController().signal,
        extensions: { [db.id]: connection },
        requestId: 'd1-date-filter',
      });
      const bound = db.from(ctx);

      await bound.entries.upsert({
        id: 'dated',
        observedAt: new Date('2026-07-11T00:00:00.000Z'),
      });

      await expect(
        bound.entries.list({
          observedAt: new Date('2026-07-11T00:00:00.000Z'),
        })
      ).resolves.toEqual([
        {
          id: 'dated',
          observedAt: new Date('2026-07-11T00:00:00.000Z'),
        },
      ]);
    });
  });
});

const usersDb = cloudflareD1(userStore, {
  binding: 'DB',
  generateIdentity: () => 'example-user-id',
  id: 'example.users',
});

const saveUser = trail('user.save', {
  examples: [
    {
      expected: { email: 'test@example.com', id: 'example-user-id' },
      input: { email: 'test@example.com' },
      name: 'saves a user',
    },
  ],
  implementation: async (input, ctx) =>
    Result.ok(await usersDb.from(ctx).users.upsert(input)),
  input: z.object({ email: z.string().email() }),
  intent: 'write',
  output: userSchema,
  resources: [usersDb],
});

const showUser = trail('user.show', {
  examples: [
    {
      expected: { user: null },
      input: { id: 'missing-user' },
      name: 'reads a missing user',
    },
  ],
  implementation: async (input, ctx) =>
    Result.ok({ user: await usersDb.from(ctx).users.get(input.id) }),
  input: z.object({ id: z.string() }),
  intent: 'read',
  output: z.object({ user: userSchema.nullable() }),
  resources: [usersDb],
});

testAll(topo('cf-d1', { saveUser, showUser, usersDb }));
