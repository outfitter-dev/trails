import { expect, test } from 'bun:test';
import { ValidationError } from '@ontrails/core';
import { store } from '@ontrails/store';
import { Miniflare } from 'miniflare';
import { z } from 'zod';

import { getEnvBinding } from '../../env.js';
import { cloudflareD1, connectD1, renderD1SchemaSql } from '../index.js';
import type { CloudflareD1Database } from '../index.js';

const notes = {
  identity: 'id',
  schema: z.object({ id: z.string(), title: z.string() }),
} as const;
const definition = store({ notes });

test('initial SQL is deterministic, create-only and safely quotes the same physical names', () => {
  const app = store({ alpha: notes, zebra: notes });
  const sql = renderD1SchemaSql(app);
  expect(sql).toBe(
    'CREATE TABLE IF NOT EXISTS "store.alpha" (id TEXT PRIMARY KEY, entity TEXT NOT NULL, version INTEGER);\nCREATE TABLE IF NOT EXISTS "store.zebra" (id TEXT PRIMARY KEY, entity TEXT NOT NULL, version INTEGER);\n'
  );
  expect(renderD1SchemaSql(app)).toBe(sql);
  expect(
    renderD1SchemaSql(definition, { tablePrefix: 'odd"prefix' })
  ).toContain('"odd""prefix.notes"');
});

test('configured runtime seed requires explicit dev bootstrap at both public boundaries', () => {
  const database = {} as CloudflareD1Database;
  const seed = { notes: [{ id: 'seed', title: 'seed' }] };
  expect(() => connectD1(definition, database, { seed })).toThrow(
    ValidationError
  );
  expect(() => cloudflareD1(definition, { binding: 'DB', seed })).toThrow(
    ValidationError
  );
});

test('native baseline, additive migration, compatible adoption and missing-schema defaults', async () => {
  const runtime = new Miniflare({
    compatibilityDate: '2026-06-01',
    d1Databases: ['DB'],
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
  });
  try {
    const database = await runtime.getD1Database('DB');
    const statements: string[] = [];
    const observed: CloudflareD1Database = {
      exec: async (sql) => {
        statements.push(sql);
        return database.exec(sql);
      },
      prepare: (sql) => {
        statements.push(sql);
        return database.prepare(sql);
      },
    };
    const missing = connectD1(definition, observed);
    await expect(missing.notes.get('n1')).rejects.toThrow('no such table');
    expect(statements.every((sql) => !/CREATE|INSERT|ALTER/i.test(sql))).toBe(
      true
    );
    // Explicit reviewed baseline application, outside request initialization.
    await database.exec(renderD1SchemaSql(definition));
    statements.length = 0;
    const connection = connectD1(definition, observed);
    await connection.notes.upsert({ id: 'n1', title: 'kept' });
    expect(await connection.notes.get('n1')).toEqual({
      id: 'n1',
      title: 'kept',
    });
    expect(statements.every((sql) => !/CREATE|ALTER/i.test(sql))).toBe(true);
    const expanded = store({ archive: notes, notes });
    // A subsequent authored migration adds just the new physical table.
    await database.exec(
      'CREATE TABLE "store.archive" (id TEXT PRIMARY KEY, entity TEXT NOT NULL, version INTEGER);'
    );
    const later = connectD1(expanded, database);
    await later.archive.upsert({ id: 'a1', title: 'archived' });
    expect(await later.notes.get('n1')).toEqual({ id: 'n1', title: 'kept' });
    expect(await later.archive.get('a1')).toEqual({
      id: 'a1',
      title: 'archived',
    });

    const legacy = connectD1(definition, database, {
      autoCreate: true,
      tablePrefix: 'legacy',
    });
    await legacy.notes.upsert({ id: 'old', title: 'preserved' });
    const layout = await observed
      .prepare('PRAGMA table_info("legacy.notes")')
      .all<{ name: string; type: string; notnull: number; pk: number }>();
    expect(
      layout.results?.map(({ name, type, notnull, pk }) => ({
        name,
        notnull,
        pk,
        type,
      }))
    ).toEqual([
      { name: 'id', notnull: 0, pk: 1, type: 'TEXT' },
      { name: 'entity', notnull: 1, pk: 0, type: 'TEXT' },
      { name: 'version', notnull: 0, pk: 0, type: 'INTEGER' },
    ]);
    await database.exec(
      renderD1SchemaSql(definition, { tablePrefix: 'legacy' })
    );
    expect(
      await connectD1(definition, database, {
        tablePrefix: 'legacy',
      }).notes.get('old')
    ).toEqual({ id: 'old', title: 'preserved' });

    for (const options of [
      { binding: 'DB', id: 'first' },
      { binding: 'DB', id: 'second', tablePrefix: 'custom"scope' },
    ]) {
      const resource = cloudflareD1(definition, options);
      const prefix = options.tablePrefix ?? resource.id;
      await database.exec(
        renderD1SchemaSql(resource.store, { tablePrefix: prefix })
      );
      const binding = getEnvBinding(resource);
      expect(binding).toBeDefined();
      statements.length = 0;
      const resolved = binding?.fromEnv(observed);
      if (resolved === undefined || resolved.isErr()) {
        throw new Error('Native D1 resource failed');
      }
      const value = resolved.value as ReturnType<
        typeof connectD1<typeof definition>
      >;
      await value.notes.upsert({ id: 'shared-id', title: prefix });
      expect(await value.notes.get('shared-id')).toEqual({
        id: 'shared-id',
        title: prefix,
      });
      expect(statements.every((sql) => !/CREATE|ALTER/i.test(sql))).toBe(true);
    }
  } finally {
    await runtime.dispose();
  }
}, 120_000);
