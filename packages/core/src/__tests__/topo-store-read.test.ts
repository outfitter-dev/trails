import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import {
  createMockTopoStore,
  createTopoStore,
  provision,
  Result,
  signal,
  topo,
  topoStore,
  trail,
} from '../index.js';
import { pinTopoSave } from '../internal/topo-saves.js';
import type { TopoSaveRecord } from '../internal/topo-saves.js';
import { persistEstablishedTopoSave } from '../internal/topo-store.js';
import { openWriteTrailsDb } from '../internal/trails-db.js';

const noop = () => Result.ok({ ok: true });

const expectOk = async <T>(
  result: Promise<Result<T, Error>> | Result<T, Error>
): Promise<T> => {
  const resolved = await result;
  if (resolved.isErr()) {
    throw resolved.error;
  }
  return resolved.value;
};

const requireValue = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
};

const exampleApp = () => {
  const dbMain = provision('db.main', {
    create: () => Result.ok({ source: 'factory' }),
    description: 'Primary database',
    health: () => Result.ok({ ok: true }),
    mock: () => ({ source: 'mock' }),
  });

  const entityAdded = signal('entity.added', {
    description: 'An entity was added',
    from: ['entity.add'],
    payload: z.object({ id: z.string() }),
  });

  const entityAdd = trail('entity.add', {
    blaze: (input: { readonly name: string }) =>
      Result.ok({ id: input.name.toLowerCase(), ok: true }),
    description: 'Add a new entity',
    examples: [
      {
        expected: { id: 'ada', ok: true },
        input: { name: 'Ada' },
        name: 'Add Ada',
      },
    ],
    input: z.object({ name: z.string() }),
    output: z.object({ id: z.string(), ok: z.boolean() }),
    provisions: [dbMain],
  });

  const entityList = trail('entity.list', {
    blaze: noop,
    crosses: ['entity.add'],
    description: 'List entities',
    detours: {
      ConflictError: ['entity.add'],
    },
    idempotent: true,
    input: z.object({}),
    intent: 'read',
    output: z.object({ ok: z.boolean() }),
    provisions: [dbMain],
  });

  return topo('projection-app', {
    dbMain,
    entityAdd,
    entityAdded,
    entityList,
  });
};

describe('read-only topo store', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { force: true, recursive: true });
      tmpRoot = undefined;
    }
  });

  const makeRoot = (): string => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'topo-store-read-'));
    return tmpRoot;
  };

  const seedStore = (): {
    readonly rootDir: string;
    readonly save: TopoSaveRecord;
  } => {
    const rootDir = makeRoot();
    const db = openWriteTrailsDb({ rootDir });

    try {
      const result = persistEstablishedTopoSave(db, exampleApp(), {
        createdAt: '2026-04-03T14:00:00.000Z',
        gitSha: 'abc123',
      });
      if (result.isErr()) {
        throw result.error;
      }
      const save = result.value;
      pinTopoSave(db, { name: 'baseline', saveId: save.id });
      return { rootDir, save };
    } finally {
      db.close();
    }
  };

  test('lists save-scoped trails and provisions through typed accessors', () => {
    const { rootDir, save } = seedStore();
    const store = createTopoStore({ rootDir });

    expect(store.saves.latest()?.id).toBe(save.id);
    expect(store.pins.get('baseline')?.saveId).toBe(save.id);

    expect(store.trails.list({ save: { saveId: save.id } })).toEqual([
      expect.objectContaining({
        description: 'Add a new entity',
        exampleCount: 1,
        hasOutput: true,
        id: 'entity.add',
        intent: 'write',
      }),
      expect.objectContaining({
        description: 'List entities',
        exampleCount: 0,
        id: 'entity.list',
        intent: 'read',
        safety: 'read',
      }),
    ]);

    expect(store.provisions.list({ save: { saveId: save.id } })).toEqual([
      expect.objectContaining({
        description: 'Primary database',
        health: 'available',
        id: 'db.main',
        usedBy: ['entity.add', 'entity.list'],
      }),
    ]);
  });

  test('returns detailed trail and export views, plus a query escape hatch', () => {
    const { rootDir, save } = seedStore();
    const store = createTopoStore({ rootDir });

    const detail = store.trails.get('entity.list', {
      save: { saveId: save.id },
    });
    expect(detail).toEqual(
      expect.objectContaining({
        crosses: ['entity.add'],
        detours: { ConflictError: ['entity.add'] },
        id: 'entity.list',
        provisions: ['db.main'],
      })
    );
    expect(detail?.examples).toEqual([]);

    const exported = store.exports.get({ pin: 'baseline' });
    expect(exported?.save.id).toBe(save.id);
    expect(exported?.trailheadHash).toHaveLength(64);

    const rows = store.query<{ id: string }>(
      'SELECT id FROM topo_trails WHERE save_id = ? ORDER BY id ASC',
      [save.id]
    );
    expect(rows).toEqual([{ id: 'entity.add' }, { id: 'entity.list' }]);
  });

  test('fails loudly when no saved topo state exists', () => {
    const rootDir = makeRoot();
    const store = createTopoStore({ rootDir });

    expect(() => store.saves.latest()).toThrow('No saved topo state found');
    expect(() => store.trails.list()).toThrow('No saved topo state found');
    expect(() => store.exports.get()).toThrow('No saved topo state found');
  });

  test('exposes a provision factory and mock for topoStore', async () => {
    const { rootDir } = seedStore();

    const created = await expectOk(
      topoStore.create({
        config: undefined,
        cwd: rootDir,
        env: {},
        workspaceRoot: rootDir,
      })
    );

    expect(created.saves.latest()).toBeDefined();
    expect(
      created.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM topo_saves'
      )[0]?.count
    ).toBe(1);

    expect(topoStore.mock).toBeDefined();
    const mock = await requireValue(
      topoStore.mock,
      'Expected topoStore to define a mock factory'
    )();
    expect(mock).toBeDefined();
    expect(() =>
      createMockTopoStore().query('SELECT id FROM topo_trails')
    ).toThrow('Mock topoStore.query() is unsupported');
  });
});
