import { afterEach, describe, expect, test } from 'bun:test';
import {
  AlreadyExistsError,
  ValidationError,
  createTrailContext,
} from '@ontrails/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { getSchema, readonlyStore, store } from '../index.js';

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

const setupWritableDemoStore = async (rootDir: string) => {
  const db = createWritableDemoStore(rootDir);
  return {
    created: await unwrapCreated(db.create(createResourceInput(rootDir))),
    db,
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
    created.users.insert({ email: 'alice@example.com' })
  );
  expect(user.id).toEqual(expect.any(String));

  const gist = await expectOk(
    created.gists.insert({
      ownerId: user.id,
    })
  );
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
    created.gists.update(gist.id, {
      description: 'Updated',
    })
  );

  expect(updated).toEqual(
    expect.objectContaining({
      description: 'Updated',
      id: gist.id,
    })
  );
  expect(updated?.updatedAt).toEqual(expect.any(String));
  expect(updated?.updatedAt).not.toBe(gist.updatedAt);
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

describe('@ontrails/store/drizzle', () => {
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

  test('binds a writable resource with CRUD accessors and one escape hatch', async () => {
    const rootDir = makeRoot();
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
    const rootDir = makeRoot();
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

  test('maps primary-key and foreign-key failures into Trails errors', async () => {
    const rootDir = makeRoot();
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
      { url: join(makeRoot(), 'int.sqlite') }
    );

    const schema = getSchema(intStore);
    const col = schema.counters;
    expect(col).toBeDefined();

    const idColumn = col.id as unknown as { columnType: string };
    expect(idColumn.columnType).toBe('SQLiteInteger');
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
