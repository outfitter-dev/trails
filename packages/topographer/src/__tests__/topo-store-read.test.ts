import { afterEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import {
  ConflictError,
  DETOUR_MAX_ATTEMPTS_CAP,
  contour,
  resource,
  Result,
  schedule,
  signal,
  topo,
  trail,
  openWriteTrailsDb,
} from '@ontrails/core';
import type { Layer } from '@ontrails/core';

import {
  createMockTopoStore,
  createTopoSnapshot,
  createTopoStore,
  topoStore,
} from '../index.js';
import type {
  TopoStoreContourRecord,
  TopoStoreResourceRecord,
  TopoStoreTopoGraphEntryRecord,
  TopoStoreTrailDetailRecord,
} from '../index.js';
import { pinTopoSnapshot } from '../internal/topo-snapshots.js';
import type { TopoSnapshot } from '../internal/topo-snapshots.js';
import { listTopoStoreSignals } from '../internal/topo-store-read.js';

const noop = () => Result.ok({ ok: true });

const passThroughLayer = (name: string, input?: Layer['input']): Layer => ({
  ...(input === undefined ? {} : { input }),
  name,
  wrap: (_trail, implementation) => implementation,
});

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

const countSignalRelationQueries = (
  db: Database
): {
  readonly counts: Record<
    'topo_trail_fires' | 'topo_trail_on' | 'topo_trail_signals',
    number
  >;
  readonly db: Database;
} => {
  const counts = {
    topo_trail_fires: 0,
    topo_trail_on: 0,
    topo_trail_signals: 0,
  };
  const query = db.query.bind(db);
  const proxied = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'query') {
        return Reflect.get(target, prop, receiver);
      }
      return ((sql: string) => {
        if (sql.includes('FROM topo_trail_fires')) {
          counts.topo_trail_fires += 1;
        }
        if (sql.includes('FROM topo_trail_on')) {
          counts.topo_trail_on += 1;
        }
        if (sql.includes('FROM topo_trail_signals')) {
          counts.topo_trail_signals += 1;
        }
        return query(sql);
      }) as Database['query'];
    },
  });

  return { counts, db: proxied };
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
        expectedMatch: { ok: true },
        input: { name: 'Ada' },
        name: 'Add Ada',
        signals: [
          {
            payloadMatch: { id: 'ada' },
            signal: entityAdded,
          },
        ],
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
    detours: [
      {
        maxAttempts: 100,
        on: ConflictError,
        recover: async () => Result.ok(),
      },
    ],
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

const signalBatchApp = () => {
  const created = signal('entity.created', {
    from: ['entity.create'],
    payload: z.object({ id: z.string() }),
  });
  const updated = signal('entity.updated', {
    from: ['entity.update'],
    payload: z.object({ id: z.string() }),
  });
  const deleted = signal('entity.deleted', {
    from: ['entity.delete'],
    payload: z.object({ id: z.string() }),
  });
  const archived = signal('entity.archived', {
    from: ['entity.archive'],
    payload: z.object({ id: z.string() }),
  });

  const createTrail = trail('entity.create', {
    blaze: noop,
    fires: ['entity.created', 'entity.updated'],
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
  });
  const updateTrail = trail('entity.update', {
    blaze: noop,
    fires: [updated],
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
  });
  const deleteTrail = trail('entity.delete', {
    blaze: noop,
    fires: [deleted],
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
  });
  const archiveTrail = trail('entity.archive', {
    blaze: noop,
    fires: [archived],
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
  });
  const auditTrail = trail('entity.audit', {
    blaze: noop,
    input: z.object({}),
    on: ['entity.created', 'entity.updated', 'entity.deleted'],
    output: z.object({ ok: z.boolean() }),
  });
  const indexTrail = trail('entity.index', {
    blaze: noop,
    input: z.object({}),
    on: [created],
    output: z.object({ ok: z.boolean() }),
  });

  return topo('signal-batch-app', {
    archiveTrail,
    archived,
    auditTrail,
    createTrail,
    created,
    deleteTrail,
    deleted,
    indexTrail,
    updateTrail,
    updated,
  });
};

const graphAttachmentApp = () => {
  const account = contour(
    'account',
    {
      id: z.string(),
      name: z.string(),
    },
    { identity: 'id' }
  );
  const entity = contour(
    'entity',
    {
      accountId: account.id(),
      id: z.string(),
      name: z.string(),
    },
    { identity: 'id' }
  );
  const topoPolicy = passThroughLayer(
    'topo.policy',
    z.object({ tenant: z.string() })
  );
  const trailAudit = passThroughLayer(
    'trail.audit',
    z.object({ requestId: z.string() })
  );
  const created = signal('entity.created', {
    payload: z.object({ id: z.string() }),
  });
  const auditSchedule = schedule('schedule.entity.audit', {
    cron: '0 2 * * *',
    input: { id: 'daily' },
    meta: { owner: 'entity' },
    timezone: 'UTC',
  });
  const process = trail('entity.process', {
    blaze: () => Result.ok({ ok: true }),
    contours: [entity],
    fields: { id: { hint: 'Entity id to process' } },
    fires: [created],
    input: z.object({ id: z.string() }),
    layers: [trailAudit],
    meta: { owner: 'core' },
    on: [auditSchedule],
    output: z.object({ ok: z.boolean() }),
  });

  return topo(
    'graph-attachment-app',
    {
      account,
      created,
      entity,
      process,
    },
    { layers: [topoPolicy] }
  );
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

  test('lists signal relations with three batched relation queries for multiple signals', async () => {
    const rootDir = makeRoot();
    const snapshot = await expectOk(
      createTopoSnapshot(signalBatchApp(), {
        createdAt: '2026-04-03T15:00:00.000Z',
        gitSha: 'abc123',
        rootDir,
      })
    );
    const db = openWriteTrailsDb({ rootDir });

    try {
      const counted = countSignalRelationQueries(db);
      const records = listTopoStoreSignals(counted.db, {
        snapshot: { snapshotId: snapshot.id },
      });

      expect(records).toHaveLength(4);
      expect(records.find((record) => record.id === 'entity.created')).toEqual(
        expect.objectContaining({
          consumers: ['entity.audit', 'entity.index'],
          from: ['entity.create'],
          producers: ['entity.create'],
        })
      );
      expect(records.find((record) => record.id === 'entity.updated')).toEqual(
        expect.objectContaining({
          consumers: ['entity.audit'],
          from: ['entity.update'],
          producers: ['entity.create', 'entity.update'],
        })
      );
      expect(counted.counts).toEqual({
        topo_trail_fires: 1,
        topo_trail_on: 1,
        topo_trail_signals: 1,
      });
    } finally {
      db.close();
    }
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

    const db = openWriteTrailsDb({ rootDir });
    try {
      db.query(
        `UPDATE topo_trails
         SET intent = NULL
         WHERE snapshot_id = ? AND id = ?`
      ).run(snapshot.id, 'entity.add');
    } finally {
      db.close();
    }

    const defaultWriteTrails = store.trails.list({
      intent: 'write',
      snapshot: { snapshotId: snapshot.id },
    });
    expect(defaultWriteTrails).toHaveLength(1);
    expect(defaultWriteTrails[0]?.id).toBe('entity.add');
    expect(defaultWriteTrails[0]?.intent).toBe('write');
  });

  test('mock get accessors require a resolved snapshot', () => {
    const snapshotId = 'snap-missing';
    const mock = createMockTopoStore({
      contours: [
        {
          id: 'entity',
          kind: 'contour',
          snapshotId,
        } as TopoStoreContourRecord,
      ],
      entries: [
        {
          id: 'entity.add',
          kind: 'trail',
          snapshotId,
        } as TopoStoreTopoGraphEntryRecord,
      ],
      resources: [
        {
          id: 'db.main',
          snapshotId,
        } as TopoStoreResourceRecord,
      ],
      trails: [
        {
          id: 'entity.add',
          snapshotId,
        } as TopoStoreTrailDetailRecord,
      ],
    });

    expect(mock.contours.get('entity')).toBeUndefined();
    expect(mock.entries.get('entity.add')).toBeUndefined();
    expect(mock.resources.get('db.main')).toBeUndefined();
    expect(mock.trails.get('entity.add')).toBeUndefined();
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
        detours: [
          { maxAttempts: DETOUR_MAX_ATTEMPTS_CAP, on: 'ConflictError' },
        ],
        id: 'entity.list',
        resources: ['db.main'],
      })
    );
    expect(detail?.examples).toEqual([]);

    const addDetail = store.trails.get('entity.add', {
      snapshot: { snapshotId: snapshot.id },
    });
    expect(addDetail?.examples).toEqual([
      {
        description: null,
        error: null,
        expected: { id: 'ada', ok: true },
        expectedMatch: { ok: true },
        input: { name: 'Ada' },
        name: 'Add Ada',
        ordinal: 0,
        signals: [
          {
            payloadMatch: { id: 'ada' },
            signalId: 'entity.added',
          },
        ],
      },
    ]);

    const exported = store.exports.get({ pin: 'baseline' });
    expect(exported?.snapshot.id).toBe(snapshot.id);
    expect(exported?.topoGraphHash).toHaveLength(64);

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

  test('exposes typed views over saved TopoGraph content', async () => {
    const rootDir = makeRoot();
    const snapshot = await expectOk(
      createTopoSnapshot(graphAttachmentApp(), {
        createdAt: '2026-04-03T16:00:00.000Z',
        gitSha: 'abc123',
        rootDir,
      })
    );
    const store = createTopoStore({ rootDir });

    const exported = store.exports.get({ snapshotId: snapshot.id });
    expect(exported?.lockManifest.artifacts[0]?.sha256).toBe(
      exported?.topoGraphHash
    );
    expect(exported?.topoGraph.topoGraphSchemaVersion).toBe(1);

    const topoGraph = store.topoGraph.get({ snapshotId: snapshot.id });
    expect(topoGraph?.snapshot.id).toBe(snapshot.id);
    expect(topoGraph?.topoGraph.activationGraph.sourceKeys).toContain(
      'schedule:schedule.entity.audit'
    );

    const processEntry = store.entries.get('entity.process', {
      kind: 'trail',
      snapshot: { snapshotId: snapshot.id },
    });
    expect(processEntry).toEqual(
      expect.objectContaining({
        fieldOverrides: [
          {
            field: 'id',
            overrides: ['hint'],
            provenance: { source: 'trail.fields' },
          },
        ],
        fires: ['entity.created'],
        id: 'entity.process',
        kind: 'trail',
        surfaces: [],
      })
    );
    expect(processEntry?.activationSources).toEqual([
      {
        source: {
          cron: '0 2 * * *',
          id: 'schedule.entity.audit',
          input: { id: 'daily' },
          key: 'schedule:schedule.entity.audit',
          kind: 'schedule',
          meta: { owner: 'entity' },
          timezone: 'UTC',
        },
      },
    ]);
    expect(processEntry?.input).toEqual(
      expect.objectContaining({
        properties: { id: { type: 'string' } },
        type: 'object',
      })
    );
    expect(processEntry?.layers).toEqual([
      {
        input: expect.objectContaining({
          properties: { tenant: { type: 'string' } },
          type: 'object',
        }),
        name: 'topo.policy',
        scope: 'topo',
      },
      {
        input: expect.objectContaining({
          properties: { requestId: { type: 'string' } },
          type: 'object',
        }),
        name: 'trail.audit',
        scope: 'trail',
      },
    ]);

    const contours = store.contours.list({
      snapshot: { snapshotId: snapshot.id },
    });
    expect(contours.map((entry) => entry.id)).toEqual(['account', 'entity']);
    expect(
      store.contours.get('entity', {
        snapshot: { snapshotId: snapshot.id },
      })
    ).toEqual(
      expect.objectContaining({
        identity: 'id',
        references: [
          {
            contour: 'account',
            field: 'accountId',
            identity: 'id',
          },
        ],
        schema: expect.objectContaining({
          properties: expect.objectContaining({
            accountId: { type: 'string' },
            id: { type: 'string' },
          }),
          type: 'object',
        }),
      })
    );

    expect(
      store.entries.list({
        kind: 'signal',
        snapshot: { snapshotId: snapshot.id },
      })
    ).toEqual([
      expect.objectContaining({
        id: 'entity.created',
        kind: 'signal',
        payload: expect.objectContaining({ type: 'object' }),
      }),
    ]);
    expect(
      store.entries.get('missing', { snapshot: { snapshotId: snapshot.id } })
    ).toBeUndefined();
  });

  test('defaults omitted detour maxAttempts to one in detailed views', async () => {
    const rootDir = makeRoot();
    const withDefaultDetour = trail('entity.with-default-detour', {
      blaze: noop,
      /* oxlint-disable-next-line require-await -- test stub */
      detours: [
        {
          on: ConflictError,
          recover: async () => Result.ok(),
        },
      ],
      input: z.object({}),
    });
    const snapshot = await expectOk(
      createTopoSnapshot(topo('default-detour-app', { withDefaultDetour }), {
        createdAt: '2026-04-03T14:00:00.000Z',
        gitSha: 'abc123',
        rootDir,
      })
    );
    const store = createTopoStore({ rootDir });
    const detail = store.trails.get('entity.with-default-detour', {
      snapshot: { snapshotId: snapshot.id },
    });

    expect(detail?.detours).toEqual([{ maxAttempts: 1, on: 'ConflictError' }]);
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
