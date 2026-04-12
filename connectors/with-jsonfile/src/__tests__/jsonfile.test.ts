import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictError } from '@ontrails/core';
import { store as defineStore } from '@ontrails/store';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { connectJsonFile } from '../runtime.js';

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

const itemStore = defineStore({
  items: { identity: 'id', schema: itemSchema },
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

const createMockConnection = async <TConnection>(
  factory: (() => Promise<TConnection>) | undefined
): Promise<TConnection> => {
  if (factory === undefined) {
    throw new Error('Expected jsonfile store mock factory to be defined');
  }

  return await factory();
};

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
  });

  describe('identity generation', () => {
    test('generates id when not provided', async () => {
      const conn = await connectJsonFile(itemStore, {
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
  });
});
