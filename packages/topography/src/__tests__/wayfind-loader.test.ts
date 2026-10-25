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
  LOCK_MANIFEST_SCHEMA_VERSION,
  TOPO_GRAPH_SCHEMA_VERSION,
  TOPO_STORE_SCHEMA_VERSION,
  createTopoSnapshot,
  deriveTopoGraph,
  deriveTopoGraphHash,
  loadWayfinderArtifacts,
  wayfinderFact,
  wayfinderTopoGraphSource,
  wayfinderTopoStoreSource,
  writeLockManifest,
  writeTopoGraph,
  writeTrailsLock,
} from '../index.js';
import type { LockManifest, TopoGraph, TrailsLock } from '../types.js';

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
  examples: [{ expected: { ok: true }, input: {}, name: 'Basic' }],
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});

const accountListTrail = trail('account.list', {
  examples: [{ expected: { accounts: [] }, input: {}, name: 'Basic' }],
  implementation: () => Result.ok({ accounts: [] }),
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
    entities: countEntries(topoGraph, 'entity'),
    resources: countEntries(topoGraph, 'resource'),
    signals: countEntries(topoGraph, 'signal'),
    trails: countEntries(topoGraph, 'trail'),
  },
  version: LOCK_MANIFEST_SCHEMA_VERSION,
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
      version: 5,
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
    expect(loaded.lockManifest?.version).toBe(LOCK_MANIFEST_SCHEMA_VERSION);
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
    expect(loaded.lockManifest?.version).toBe(LOCK_MANIFEST_SCHEMA_VERSION);
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
        version: 5,
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
        version: 5,
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

  test('preserves lock facts when a same-version topo store carries retired exports', async () => {
    const topoGraph = await writeFreshArtifacts();
    const snapshot = seedTopoStore();
    const db = openWriteTrailsDb({ rootDir: tempDir });
    try {
      const row = db
        .query<{ topo_graph: string }, [string]>(
          'SELECT topo_graph FROM topo_exports WHERE snapshot_id = ?'
        )
        .get(snapshot.id);
      const stored = JSON.parse(row?.topo_graph ?? '{}') as {
        entries?: unknown[];
      };
      stored.entries = [{ contours: [], kind: 'contour' }];
      db.run(
        'UPDATE topo_exports SET topo_graph = ? WHERE snapshot_id = ?',
        JSON.stringify(stored),
        snapshot.id
      );
    } finally {
      db.close();
    }

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.artifactStatus).toMatchObject({
      artifact: 'topoStore',
      status: 'schema-version-drift',
    });
    expect(loaded.artifactStatus).toHaveProperty(
      'message',
      expect.stringContaining('retired "contour" vocabulary')
    );
    expect(loaded.topoGraph).toEqual(topoGraph);
    expect(loaded.lockManifest).not.toBeNull();
    expect(loaded.topoStore).toBeNull();
  });
});

describe.each(['root', 'legacy'] as const)('lock integrity (%s)', (format) => {
  const writeArtifacts = async (contradiction?: 'hash' | 'summary') => {
    const topoGraph = makeTopoGraph();
    const manifest = makeLockManifest(
      topoGraph,
      contradiction === 'summary'
        ? { summary: { entities: 0, resources: 0, signals: 0, trails: 99 } }
        : {}
    );
    const hash =
      contradiction === 'hash'
        ? '0'.repeat(64)
        : deriveTopoGraphHash(topoGraph);
    if (format === 'root') {
      await writeTrailsLock(
        {
          scope: manifest.scope,
          summary: manifest.summary,
          topoGraph,
          topoGraphHash: hash,
          version: 5,
        } as TrailsLock,
        { dir: tempDir }
      );
    } else {
      await writeTopoGraph(topoGraph, { dir: artifactsDir() });
      await writeLockManifest(
        {
          ...manifest,
          artifacts: [{ path: 'topo.lock', role: 'topo', sha256: hash }],
        },
        { dir: artifactsDir() }
      );
    }
  };

  describe.each(['hash', 'summary'] as const)('%s contradiction', (kind) => {
    test.each([
      'unselected',
      'absent',
      'empty',
      'unreadable',
      'schema-drift',
      'readable',
    ] as const)('reports drift with a %s store', async (storeState) => {
      await writeArtifacts(kind);
      if (storeState === 'unreadable') {
        await Bun.write(deriveTrailsDbPath({ rootDir: tempDir }), 'not sqlite');
      } else if (storeState === 'readable') {
        seedTopoStore();
      } else if (storeState === 'empty' || storeState === 'schema-drift') {
        const db = openWriteTrailsDb({ rootDir: tempDir });
        try {
          if (storeState === 'schema-drift') {
            db.run(
              'INSERT INTO meta_schema_versions (subsystem, version, updated_at) VALUES (?, ?, ?)',
              'topo',
              TOPO_STORE_SCHEMA_VERSION - 1,
              '2026-06-04T00:00:00.000Z'
            );
          }
        } finally {
          db.close();
        }
      }

      const dir = format === 'root' ? tempDir : artifactsDir();
      const loaded = await loadWayfinderArtifacts(
        storeState === 'unselected' ? { dir } : { dir, rootDir: tempDir }
      );
      const reason = `lock-manifest-${kind}-mismatch`;

      expect(loaded.artifactStatus).toMatchObject({
        reasons: [{ reason }],
        status: 'stale',
      });
      expect(loaded.freshness).toBe(loaded.artifactStatus);
      expect(loaded.topoGraph).not.toBeNull();
      expect(loaded.lockManifest).not.toBeNull();
      expect(loaded.topoStore === null).toBe(storeState !== 'readable');
      const fact = wayfinderFact({
        artifactStatus: loaded.artifactStatus,
        category: 'derived',
        derivedFrom: null,
        source: wayfinderTopoGraphSource({ dir }),
        value: loaded.topoGraph,
      });
      expect(fact.drift).toMatchObject({
        reasons: [{ reason }],
        status: 'drifted',
      });
    });
  });

  test.each(['missing-export', 'hash-mismatch'] as const)(
    'keeps readable-store %s before summary drift',
    async (storeState) => {
      await writeArtifacts('summary');
      seedTopoStore(
        storeState === 'hash-mismatch'
          ? makeTopo({ accountListTrail })
          : makeTopo()
      );
      if (storeState === 'missing-export') {
        const db = openWriteTrailsDb({ rootDir: tempDir });
        try {
          db.run('DELETE FROM topo_exports');
        } finally {
          db.close();
        }
      }

      const loaded = await loadWayfinderArtifacts({
        dir: format === 'root' ? tempDir : artifactsDir(),
        rootDir: tempDir,
      });

      expect(loaded.artifactStatus.status).toBe('stale');
      if (loaded.artifactStatus.status !== 'stale') {
        throw new Error('Expected combined store and summary drift');
      }
      expect(loaded.artifactStatus.reasons.map(({ reason }) => reason)).toEqual(
        [
          storeState === 'missing-export'
            ? 'topo-store-export-missing'
            : 'topo-store-hash-mismatch',
          'lock-manifest-summary-mismatch',
        ]
      );
      expect(loaded.topoStore).not.toBeNull();
      expect(loaded.freshness).toBe(loaded.artifactStatus);
    }
  );

  test('keeps missing-store provenance absent for a consistent lock', async () => {
    await writeArtifacts();
    const dir = format === 'root' ? tempDir : artifactsDir();
    const loaded = await loadWayfinderArtifacts({ dir, rootDir: tempDir });

    expect(loaded.artifactStatus).toEqual({
      artifacts: ['topoStore'],
      status: 'missing',
    });
    expect(
      wayfinderFact({
        artifactStatus: loaded.artifactStatus,
        category: 'derived',
        derivedFrom: null,
        source: wayfinderTopoGraphSource({ dir }),
        value: loaded.topoGraph,
      }).drift
    ).toEqual({ artifacts: ['topoStore'], status: 'absent' });
  });
});

describe('lock integrity precedence', () => {
  test('reports a missing legacy topo artifact record without a store', async () => {
    const topoGraph = await writeLegacyFreshArtifacts();
    await writeLockManifest(
      makeLockManifest(topoGraph, {
        artifacts: [
          { path: 'other.lock', role: 'topo', sha256: '0'.repeat(64) },
        ],
      }),
      { dir: artifactsDir() }
    );

    const loaded = await loadWayfinderArtifacts({ dir: artifactsDir() });

    expect(loaded.artifactStatus).toEqual({
      reasons: [{ reason: 'lock-manifest-topo-artifact-missing' }],
      status: 'stale',
    });
    expect(loaded.topoStore).toBeNull();
  });

  test('keeps a legacy graph without a manifest honestly missing', async () => {
    await writeTopoGraph(makeTopoGraph(), { dir: artifactsDir() });

    const loaded = await loadWayfinderArtifacts({ dir: artifactsDir() });

    expect(loaded.artifactStatus).toEqual({
      artifacts: ['lockManifest', 'topoStore'],
      status: 'missing',
    });
    expect(loaded.topoGraph).not.toBeNull();
  });

  test('preserves regeneration status for a manifest without its legacy graph', async () => {
    await writeLockManifest(
      makeLockManifest(makeTopoGraph(), {
        artifacts: [
          { path: 'topo.lock', role: 'topo', sha256: '0'.repeat(64) },
        ],
      }),
      { dir: artifactsDir() }
    );

    const loaded = await loadWayfinderArtifacts({ dir: artifactsDir() });

    expect(loaded.artifactStatus).toMatchObject({
      artifact: 'topoGraph',
      status: 'schema-version-drift',
    });
    expect(loaded.lockManifest).not.toBeNull();
  });

  test('keeps store-only reasons alongside readable lock contradictions', async () => {
    const topoGraph = await writeLegacyFreshArtifacts();
    seedTopoStore();
    await writeLockManifest(
      makeLockManifest(topoGraph, {
        artifacts: [
          { path: 'topo.lock', role: 'topo', sha256: '0'.repeat(64) },
        ],
      }),
      { dir: artifactsDir() }
    );
    const db = openWriteTrailsDb({ rootDir: tempDir });
    try {
      db.run('DELETE FROM topo_exports');
    } finally {
      db.close();
    }

    const loaded = await loadWayfinderArtifacts({
      dir: artifactsDir(),
      rootDir: tempDir,
    });

    expect(loaded.artifactStatus).toMatchObject({
      reasons: [
        { reason: 'lock-manifest-hash-mismatch' },
        { reason: 'topo-store-export-missing' },
      ],
      status: 'stale',
    });
    expect(loaded.topoStore).not.toBeNull();
  });

  test.each(['root', 'legacy'] as const)(
    'preserves %s graph schema drift before envelope contradictions',
    async (format) => {
      const topoGraph = makeTopoGraph({ topoGraphSchemaVersion: 0 });
      const dir = format === 'root' ? tempDir : artifactsDir();
      if (format === 'root') {
        await Bun.write(
          join(dir, 'trails.lock'),
          JSON.stringify({
            scope: { app: 'demo' },
            summary: makeLockManifest(topoGraph).summary,
            topoGraph,
            topoGraphHash: '0'.repeat(64),
            version: 5,
          })
        );
      } else {
        await writeTopoGraph(topoGraph, { dir });
        await writeLockManifest(
          makeLockManifest(topoGraph, {
            artifacts: [
              { path: 'other.lock', role: 'topo', sha256: '0'.repeat(64) },
            ],
          }),
          { dir }
        );
      }

      const loaded = await loadWayfinderArtifacts({ dir });

      expect(loaded.artifactStatus).toMatchObject({
        artifact: 'topoGraph',
        status: 'schema-version-drift',
      });
      expect(loaded.topoGraph).toBeNull();
    }
  );

  test('does not turn a malformed lock into missing-store provenance', async () => {
    await Bun.write(join(tempDir, 'trails.lock'), '{');

    const loaded = await loadWayfinderArtifacts({ dir: tempDir });

    expect(loaded.artifactStatus).toMatchObject({
      artifact: 'topoGraph',
      message: expect.stringContaining('regenerate'),
      status: 'schema-version-drift',
    });
  });

  test('keeps an unreadable store schema-drifted for a consistent lock', async () => {
    await writeFreshArtifacts();
    await Bun.write(deriveTrailsDbPath({ rootDir: tempDir }), 'not sqlite');

    const loaded = await loadWayfinderArtifacts({ rootDir: tempDir });

    expect(loaded.artifactStatus).toMatchObject({
      artifact: 'topoStore',
      status: 'schema-version-drift',
    });
    expect(loaded.topoGraph).not.toBeNull();
    expect(loaded.topoStore).toBeNull();
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
