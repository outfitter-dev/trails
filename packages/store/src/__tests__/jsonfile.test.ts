import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictError, Result, topo, trail } from '@ontrails/core';
import { store as defineStore } from '@ontrails/store';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { connectJsonFile, jsonFile } from '../jsonfile/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  category: z.string().optional(),
  id: z.string(),
  name: z.string(),
});

const versionedSchema = z.object({
  id: z.string(),
  title: z.string(),
});

const timestampedSchema = z.object({
  body: z.string(),
  createdAt: z.string(),
  id: z.string(),
});

const fullTimestampSchema = z.object({
  body: z.string(),
  createdAt: z.string(),
  id: z.string(),
  updatedAt: z.string(),
});

const itemStore = defineStore({
  items: { identity: 'id', schema: itemSchema },
});

const autoIdStore = defineStore({
  items: { generated: ['id'] as const, identity: 'id', schema: itemSchema },
});

const generatedNameStore = defineStore({
  items: {
    generated: ['name'] as const,
    identity: 'id',
    schema: itemSchema,
  },
});

const fixtureStore = defineStore({
  items: {
    fixtures: [{ id: 'fixture-1', name: 'Fixture row' }],
    identity: 'id',
    schema: itemSchema,
  },
});

const versionedStore = defineStore({
  docs: { identity: 'id', schema: versionedSchema, versioned: true },
});

const timestampedStore = defineStore({
  notes: {
    generated: ['createdAt'] as const,
    identity: 'id',
    schema: timestampedSchema,
  },
});

const fullTimestampStore = defineStore({
  entries: {
    generated: ['createdAt', 'updatedAt'] as const,
    identity: 'id',
    schema: fullTimestampSchema,
  },
});

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jsonfile-test-'));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

const expectConflictError = async (
  run: () => unknown,
  messagePart: string
): Promise<void> => {
  const outcome = await Promise.resolve()
    .then(run)
    .then(
      () => null,
      (error: unknown) => error
    );
  if (outcome === null) {
    throw new Error('Expected a ConflictError');
  }
  expect(outcome).toBeInstanceOf(ConflictError);
  expect(String(outcome)).toContain(messagePart);
};

/** Copy a JSON table file into a fresh directory and load it via a new connection. */
const reloadAndList = async (
  sourceDir: string,
  fileName: string
): Promise<readonly z.infer<typeof itemSchema>[]> => {
  const reloadDir = await mkdtemp(join(tmpdir(), 'jsonfile-reload-'));
  try {
    await copyFile(join(sourceDir, fileName), join(reloadDir, fileName));
    const conn = await connectJsonFile(itemStore, { dir: reloadDir });
    return await conn.items.list();
  } finally {
    await rm(reloadDir, { force: true, recursive: true });
  }
};

const createMockConnection = async <TConnection>(
  factory: (() => TConnection | Promise<TConnection>) | undefined
): Promise<TConnection> => {
  if (factory === undefined) {
    throw new Error('Expected jsonfile store mock factory to be defined');
  }

  return await factory();
};

const stableGeneratedId = (): string => 'generated-id';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('jsonfile connector', () => {
  describe('upsert and get', () => {
    test('creates new entity', async () => {
      const conn = await connectJsonFile(itemStore, { dir });
      const result = await conn.items.upsert({ id: '1', name: 'Widget' });
      expect(result.id).toBe('1');
      expect(result.name).toBe('Widget');

      const fetched = await conn.items.get('1');
      expect(fetched).toEqual(result);
    });

    test('replaces existing entity', async () => {
      const conn = await connectJsonFile(itemStore, { dir });
      await conn.items.upsert({ id: '1', name: 'Original' });
      const updated = await conn.items.upsert({ id: '1', name: 'Updated' });
      expect(updated.name).toBe('Updated');

      const fetched = await conn.items.get('1');
      expect(fetched?.name).toBe('Updated');
    });
  });

  describe('get', () => {
    test('returns null for missing entity', async () => {
      const conn = await connectJsonFile(itemStore, { dir });
      const result = await conn.items.get('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    test('returns all entities', async () => {
      const conn = await connectJsonFile(itemStore, { dir });
      await conn.items.upsert({ id: '1', name: 'A' });
      await conn.items.upsert({ id: '2', name: 'B' });
      await conn.items.upsert({ id: '3', name: 'C' });

      const all = await conn.items.list();
      expect(all).toHaveLength(3);
    });

    test('filters by field', async () => {
      const conn = await connectJsonFile(itemStore, { dir });
      await conn.items.upsert({ category: 'x', id: '1', name: 'A' });
      await conn.items.upsert({ category: 'y', id: '2', name: 'B' });
      await conn.items.upsert({ category: 'x', id: '3', name: 'C' });

      const filtered = await conn.items.list({ category: 'x' });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.category === 'x')).toBe(true);
    });

    test('limit restricts number of results', async () => {
      const conn = await connectJsonFile(itemStore, { dir });
      await conn.items.upsert({ id: '1', name: 'A' });
      await conn.items.upsert({ id: '2', name: 'B' });
      await conn.items.upsert({ id: '3', name: 'C' });

      const limited = await conn.items.list(undefined, { limit: 2 });
      expect(limited).toHaveLength(2);
    });

    test('offset skips first N results', async () => {
      const conn = await connectJsonFile(itemStore, { dir });
      await conn.items.upsert({ id: '1', name: 'A' });
      await conn.items.upsert({ id: '2', name: 'B' });
      await conn.items.upsert({ id: '3', name: 'C' });

      const skipped = await conn.items.list(undefined, { offset: 1 });
      expect(skipped).toHaveLength(2);
    });

    test('limit and offset together paginate correctly', async () => {
      const conn = await connectJsonFile(itemStore, { dir });
      await conn.items.upsert({ id: '1', name: 'A' });
      await conn.items.upsert({ id: '2', name: 'B' });
      await conn.items.upsert({ id: '3', name: 'C' });
      await conn.items.upsert({ id: '4', name: 'D' });

      const page = await conn.items.list(undefined, { limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
      expect(page[0]?.name).toBe('B');
      expect(page[1]?.name).toBe('C');
    });
  });

  describe('remove', () => {
    test('deletes existing entity', async () => {
      const conn = await connectJsonFile(itemStore, { dir });
      await conn.items.upsert({ id: '1', name: 'A' });

      const result = await conn.items.remove('1');
      expect(result.deleted).toBe(true);

      const fetched = await conn.items.get('1');
      expect(fetched).toBeNull();
    });

    test('returns false for missing entity', async () => {
      const conn = await connectJsonFile(itemStore, { dir });
      const result = await conn.items.remove('nonexistent');
      expect(result.deleted).toBe(false);
    });
  });

  describe('versioning', () => {
    test('version conflict on stale upsert', async () => {
      const conn = await connectJsonFile(versionedStore, { dir });
      await conn.docs.upsert({ id: '1', title: 'Draft' });

      await expect(
        conn.docs.upsert({ id: '1', title: 'Stale', version: 99 })
      ).rejects.toBeInstanceOf(ConflictError);
    });

    test('version auto-increments', async () => {
      const conn = await connectJsonFile(versionedStore, { dir });
      const v1 = await conn.docs.upsert({ id: '1', title: 'Draft' });
      expect(v1.version).toBe(1);

      const v2 = await conn.docs.upsert({
        id: '1',
        title: 'Revised',
        version: 1,
      });
      expect(v2.version).toBe(2);
    });
  });

  describe('persistence', () => {
    test('data persists to JSON file', async () => {
      const conn = await connectJsonFile(itemStore, { dir });
      await conn.items.upsert({ id: '1', name: 'Persisted' });

      const file = Bun.file(join(dir, 'items.json'));
      const raw = await file.json();
      expect(raw).toHaveLength(1);
      expect(raw[0].name).toBe('Persisted');
    });

    test('fresh connection loads data from disk', async () => {
      // Write data through the first connection.
      const conn1 = await connectJsonFile(itemStore, { dir });
      await conn1.items.upsert({ id: '1', name: 'First' });
      await conn1.items.upsert({ id: '2', name: 'Second' });

      // Create a second temp directory and copy the persisted JSON file into
      // it. Because the module-level tableRegistry is keyed by resolved file
      // path, pointing connectJsonFile at a new directory produces a fresh
      // accessor that must load from disk rather than returning a cached
      // in-memory instance.
      const all = await reloadAndList(dir, 'items.json');
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.name).toSorted()).toEqual(['First', 'Second']);
    });
  });

  describe('table reuse', () => {
    test('reuses the same table accessor when the config matches', async () => {
      const first = await connectJsonFile(autoIdStore, {
        dir,
        generateIdentity: stableGeneratedId,
      });
      await first.items.upsert({ name: 'First' });

      const second = await connectJsonFile(autoIdStore, {
        dir,
        generateIdentity: stableGeneratedId,
      });

      await expect(second.items.get('generated-id')).resolves.toEqual(
        expect.objectContaining({
          id: 'generated-id',
          name: 'First',
        })
      );
    });

    test('throws when a shared path is reused with a different table config', async () => {
      await connectJsonFile(itemStore, { dir });

      await expectConflictError(
        () => connectJsonFile(generatedNameStore, { dir }),
        'generatedFields'
      );
    });

    test('throws when a shared path is reused with a different identity generator', async () => {
      await connectJsonFile(autoIdStore, {
        dir,
        generateIdentity: () => 'first-id',
      });

      await expectConflictError(
        () =>
          connectJsonFile(autoIdStore, {
            dir,
            generateIdentity: () => 'second-id',
          }),
        'generateIdentity'
      );
    });
  });

  describe('identity generation', () => {
    test('generates id when not provided', async () => {
      const conn = await connectJsonFile(autoIdStore, {
        dir,
        generateIdentity: () => 'generated-id',
      });
      const result = await conn.items.upsert({ name: 'Auto' });
      expect(result.id).toBe('generated-id');
    });
  });

  describe('generated timestamps', () => {
    test('assigns createdAt on new entity', async () => {
      const conn = await connectJsonFile(timestampedStore, { dir });
      const result = await conn.notes.upsert({ body: 'Hello', id: 'n1' });
      expect(result.createdAt).toBeDefined();
      expect(typeof result.createdAt).toBe('string');
    });

    test('assigns updatedAt on update', async () => {
      const conn = await connectJsonFile(fullTimestampStore, { dir });
      const created = await conn.entries.upsert({ body: 'Hello', id: 'e1' });
      expect(created.updatedAt).toBeDefined();

      // Small delay so timestamps differ
      await Bun.sleep(5);

      const updated = await conn.entries.upsert({
        body: 'Revised',
        id: 'e1',
      });
      expect(updated.updatedAt).toBeDefined();
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });
  });

  describe('mock resource seeding', () => {
    test('seeds mock resources from authored fixtures', async () => {
      const store = jsonFile(fixtureStore, { dir });
      expect(store.mock).toBeDefined();
      const mock = await createMockConnection(store.mock);
      expect(mock).toBeDefined();
      expect(await mock.items.get('fixture-1')).toEqual(
        expect.objectContaining({
          id: 'fixture-1',
          name: 'Fixture row',
        })
      );
      expect(await mock.items.list()).toHaveLength(1);

      await store.dispose?.(mock);
    });

    test('uses mockSeed when provided for a table', async () => {
      const store = jsonFile(fixtureStore, {
        dir,
        mockSeed: {
          items: [{ id: 'seed-1', name: 'Seed override' }],
        },
      });
      expect(store.mock).toBeDefined();
      const mock = await createMockConnection(store.mock);
      expect(mock).toBeDefined();
      expect(await mock.items.get('seed-1')).toEqual(
        expect.objectContaining({
          id: 'seed-1',
          name: 'Seed override',
        })
      );
      expect(await mock.items.get('fixture-1')).toBeNull();
      expect(await mock.items.list()).toHaveLength(1);

      await store.dispose?.(mock);
    });

    test('preserves connector metadata on the resource definition', () => {
      const store = jsonFile(fixtureStore, {
        dir,
        meta: { domain: 'fixtures' },
      });

      expect(store.meta).toEqual({ domain: 'fixtures' });
    });

    test('propagates caller-provided description to the resource', () => {
      const store = jsonFile(fixtureStore, {
        description: 'Custom jsonfile store description',
        dir,
      });

      expect(store.description).toBe('Custom jsonfile store description');
    });

    test('uses a default description when caller omits one', () => {
      const store = jsonFile(fixtureStore, { dir });

      expect(store.description).toBe(
        'JSON-file-backed store bound from an @ontrails/store definition.'
      );
    });
  });
});

describe('jsonfile connector — topo integration', () => {
  let topoDir: string;

  beforeEach(async () => {
    topoDir = await mkdtemp(join(tmpdir(), 'jsonfile-topo-'));
  });

  afterEach(async () => {
    await rm(topoDir, { force: true, recursive: true });
  });

  const scopedSetup = (tmpDir: string) => {
    const definition = defineStore({
      items: { identity: 'id', schema: itemSchema },
    });
    const storeResource = jsonFile(definition, {
      dir: tmpDir,
      id: 'primary-store',
    });
    const onCreated = trail('items.on-created', {
      blaze: () => Result.ok({ seen: true }),
      description: 'Consumer that reacts to items.created on the scoped store.',
      input: z.object({}).passthrough(),
      on: [definition.tables.items.signals.created],
    });
    return { onCreated, storeResource };
  };

  test('topo construction does not throw for on: with scoped store signal', () => {
    const { onCreated, storeResource } = scopedSetup(topoDir);
    expect(() =>
      topo('jsonfile-scoped-store-app', {
        onCreated,
        storeResource,
      } as Record<string, unknown>)
    ).not.toThrow();
  });

  test('registers scoped signal id and late-binds trail on: reference', () => {
    const { onCreated, storeResource } = scopedSetup(topoDir);
    const graph = topo('jsonfile-scoped-store-app-2', {
      onCreated,
      storeResource,
    } as Record<string, unknown>);
    expect(graph.signals.has('primary-store:items.created')).toBe(true);
    expect(graph.get('items.on-created')?.on).toContain(
      'primary-store:items.created'
    );
  });
});
