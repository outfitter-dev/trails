import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import {
  ConflictError,
  createMockTopoStore,
  createTopoSnapshot,
  createTopoStore,
  resource,
  Result,
  signal,
  topo,
  topoStore,
  trail,
} from '../index.js';
import { pinTopoSnapshot } from '../internal/topo-snapshots.js';
import type { TopoSnapshot } from '../internal/topo-snapshots.js';
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
  const dbMain = resource('db.main', {
    create: () => Result.ok({ source: 'factory' }),
    description: 'Primary database',
    health: () => Result.ok({ ok: true }),
    mock: () => ({ source: 'mock' }),
  });

  const entityAdded = signal('entity.added', {
    description: 'An entity was added',
    examples: [{ id: 'ada' }],
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
    resources: [dbMain],
  });

  const entityList = trail('entity.list', {
    blaze: noop,
    crosses: ['entity.add'],
    description: 'List entities',
    /* oxlint-disable-next-line require-await -- test stub */
    detours: [{ on: ConflictError, recover: async () => Result.ok() }],
    idempotent: true,
    input: z.object({}),
    intent: 'read',
    output: z.object({ ok: z.boolean() }),
    resources: [dbMain],
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
    readonly snapshot: TopoSnapshot;
  } => {
    const rootDir = makeRoot();
    const db = openWriteTrailsDb({ rootDir });

    try {
      const result = createTopoSnapshot(exampleApp(), {
        createdAt: '2026-04-03T14:00:00.000Z',
        gitSha: 'abc123',
        rootDir,
      });
      if (result.isErr()) {
        throw result.error;
      }
      const snapshot = result.value;
      pinTopoSnapshot(db, { id: snapshot.id, name: 'baseline' });
      return { rootDir, snapshot };
    } finally {
      db.close();
    }
  };

  test('lists snapshot-scoped trails and resources through typed accessors', () => {
    const { rootDir, snapshot } = seedStore();
    const store = createTopoStore({ rootDir });

    expect(store.snapshots.latest()?.id).toBe(snapshot.id);
    expect(store.snapshots.get({ pin: 'baseline' })?.id).toBe(snapshot.id);

    expect(
      store.trails.list({ snapshot: { snapshotId: snapshot.id } })
    ).toEqual([
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

    expect(
      store.resources.list({ snapshot: { snapshotId: snapshot.id } })
    ).toEqual([
      expect.objectContaining({
        description: 'Primary database',
        health: 'available',
        id: 'db.main',
        usedBy: ['entity.add', 'entity.list'],
      }),
    ]);

    expect(
      store.signals.list({ snapshot: { snapshotId: snapshot.id } })
    ).toEqual([
      expect.objectContaining({
        consumers: [],
        description: 'An entity was added',
        exampleCount: 1,
        from: ['entity.add'],
        hasExamples: true,
        id: 'entity.added',
        producers: [],
      }),
    ]);
  });

  test('filters trails by intent', () => {
    const { rootDir, snapshot } = seedStore();
    const store = createTopoStore({ rootDir });

    const writeTrails = store.trails.list({
      intent: 'write',
      snapshot: { snapshotId: snapshot.id },
    });
    expect(writeTrails).toHaveLength(1);
    expect(writeTrails[0]?.id).toBe('entity.add');

    const readTrails = store.trails.list({
      intent: 'read',
      snapshot: { snapshotId: snapshot.id },
    });
    expect(readTrails).toHaveLength(1);
    expect(readTrails[0]?.id).toBe('entity.list');
  });

  test('returns detailed trail and export views, plus a query escape hatch', () => {
    const { rootDir, snapshot } = seedStore();
    const store = createTopoStore({ rootDir });

    const detail = store.trails.get('entity.list', {
      snapshot: { snapshotId: snapshot.id },
    });
    expect(detail).toEqual(
      expect.objectContaining({
        crosses: ['entity.add'],
        detours: [{ maxAttempts: 1, on: 'ConflictError' }],
        id: 'entity.list',
        resources: ['db.main'],
      })
    );
    expect(detail?.examples).toEqual([]);

    const exported = store.exports.get({ pin: 'baseline' });
    expect(exported?.snapshot.id).toBe(snapshot.id);
    expect(exported?.surfaceHash).toHaveLength(64);

    const signalDetail = store.signals.get('entity.added', {
      snapshot: { snapshotId: snapshot.id },
    });
    expect(signalDetail).toEqual(
      expect.objectContaining({
        examples: [{ id: 'ada' }],
        from: ['entity.add'],
        id: 'entity.added',
        payload: expect.objectContaining({ type: 'object' }),
      })
    );

    const rows = store.query<{ id: string }>(
      'SELECT id FROM topo_trails WHERE snapshot_id = ? ORDER BY id ASC',
      [snapshot.id]
    );
    expect(rows).toEqual([{ id: 'entity.add' }, { id: 'entity.list' }]);
  });

  test('fails loudly when no saved topo state exists', () => {
    const rootDir = makeRoot();
    const store = createTopoStore({ rootDir });

    expect(() => store.snapshots.latest()).toThrow('No saved topo state found');
    expect(() => store.trails.list()).toThrow('No saved topo state found');
    expect(() => store.exports.get()).toThrow('No saved topo state found');
  });

  test('exposes a resource factory and mock for topoStore', async () => {
    const { rootDir } = seedStore();

    const created = await expectOk(
      topoStore.create({
        config: undefined,
        cwd: rootDir,
        env: {},
        workspaceRoot: rootDir,
      })
    );

    expect(created.snapshots.latest()).toBeDefined();
    expect(
      created.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM topo_snapshots'
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
