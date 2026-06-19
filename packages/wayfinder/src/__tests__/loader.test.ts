import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import {
  Result,
  openReadTrailsDb,
  openWriteTrailsDb,
  topo,
  trail,
} from '@ontrails/core';
import {
  TOPO_GRAPH_SCHEMA_VERSION,
  TOPO_STORE_SCHEMA_VERSION,
  createTopoSnapshot,
  deriveTopoGraph,
  deriveTopoGraphHash,
  writeLockManifest,
  writeTopoGraph,
} from '@ontrails/topographer';
import type { LockManifest, TopoGraph } from '@ontrails/topographer';

import {
  loadWayfinderArtifacts,
  wayfinderFact,
  wayfinderTopoGraphSource,
  wayfinderTopoStoreSource,
} from '../index.js';

let tempDir: string;

const userShowTrail = trail('user.show', {
  blaze: () => Result.ok({ ok: true }),
  examples: [{ expected: { ok: true }, input: {}, name: 'Basic' }],
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});

const accountListTrail = trail('account.list', {
  blaze: () => Result.ok({ accounts: [] }),
  examples: [{ expected: { accounts: [] }, input: {}, name: 'Basic' }],
  input: z.object({}),
  intent: 'read',
  output: z.object({ accounts: z.array(z.object({ id: z.string() })) }),
});

const defaultTopoEntries = { userShowTrail };

const makeTopo = (
  entries: Record<
    string,
    typeof accountListTrail | typeof userShowTrail
  > = defaultTopoEntries
) => topo('demo', entries);

const countEntries = (
  topoGraph: TopoGraph,
  kind: TopoGraph['entries'][number]['kind']
): number => topoGraph.entries.filter((entry) => entry.kind === kind).length;

const makeLockManifest = (
  topoGraph: TopoGraph,
  overrides?: Partial<LockManifest>
): LockManifest => ({
  artifacts: [
    {
      path: 'topo.lock',
      role: 'topo',
      sha256: deriveTopoGraphHash(topoGraph),
    },
  ],
  scope: { app: 'demo' },
  summary: {
    contours: countEntries(topoGraph, 'contour'),
    resources: countEntries(topoGraph, 'resource'),
    signals: countEntries(topoGraph, 'signal'),
    trails: countEntries(topoGraph, 'trail'),
  },
  version: 3,
  ...overrides,
});

const artifactsDir = () => join(tempDir, '.trails');

const makeTopoGraph = (
  overrides?: Partial<TopoGraph>,
  graph = makeTopo()
): TopoGraph => ({
  ...deriveTopoGraph(graph),
  generatedAt: '2026-06-04T00:00:00.000Z',
  ...overrides,
});

const writeFreshArtifacts = async (
  overrides?: Partial<TopoGraph>,
  graph = makeTopo()
): Promise<TopoGraph> => {
  const topoGraph = makeTopoGraph(overrides, graph);
  await writeTopoGraph(topoGraph, { dir: artifactsDir() });
  await writeLockManifest(makeLockManifest(topoGraph), { dir: artifactsDir() });
  return topoGraph;
};

const seedTopoStore = (graph = makeTopo()) => {
  const snapshot = createTopoSnapshot(graph, {
    createdAt: '2026-06-04T00:00:00.000Z',
    gitSha: 'abc123',
    rootDir: tempDir,
  });
  if (snapshot.isErr()) {
    throw snapshot.error;
  }
  return snapshot.value;
};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'wayfinder-loader-test-'));
});

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true });
});

describe('loadWayfinderArtifacts', () => {
  test('loads fresh topo graph, lock manifest, and topo-store artifacts', async () => {
    await writeFreshArtifacts();
    const snapshot = seedTopoStore();

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.freshness).toEqual({ status: 'fresh' });
    expect(loaded.topoGraph?.entries.map((entry) => entry.id)).toEqual([
      'user.show',
    ]);
    expect(loaded.lockManifest?.version).toBe(3);
    expect(loaded.topoStore?.schemaVersion).toBe(TOPO_STORE_SCHEMA_VERSION);
    expect(loaded.topoStore?.snapshot.id).toBe(snapshot.id);
    expect(loaded.topoStore?.trails.map((entry) => entry.id)).toEqual([
      'user.show',
    ]);
  });

  test('materializes topo-store records at load time', async () => {
    await writeFreshArtifacts();
    seedTopoStore();

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });
    seedTopoStore(makeTopo({ accountListTrail }));

    expect(loaded.topoStore?.trails.map((entry) => entry.id)).toEqual([
      'user.show',
    ]);
  });

  test('marks artifacts stale when the manifest hash no longer matches topo.lock', async () => {
    const topoGraph = await writeFreshArtifacts();
    await writeLockManifest(
      makeLockManifest(topoGraph, {
        artifacts: [
          {
            path: 'topo.lock',
            role: 'topo',
            sha256: '0'.repeat(64),
          },
        ],
      }),
      { dir: artifactsDir() }
    );
    seedTopoStore();

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.freshness.status).toBe('stale');
    expect(
      loaded.freshness.status === 'stale'
        ? loaded.freshness.reasons.map((reason) => reason.reason)
        : []
    ).toContain('lock-manifest-hash-mismatch');
    expect(loaded.topoGraph).not.toBeNull();
    expect(loaded.topoStore).not.toBeNull();
  });

  test('marks artifacts stale when trails.db no longer matches topo.lock', async () => {
    await writeFreshArtifacts();
    seedTopoStore(makeTopo({ accountListTrail }));

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.freshness.status).toBe('stale');
    expect(
      loaded.freshness.status === 'stale'
        ? loaded.freshness.reasons.map((reason) => reason.reason)
        : []
    ).toContain('topo-store-hash-mismatch');
    expect(loaded.topoGraph?.entries.map((entry) => entry.id)).toEqual([
      'user.show',
    ]);
    expect(loaded.topoStore?.trails.map((entry) => entry.id)).toEqual([
      'account.list',
    ]);
  });

  test('marks missing artifacts without creating or mutating local state', async () => {
    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded).toEqual({
      freshness: {
        artifacts: ['topoGraph', 'lockManifest', 'topoStore'],
        status: 'missing',
      },
      lockManifest: null,
      topoGraph: null,
      topoStore: null,
    });
    expect(await readdir(tempDir)).toEqual([]);
  });

  test('marks topo-store missing when trails.db exists without topo state', async () => {
    await writeFreshArtifacts();
    const db = openWriteTrailsDb({ rootDir: tempDir });
    db.close();

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.freshness).toEqual({
      artifacts: ['topoStore'],
      status: 'missing',
    });
    expect(loaded.topoGraph).not.toBeNull();
    expect(loaded.lockManifest).not.toBeNull();
    expect(loaded.topoStore).toBeNull();
  });

  test('marks schema-version drift when topo.lock uses an unsupported schema version', async () => {
    await mkdir(artifactsDir(), { recursive: true });
    await Bun.write(
      join(artifactsDir(), 'topo.lock'),
      `${JSON.stringify({
        ...makeTopoGraph(),
        topoGraphSchemaVersion: TOPO_GRAPH_SCHEMA_VERSION - 1,
      })}\n`
    );
    await writeLockManifest(makeLockManifest(makeTopoGraph()), {
      dir: artifactsDir(),
    });

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.freshness).toMatchObject({
      artifact: 'topoGraph',
      status: 'schema-version-drift',
    });
    expect(loaded.topoGraph).toBeNull();
    expect(loaded.lockManifest?.version).toBe(3);
  });

  test('marks schema-version drift when trails.lock uses an unsupported schema version', async () => {
    const topoGraph = await writeFreshArtifacts();
    await Bun.write(
      join(artifactsDir(), 'trails.lock'),
      `${JSON.stringify({ ...makeLockManifest(topoGraph), version: 2 })}\n`
    );

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.freshness).toMatchObject({
      artifact: 'lockManifest',
      status: 'schema-version-drift',
    });
    expect(loaded.topoGraph).not.toBeNull();
    expect(loaded.lockManifest).toBeNull();
  });

  test('marks schema-version drift without migrating a stale topo store', async () => {
    await writeFreshArtifacts();
    const db = openWriteTrailsDb({ rootDir: tempDir });
    try {
      db.run(
        `INSERT INTO meta_schema_versions (subsystem, version, updated_at)
         VALUES (?, ?, ?)`,
        'topo',
        TOPO_STORE_SCHEMA_VERSION - 1,
        '2026-06-04T00:00:00.000Z'
      );
    } finally {
      db.close();
    }

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.freshness).toMatchObject({
      artifact: 'topoStore',
      status: 'schema-version-drift',
    });
    expect(loaded.topoStore).toBeNull();

    const readDb = openReadTrailsDb({ rootDir: tempDir });
    try {
      const row = readDb
        .query<{ version: number }, [string]>(
          'SELECT version FROM meta_schema_versions WHERE subsystem = ?'
        )
        .get('topo');
      expect(row?.version).toBe(TOPO_STORE_SCHEMA_VERSION - 1);
    } finally {
      readDb.close();
    }
  });
});

describe('wayfinderFact', () => {
  test('carries category, source, drift, freshness, and derivedFrom provenance', () => {
    const freshness = { status: 'fresh' } as const;
    const fact = wayfinderFact({
      category: 'projected',
      derivedFrom: { field: 'output', id: 'user.show', kind: 'trail' },
      freshness,
      source: wayfinderTopoStoreSource({ rootDir: tempDir }),
      value: { hasOutput: true },
    });

    expect(fact).toEqual({
      category: 'projected',
      derivedFrom: { field: 'output', id: 'user.show', kind: 'trail' },
      drift: { freshness, status: 'aligned' },
      freshness,
      source: {
        kind: 'topoStore',
        path: `${tempDir}/.trails/state/trails.db`,
        schemaVersion: TOPO_STORE_SCHEMA_VERSION,
      },
      value: { hasOutput: true },
    });
  });

  test('can point facts at topo.lock file provenance', () => {
    expect(wayfinderTopoGraphSource({ rootDir: tempDir })).toEqual({
      kind: 'topoGraph',
      path: `${tempDir}/.trails/topo.lock`,
      schemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
    });
  });
});
