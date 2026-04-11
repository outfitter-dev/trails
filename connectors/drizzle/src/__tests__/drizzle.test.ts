import { afterEach, describe, expect, test } from 'bun:test';
import {
  AlreadyExistsError,
  ConflictError,
  Result,
  ValidationError,
  createTrailContext,
} from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { store as defineStore } from '@ontrails/store';
import { createStoreAccessorContractCases } from '@ontrails/store/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import {
  connectDrizzle,
  connectReadOnlyDrizzle,
  getSchema,
  readonlyStore,
  store,
} from '../index.js';

const userSchema = z.object({
  email: z.string().email(),
  id: z.string(),
});

const gistSchema = z.object({
  createdAt: z.string(),
  description: z.string().nullable().default(null),
  id: z.string(),
  isPublic: z.boolean().default(true),
  ownerId: z.string(),
  tags: z.array(z.string()).default([]),
  updatedAt: z.string(),
});

const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const userTable = {
  generated: ['id'],
  primaryKey: 'id',
  schema: userSchema,
} as const;

const gistTable = {
  generated: ['id', 'createdAt', 'updatedAt'],
  indexes: ['ownerId'],
  primaryKey: 'id',
  references: { ownerId: 'users' },
  schema: gistSchema,
} as const;

const createResourceInput = (rootDir: string) => ({
  config: undefined,
  cwd: rootDir,
  env: {},
  workspaceRoot: rootDir,
});

const writableDemoDefinition = defineStore({
  gists: gistTable,
  users: userTable,
});

const versionedUserDefinition = defineStore({
  users: {
    ...userTable,
    versioned: true,
  },
});

const expectOk = async <T>(value: PromiseLike<T> | T): Promise<T> =>
  await value;

const unwrapCreated = async <T>(
  value:
    | PromiseLike<{
        unwrap(): T;
      }>
    | {
        unwrap(): T;
      }
): Promise<T> => {
  const result = await value;
  return result.unwrap();
};

const createWritableDemoStore = (rootDir: string) =>
  store(
    {
      gists: gistTable,
      users: userTable,
    },
    {
      description: 'Writable demo store',
      id: 'demo.store',
      url: join(rootDir, 'demo.sqlite'),
    }
  );

const createVersionedUserStore = (rootDir: string) =>
  store(
    {
      users: {
        ...userTable,
        versioned: true,
      },
    },
    {
      description: 'Versioned demo store',
      id: 'demo.store.versioned',
      url: join(rootDir, 'versioned.sqlite'),
    }
  );

const setupWritableDemoStore = async (rootDir: string) => {
  const db = createWritableDemoStore(rootDir);
  return {
    created: await unwrapCreated(db.create(createResourceInput(rootDir))),
    db,
  };
};

const setupVersionedUserStore = async (rootDir: string) => {
  const db = createVersionedUserStore(rootDir);
  return {
    created: await unwrapCreated(db.create(createResourceInput(rootDir))),
    db,
  };
};

const createTmpRootManager = (prefix: string) => {
  let tmpRoot: string | undefined;

  return {
    cleanup() {
      if (tmpRoot !== undefined) {
        rmSync(tmpRoot, { force: true, recursive: true });
        tmpRoot = undefined;
      }
    },
    makeRoot(): string {
      tmpRoot = mkdtempSync(join(tmpdir(), prefix));
      return tmpRoot;
    },
  };
};

const createFireRecorder = () => {
  const events: { payload: unknown; signalId: string }[] = [];
  const record = (
    signal: string | { readonly id: string },
    payload: unknown
  ) => {
    events.push({
      payload,
      signalId: typeof signal === 'string' ? signal : signal.id,
    });

    return Result.ok();
  };

  return {
    events,
    fire: record as unknown as NonNullable<TrailContext['fire']>,
  };
};

type WritableDemoStoreRuntime = Awaited<
  ReturnType<typeof setupWritableDemoStore>
>['created'];

const expectWritableResourceDefinition = (
  db: ReturnType<typeof createWritableDemoStore>
): void => {
  expect(db.kind).toBe('resource');
  expect(db.id).toBe('demo.store');
  expect(db.access).toBe('readwrite');
  expect(db.mock).toBeDefined();
  expect(db.signals.map((candidate) => candidate.id)).toEqual([
    'gists.created',
    'gists.updated',
    'gists.removed',
    'users.created',
    'users.updated',
    'users.removed',
  ]);
  expect(getSchema(db).gists).toBe(db.tables.gists);
};

const expectInsertedGist = (
  gist: z.output<typeof gistSchema>,
  ownerId: string
): void => {
  expect(gist).toEqual(
    expect.objectContaining({
      createdAt: expect.any(String),
      description: null,
      id: expect.any(String),
      isPublic: true,
      ownerId,
      tags: [],
      updatedAt: expect.any(String),
    })
  );
};

const seedWritableRecords = async (
  created: WritableDemoStoreRuntime
): Promise<{
  readonly gist: z.output<typeof gistSchema>;
  readonly user: z.output<typeof userSchema>;
}> => {
  const user = await expectOk(
    created.users.upsert({ email: 'alice@example.com' })
  );
  expect(user.id).toEqual(expect.any(String));

  const gist = await expectOk(created.gists.upsert({ ownerId: user.id }));
  expectInsertedGist(gist, user.id);
  return { gist, user };
};

const expectStoredGist = async (
  created: WritableDemoStoreRuntime,
  gist: z.output<typeof gistSchema>,
  ownerId: string
): Promise<void> => {
  expect(await created.gists.get(gist.id)).toEqual(gist);
  expect(await created.gists.list({ ownerId })).toEqual([gist]);
};

const expectUpdatedGist = async (
  created: WritableDemoStoreRuntime,
  gist: z.output<typeof gistSchema>
): Promise<void> => {
  const updated = await expectOk(
    created.gists.upsert({
      description: 'Updated',
      id: gist.id,
      ownerId: gist.ownerId,
    })
  );

  expect(updated).toEqual(
    expect.objectContaining({
      description: 'Updated',
      id: gist.id,
    })
  );
  expect(updated?.updatedAt).toEqual(expect.any(String));
  expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(
    Date.parse(gist.updatedAt)
  );
};

const expectQueryEscapeHatch = async (
  created: WritableDemoStoreRuntime
): Promise<void> => {
  const rows = await created.query(({ drizzle, tables }) =>
    drizzle.select().from(tables.gists).all()
  );
  expect(rows).toHaveLength(1);
};

const expectDeletedGist = async (
  created: WritableDemoStoreRuntime,
  gistId: string
): Promise<void> => {
  const deleted = await created.gists.remove(gistId);
  expect(deleted).toEqual({ deleted: true });
  expect(await created.gists.get(gistId)).toBeNull();
};

const expectMissingGistDelete = async (
  created: WritableDemoStoreRuntime
): Promise<void> => {
  const deleted = await created.gists.remove('non-existent-id');
  expect(deleted).toEqual({ deleted: false });
};

const expectWritableLifecycle = async (
  created: WritableDemoStoreRuntime
): Promise<void> => {
  const { gist, user } = await seedWritableRecords(created);
  await expectStoredGist(created, gist, user.id);
  await expectUpdatedGist(created, gist);
  await expectQueryEscapeHatch(created);
  await expectDeletedGist(created, gist.id);
  await expectMissingGistDelete(created);
};

const expectResourceResolution = (
  db: ReturnType<typeof createWritableDemoStore>,
  created: WritableDemoStoreRuntime
): void => {
  const ctx = createTrailContext({
    abortSignal: new AbortController().signal,
    extensions: {
      [db.id]: created,
    },
    requestId: 'store-drizzle',
  });
  expect(db.from(ctx).users).toBeDefined();
};

const createSignalBoundStore = async (rootDir: string) => {
  const { created, db } = await setupWritableDemoStore(rootDir);
  const recorder = createFireRecorder();
  const ctx = createTrailContext({
    abortSignal: new AbortController().signal,
    extensions: {
      [db.id]: created,
    },
    fire: recorder.fire,
    requestId: 'store-drizzle-signals',
  });

  return {
    bound: db.from(ctx),
    created,
    db,
    recorder,
  };
};

const exerciseSignalWrites = async (bound: WritableDemoStoreRuntime) => {
  const user = await bound.users.upsert({ email: 'signals@example.com' });
  const createdGist = await bound.gists.upsert({ ownerId: user.id });
  const updatedGist = await bound.gists.upsert({
    description: 'Updated',
    id: createdGist.id,
    ownerId: user.id,
  });

  expect(await bound.gists.remove(createdGist.id)).toEqual({ deleted: true });
  return { createdGist, updatedGist };
};

const expectRecordedSignals = (
  recorder: ReturnType<typeof createFireRecorder>,
  createdGist: z.output<typeof gistSchema>,
  updatedGist: z.output<typeof gistSchema>
): void => {
  expect(recorder.events.map((event) => event.signalId)).toEqual([
    'users.created',
    'gists.created',
    'gists.updated',
    'gists.removed',
  ]);
  expect(recorder.events[1]?.payload).toEqual(createdGist);
  expect(recorder.events[2]?.payload).toEqual(updatedGist);
  expect(recorder.events[3]?.payload).toEqual(updatedGist);
};

const createFixtureBackedStore = () =>
  store(
    {
      gists: {
        ...gistTable,
        fixtures: [
          {
            id: 'gist-seed',
            ownerId: 'user-seed',
          },
        ],
      },
      users: {
        ...userTable,
        fixtures: [
          {
            email: 'seed@example.com',
            id: 'user-seed',
          },
        ],
      },
    },
    {
      id: 'demo.store.mock',
      url: ':memory:',
    }
  );

const createWritableSeedStore = (url: string) =>
  store(
    {
      users: userTable,
    },
    {
      id: 'demo.store.seed',
      url,
    }
  );

const seedReadonlyFixture = async (
  url: string,
  rootDir: string
): Promise<z.output<typeof userSchema>> => {
  const writable = createWritableSeedStore(url);
  const seeded = await unwrapCreated(
    writable.create(createResourceInput(rootDir))
  );
  const inserted = await seeded.users.insert({ email: 'seed@example.com' });
  await writable.dispose?.(seeded);
  return inserted;
};

const createReadonlyUserStore = (url: string) =>
  readonlyStore(
    {
      users: userTable,
    },
    {
      id: 'demo.store.readonly',
      url,
    }
  );

const setupReadonlyUserStore = async (url: string, rootDir: string) => {
  const db = createReadonlyUserStore(url);
  return {
    created: await unwrapCreated(db.create(createResourceInput(rootDir))),
    db,
  };
};

type ReadonlyUserStoreRuntime = Awaited<
  ReturnType<typeof setupReadonlyUserStore>
>['created'];
type VersionedUserStoreRuntime = Awaited<
  ReturnType<typeof setupVersionedUserStore>
>['created'];

const expectReadonlyReads = async (
  created: ReadonlyUserStoreRuntime,
  inserted: z.output<typeof userSchema>
): Promise<void> => {
  expect(await created.users.get(inserted.id)).toEqual(inserted);
  expect(await created.users.list()).toEqual([inserted]);
};

const expectReadonlyWriteFailure = async (
  created: ReadonlyUserStoreRuntime
): Promise<void> => {
  await expect(
    created.query(({ drizzle, tables }) =>
      drizzle
        .insert(tables.users)
        .values({ email: 'blocked@example.com', id: 'blocked' })
        .run()
    )
  ).rejects.toThrow();
};

const expectVersionedCreate = async (
  created: VersionedUserStoreRuntime
): Promise<{
  readonly first: Awaited<ReturnType<typeof created.users.upsert>>;
  readonly second: Awaited<ReturnType<typeof created.users.upsert>>;
}> => {
  const first = await expectOk(
    created.users.upsert({ email: 'versioned@example.com' })
  );
  expect(first).toEqual(
    expect.objectContaining({
      email: 'versioned@example.com',
      id: expect.any(String),
      version: 1,
    })
  );
  expect(await created.users.get(first.id)).toEqual(first);

  const second = await expectOk(
    created.users.upsert({
      email: 'versioned+updated@example.com',
      id: first.id,
      version: first.version,
    })
  );
  expect(second).toEqual({
    email: 'versioned+updated@example.com',
    id: first.id,
    version: 2,
  });
  expect(await created.users.get(first.id)).toEqual(second);

  return { first, second };
};

const createErrorStore = (rootDir: string) =>
  store(
    {
      accounts: {
        primaryKey: 'id',
        schema: accountSchema,
      },
      gists: {
        ...gistTable,
        references: { ownerId: 'accounts' },
      },
    },
    {
      id: 'demo.store.errors',
      url: join(rootDir, 'errors.sqlite'),
    }
  );

describe('writable user accessor contract', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot !== undefined) {
      rmSync(tmpRoot, { force: true, recursive: true });
      tmpRoot = undefined;
    }
  });

  const makeRoot = (): string => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'store-drizzle-'));
    return tmpRoot;
  };

  const contractCases = createStoreAccessorContractCases({
    createInput: () => ({ email: 'contract@example.com' }),
    async createSubject() {
      const rootDir = makeRoot();
      const { created, db } = await setupWritableDemoStore(rootDir);

      return {
        accessor: created.users,
        dispose: async () => {
          await db.dispose?.(created);
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
    table: writableDemoDefinition.tables.users,
    updateInput(existing) {
      return {
        email: 'contract+updated@example.com',
        id: existing.id,
      };
    },
  });

  test.each(
    contractCases.map((contractCase) => [contractCase.name, contractCase.run])
  )('%s', async (_name, run) => {
    await run();
  });
});

describe('versioned user accessor contract', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot !== undefined) {
      rmSync(tmpRoot, { force: true, recursive: true });
      tmpRoot = undefined;
    }
  });

  const makeRoot = (): string => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'store-drizzle-versioned-'));
    return tmpRoot;
  };

  const contractCases = createStoreAccessorContractCases({
    createInput: () => ({ email: 'contract@example.com' }),
    async createSubject() {
      const rootDir = makeRoot();
      const { created, db } = await setupVersionedUserStore(rootDir);

      return {
        accessor: created.users,
        dispose: async () => {
          await db.dispose?.(created);
        },
      };
    },
    expectCreated(entity, input) {
      expect(entity).toEqual(
        expect.objectContaining({
          email: input.email,
          id: expect.any(String),
          version: 1,
        })
      );
    },
    expectUpdated(entity, previous, input) {
      expect(entity).toEqual({
        email: input.email,
        id: previous.id,
        version: previous.version + 1,
      });
    },
    missingId: 'missing-user-id',
    table: versionedUserDefinition.tables.users,
    updateInput(existing) {
      return {
        email: 'contract+updated@example.com',
        id: existing.id,
        version: existing.version,
      };
    },
  });

  test.each(
    contractCases.map((contractCase) => [contractCase.name, contractCase.run])
  )('%s', async (_name, run) => {
    await run();
  });
});

describe('@ontrails/with-drizzle resource access', () => {
  const tmp = createTmpRootManager('store-drizzle-');

  afterEach(() => {
    tmp.cleanup();
  });

  test('binds a writable resource with CRUD accessors and one escape hatch', async () => {
    const rootDir = tmp.makeRoot();
    const { created, db } = await setupWritableDemoStore(rootDir);
    expectWritableResourceDefinition(db);
    await expectWritableLifecycle(created);
    expectResourceResolution(db, created);
    await db.dispose?.(created);
  });

  test('creates a writable mock resource seeded from fixtures', async () => {
    const db = createFixtureBackedStore();

    const mock = await db.mock?.();
    expect(mock).toBeDefined();
    expect(await mock?.users.get('user-seed')).toEqual(
      expect.objectContaining({
        email: 'seed@example.com',
        id: 'user-seed',
      })
    );
    expect(await mock?.gists.get('gist-seed')).toEqual(
      expect.objectContaining({
        createdAt: expect.any(String),
        description: null,
        id: 'gist-seed',
        isPublic: true,
        ownerId: 'user-seed',
        updatedAt: expect.any(String),
      })
    );
  });

  test('opens a read-only store without a mock and enforces writes at the database layer', async () => {
    const rootDir = tmp.makeRoot();
    const url = join(rootDir, 'readonly.sqlite');
    const inserted = await seedReadonlyFixture(url, rootDir);
    const { created, db: readOnly } = await setupReadonlyUserStore(
      url,
      rootDir
    );
    expect(readOnly.access).toBe('readonly');
    expect(readOnly.mock).toBeUndefined();
    await expectReadonlyReads(created, inserted);
    await expectReadonlyWriteFailure(created);
    await readOnly.dispose?.(created);
  });

  test('manages versioned writes and rejects stale optimistic-concurrency updates', async () => {
    const rootDir = tmp.makeRoot();
    const { created, db } = await setupVersionedUserStore(rootDir);
    const { first, second } = await expectVersionedCreate(created);

    await expect(
      created.users.upsert({
        email: 'stale@example.com',
        id: first.id,
        version: first.version,
      })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await created.users.list()).toEqual([second]);
    await db.dispose?.(created);
  });

  test('keeps non-versioned writes free of framework-managed version fields', async () => {
    const rootDir = tmp.makeRoot();
    const { created, db } = await setupWritableDemoStore(rootDir);
    const user = await expectOk(
      created.users.upsert({ email: 'plain@example.com' })
    );

    expect(user).toEqual({
      email: 'plain@example.com',
      id: expect.any(String),
    });
    expect(user).not.toHaveProperty('version');
    await db.dispose?.(created);
  });

  test('fires derived change signals from context-bound writable accessors', async () => {
    const rootDir = tmp.makeRoot();
    const { bound, created, db, recorder } =
      await createSignalBoundStore(rootDir);
    const { createdGist, updatedGist } = await exerciseSignalWrites(bound);

    expectRecordedSignals(recorder, createdGist, updatedGist);
    await db.dispose?.(created);
  });
});

describe('@ontrails/with-drizzle edge cases', () => {
  const tmp = createTmpRootManager('store-drizzle-');

  afterEach(() => {
    tmp.cleanup();
  });

  test('maps primary-key and foreign-key failures into Trails errors', async () => {
    const rootDir = tmp.makeRoot();
    const db = createErrorStore(rootDir);
    const created = await unwrapCreated(
      db.create(createResourceInput(rootDir))
    );

    await created.accounts.insert({
      id: 'acct-1',
      name: 'Alpha',
    });

    await expect(
      created.accounts.insert({
        id: 'acct-1',
        name: 'Duplicate',
      })
    ).rejects.toBeInstanceOf(AlreadyExistsError);

    await expect(
      created.gists.insert({
        ownerId: 'missing-account',
      })
    ).rejects.toBeInstanceOf(ValidationError);

    await db.dispose?.(created);
  });

  test('maps z.number().int() to INTEGER (Zod internals regression guard)', () => {
    const intStore = store(
      {
        counters: {
          generated: ['id'],
          primaryKey: 'id',
          schema: z.object({
            id: z.number().int(),
            value: z.number(),
          }),
        },
      },
      { url: join(tmp.makeRoot(), 'int.sqlite') }
    );

    const schema = getSchema(intStore);
    const col = schema.counters;
    expect(col).toBeDefined();

    const idColumn = col.id as unknown as { columnType: string };
    expect(idColumn.columnType).toBe('SQLiteInteger');
  });

  test('rejects non-tabular store definitions with a clear error', () => {
    const documentStore = defineStore(
      {
        documents: {
          generated: ['id'],
          primaryKey: 'id',
          schema: z.object({
            body: z.string(),
            id: z.string(),
          }),
        },
      },
      { kind: 'document' }
    );
    const rootDir = tmp.makeRoot();

    const expectKindMismatch = (run: () => unknown) => {
      try {
        run();
        throw new Error(
          'expected connector binding to reject a non-tabular store'
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).toContain('kind "tabular"');
        expect((error as Error).message).toContain('"document"');
      }
    };

    expectKindMismatch(() =>
      connectDrizzle(documentStore, {
        url: join(rootDir, 'document.sqlite'),
      })
    );
    expectKindMismatch(() =>
      connectReadOnlyDrizzle(documentStore, {
        url: join(rootDir, 'document-readonly.sqlite'),
      })
    );
  });

  test('update returns null for a non-existent ID', async () => {
    const db = createFixtureBackedStore();
    const mock = await db.mock?.();
    expect(mock).toBeDefined();

    const result = await mock?.gists.update('ghost-id', {
      description: 'nope',
    });
    expect(result).toBeNull();
  });

  test('update rejects empty fields even when updatedAt is generated', async () => {
    const db = createFixtureBackedStore();
    const mock = await db.mock?.();
    expect(mock).toBeDefined();

    await expect(mock?.gists.update('gist-seed', {})).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});
