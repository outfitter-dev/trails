import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import {
  Result,
  deriveTrailsDbPath,
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
  writeTrailsLock,
} from '@ontrails/topographer';
import type {
  LockManifest,
  TopoGraph,
  TrailsLock,
} from '@ontrails/topographer';

import {
  loadWayfinderArtifacts,
  wayfinderFact,
  wayfinderTopoGraphSource,
  wayfinderTopoStoreSource,
} from '../index.js';

let tempDir: string;
let originalTrailsStateHome: string | undefined;

const restoreTrailsStateHome = (value: string | undefined): void => {
  if (value === undefined) {
    delete process.env.TRAILS_STATE_HOME;
    return;
  }
  process.env.TRAILS_STATE_HOME = value;
};

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
  await writeTrailsLock(
    {
      scope: { app: 'demo' },
      summary: makeLockManifest(topoGraph).summary,
      topoGraph,
      topoGraphHash: deriveTopoGraphHash(topoGraph),
      version: 4,
    } as TrailsLock,
    { dir: tempDir }
  );
  return topoGraph;
};

const writeLegacyFreshArtifacts = async (
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
  originalTrailsStateHome = process.env.TRAILS_STATE_HOME;
  process.env.TRAILS_STATE_HOME = join(tempDir, '.test-state');
});

afterEach(async () => {
  restoreTrailsStateHome(originalTrailsStateHome);
  await rm(tempDir, { force: true, recursive: true });
});

describe('loadWayfinderArtifacts', () => {
  test('loads fresh topo graph, lock manifest, and topo-store artifacts', async () => {
    await writeFreshArtifacts();
    const snapshot = seedTopoStore();

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.artifactStatus).toEqual({ status: 'fresh' });
    expect(loaded.freshness).toBe(loaded.artifactStatus);
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

  test('does not infer topo-store state from an artifact directory alone', async () => {
    await writeLegacyFreshArtifacts();
    const legacyDbPath = join(artifactsDir(), 'state', 'trails.db');
    const legacySnapshot = createTopoSnapshot(makeTopo({ accountListTrail }), {
      createdAt: '2026-06-04T00:00:00.000Z',
      gitSha: 'abc123',
      path: legacyDbPath,
      rootDir: tempDir,
    });
    if (legacySnapshot.isErr()) {
      throw legacySnapshot.error;
    }

    const loaded = await loadWayfinderArtifacts({ dir: artifactsDir() });

    expect(loaded.topoGraph?.entries.map((entry) => entry.id)).toEqual([
      'user.show',
    ]);
    expect(loaded.lockManifest?.version).toBe(3);
    expect(loaded.topoStore).toBeNull();
    expect(loaded.artifactStatus).toEqual({
      artifacts: ['topoStore'],
      status: 'missing',
    });
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

  test('marks artifacts stale when trails.lock hash no longer matches embedded graph', async () => {
    const topoGraph = makeTopoGraph();
    await writeTrailsLock(
      {
        scope: { app: 'demo' },
        summary: makeLockManifest(topoGraph).summary,
        topoGraph,
        topoGraphHash: '0'.repeat(64),
        version: 4,
      } as TrailsLock,
      { dir: tempDir }
    );
    seedTopoStore();

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.artifactStatus.status).toBe('stale');
    expect(
      loaded.artifactStatus.status === 'stale'
        ? loaded.artifactStatus.reasons.map((reason) => reason.reason)
        : []
    ).toContain('lock-manifest-hash-mismatch');
    expect(loaded.topoGraph).not.toBeNull();
    expect(loaded.topoStore).not.toBeNull();
  });

  test('marks artifacts stale when trails.db no longer matches trails.lock', async () => {
    await writeFreshArtifacts();
    seedTopoStore(makeTopo({ accountListTrail }));

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.artifactStatus.status).toBe('stale');
    expect(
      loaded.artifactStatus.status === 'stale'
        ? loaded.artifactStatus.reasons.map((reason) => reason.reason)
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
      artifactStatus: {
        artifacts: ['topoGraph', 'lockManifest', 'topoStore'],
        status: 'missing',
      },
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

    expect(loaded.artifactStatus).toEqual({
      artifacts: ['topoStore'],
      status: 'missing',
    });
    expect(loaded.topoGraph).not.toBeNull();
    expect(loaded.lockManifest).not.toBeNull();
    expect(loaded.topoStore).toBeNull();
  });

  test('marks schema-version drift when trails.lock embeds an unsupported topo graph version', async () => {
    await Bun.write(
      join(tempDir, 'trails.lock'),
      `${JSON.stringify({
        scope: { app: 'demo' },
        summary: makeLockManifest(makeTopoGraph()).summary,
        topoGraph: {
          ...makeTopoGraph(),
          topoGraphSchemaVersion: TOPO_GRAPH_SCHEMA_VERSION - 1,
        },
        topoGraphHash: deriveTopoGraphHash(makeTopoGraph()),
        version: 4,
      })}\n`
    );

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.artifactStatus).toMatchObject({
      artifact: 'topoGraph',
      status: 'schema-version-drift',
    });
    expect(loaded.topoGraph).toBeNull();
    expect(loaded.lockManifest).toBeNull();
  });

  test('marks schema-version drift when trails.lock uses an unsupported schema version', async () => {
    const topoGraph = makeTopoGraph();
    await Bun.write(
      join(tempDir, 'trails.lock'),
      `${JSON.stringify({
        scope: { app: 'demo' },
        summary: makeLockManifest(topoGraph).summary,
        topoGraph,
        topoGraphHash: deriveTopoGraphHash(topoGraph),
        version: 2,
      })}\n`
    );

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.artifactStatus).toMatchObject({
      artifact: 'topoGraph',
      status: 'schema-version-drift',
    });
    expect(loaded.topoGraph).toBeNull();
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

    expect(loaded.artifactStatus).toMatchObject({
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
  test('carries category, source, drift, artifact status, and derivedFrom provenance', () => {
    const artifactStatus = { status: 'fresh' } as const;
    const fact = wayfinderFact({
      artifactStatus,
      category: 'derived',
      derivedFrom: { field: 'output', id: 'user.show', kind: 'trail' },
      source: wayfinderTopoStoreSource({ rootDir: tempDir }),
      value: { hasOutput: true },
    });

    expect(fact).toEqual({
      artifactStatus,
      category: 'derived',
      derivedFrom: { field: 'output', id: 'user.show', kind: 'trail' },
      drift: { status: 'aligned' },
      source: {
        kind: 'topoStore',
        path: deriveTrailsDbPath({ rootDir: tempDir }),
        schemaVersion: TOPO_STORE_SCHEMA_VERSION,
      },
      value: { hasOutput: true },
    });
  });

  test('can point facts at trails.lock file provenance', () => {
    expect(wayfinderTopoGraphSource({ rootDir: tempDir })).toEqual({
      kind: 'topoGraph',
      path: `${tempDir}/trails.lock`,
      schemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
    });
  });
});
