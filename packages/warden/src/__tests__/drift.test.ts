import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  deriveTrailsDir,
  openWriteTrailsDb,
  trail,
  topo,
  Result,
} from '@ontrails/core';
import {
  annotateTopoGraphForces,
  carryForwardTopoGraphForces,
  createTopoStore,
  deriveTopoGraphHash,
  deriveTopoGraph,
  LOCK_MANIFEST_SCHEMA_VERSION,
  readTopoGraph,
  TRAILS_LOCK_SCHEMA_VERSION,
  writeLockManifest,
  writeTopoGraph,
  writeTrailsLock,
} from '@ontrails/topography';
import type { TopoGraph } from '@ontrails/topography';
import { createStoredTopoSnapshot } from '@ontrails/topography/backend-support';
import { z } from 'zod';

import { checkDrift, staleDriftMessage } from '../drift.js';
import { pendingForce } from '../rules/trail-versioning-topo.js';

const makeTopo = () => {
  const t = trail('test.hello', {
    implementation: () => Result.ok({ greeting: 'hi' }),
    input: z.object({ name: z.string() }),
    output: z.object({ greeting: z.string() }),
  });
  return topo('test-app', { t });
};

const makeChangedTopo = () => {
  const t = trail('test.hello', {
    implementation: () => Result.ok({ greeting: 'hi', punctuation: '!' }),
    input: z.object({ name: z.string() }),
    output: z.object({ greeting: z.string(), punctuation: z.string() }),
  });
  return topo('test-app', { t });
};

const createTempDir = (): string => {
  const dir = join(tmpdir(), `drift-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const committedLockDir = (dir: string): string => {
  const trailsDir = deriveTrailsDir({ rootDir: dir });
  mkdirSync(trailsDir, { recursive: true });
  return trailsDir;
};

const writeManifest = async (dir: string, hash: string): Promise<string> => {
  await writeTopoGraph(deriveTopoGraph(makeTopo()), {
    dir: committedLockDir(dir),
  });
  return writeLockManifest(
    {
      artifacts: [{ path: 'topo.lock', role: 'topo', sha256: hash }],
      scope: { app: 'test-app' },
      summary: { entities: 0, resources: 0, signals: 0, trails: 1 },
      version: LOCK_MANIFEST_SCHEMA_VERSION,
    },
    { dir: committedLockDir(dir) }
  );
};

const writeGraph = async (
  dir: string,
  graph: TopoGraph,
  layout: 'root' | 'legacy'
): Promise<string> => {
  const hash = deriveTopoGraphHash(graph);
  const summary = { entities: 0, resources: 0, signals: 0, trails: 1 };
  if (layout === 'root') {
    return writeTrailsLock(
      {
        scope: { app: 'test-app' },
        summary,
        topoGraph: graph,
        topoGraphHash: hash,
        version: TRAILS_LOCK_SCHEMA_VERSION,
      },
      { dir }
    );
  }
  const legacyDir = committedLockDir(dir);
  await writeTopoGraph(graph, { dir: legacyDir });
  return writeLockManifest(
    {
      artifacts: [{ path: 'topo.lock', role: 'topo', sha256: hash }],
      scope: { app: 'test-app' },
      summary,
      version: LOCK_MANIFEST_SCHEMA_VERSION,
    },
    { dir: legacyDir }
  );
};

const forceCases = [
  {
    change: 'removed',
    details: ['Trail "test.removed" removed'],
    id: 'test.removed',
    kind: 'trail',
    severity: 'breaking',
  },
  {
    change: 'modified',
    details: ['Permit requirement tightened'],
    id: 'test.hello',
    kind: 'trail',
    severity: 'breaking',
  },
] as const;

const seedSavedTopo = (dir: string): string => {
  const db = openWriteTrailsDb({ rootDir: dir });
  try {
    const result = createStoredTopoSnapshot(db, makeTopo(), {
      createdAt: '2026-04-03T15:00:00.000Z',
    });
    if (result.isErr()) {
      throw result.error;
    }
  } finally {
    db.close();
  }

  const hash = createTopoStore({ rootDir: dir }).exports.get()?.topoGraphHash;
  if (hash === undefined) {
    throw new Error('seedSavedTopo expected a stored topo graph hash');
  }
  return hash;
};

describe('checkDrift', () => {
  let testStateHome: string | undefined;
  let originalTrailsStateHome: string | undefined;

  beforeEach(() => {
    originalTrailsStateHome = process.env.TRAILS_STATE_HOME;
    testStateHome = join(tmpdir(), `drift-state-${Date.now()}`);
    mkdirSync(testStateHome, { recursive: true });
    process.env.TRAILS_STATE_HOME = testStateHome;
  });

  afterEach(() => {
    if (originalTrailsStateHome === undefined) {
      delete process.env.TRAILS_STATE_HOME;
    } else {
      process.env.TRAILS_STATE_HOME = originalTrailsStateHome;
    }
    if (testStateHome) {
      rmSync(testStateHome, { force: true, recursive: true });
      testStateHome = undefined;
    }
  });

  test('returns stale: false when no topo is provided', async () => {
    const result = await checkDrift('/tmp');
    expect(result.stale).toBe(false);
    expect(result.currentHash).toBe('unknown');
  });

  test('returns stale: false when no lock file exists', async () => {
    const dir = createTempDir();
    try {
      const result = await checkDrift(dir, makeTopo());
      expect(result.stale).toBe(false);
      expect(result.committedHash).toBeNull();
      expect(result.currentHash.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('uses the latest saved topo hash when no live topo is provided', async () => {
    const dir = createTempDir();
    try {
      const expectedHash = seedSavedTopo(dir);
      const result = await checkDrift(dir);

      expect(result.stale).toBe(false);
      expect(result.currentHash).toBe(expectedHash);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('returns stale: false when lock matches current hash', async () => {
    const dir = createTempDir();
    try {
      const tp = makeTopo();
      const hash = deriveTopoGraphHash(deriveTopoGraph(tp));
      await writeManifest(dir, hash);

      const result = await checkDrift(dir, tp);
      expect(result.stale).toBe(false);
      expect(result.committedHash).toBe(hash);
      expect(result.currentHash).toBe(hash);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  for (const layout of ['root', 'legacy'] as const) {
    for (const force of forceCases) {
      test(`${layout}: ${force.change} force audit is not contract drift`, async () => {
        const dir = createTempDir();
        try {
          const tp = makeTopo();
          const contract = deriveTopoGraph(tp);
          await writeGraph(dir, contract, layout);
          expect(await checkDrift(dir, tp)).toMatchObject({ stale: false });

          const forced = annotateTopoGraphForces(contract, [force]);
          const carried = carryForwardTopoGraphForces(forced, contract);
          const lockPath = await writeGraph(dir, carried, layout);
          const before = readFileSync(lockPath, 'utf8');
          const result = await checkDrift(dir, tp);

          expect(result).toMatchObject({
            committedHash: deriveTopoGraphHash(contract),
            currentHash: deriveTopoGraphHash(contract),
            stale: false,
          });
          expect(readFileSync(lockPath, 'utf8')).toBe(before);
          const saved = await readTopoGraph({
            dir: layout === 'root' ? dir : committedLockDir(dir),
          });
          expect(saved).toEqual(carried);
          expect(await pendingForce.checkTopo(tp, { graph: carried })).toEqual([
            expect.objectContaining({
              rule: 'pending-force',
              severity: 'warn',
            }),
          ]);
          expect(await checkDrift(dir, makeChangedTopo())).toMatchObject({
            stale: true,
          });
        } finally {
          rmSync(dir, { force: true, recursive: true });
        }
      });
    }

    test(`${layout}: force history does not hide overlay drift`, async () => {
      const dir = createTempDir();
      try {
        const tp = makeTopo();
        const overlay = {
          derive: () => ({ region: 'west' }),
          namespace: 'deployment',
          schema: z.object({ region: z.string() }),
          version: 1,
        };
        const overlays = [overlay];
        const graph = annotateTopoGraphForces(
          deriveTopoGraph(tp, { overlays }),
          forceCases
        );
        await writeGraph(dir, graph, layout);
        expect(await checkDrift(dir, tp, { overlays })).toMatchObject({
          stale: false,
        });
        const changedOverlays = [
          {
            ...overlay,
            derive: () => ({ region: 'east' }),
          },
        ];
        expect(
          await checkDrift(dir, tp, { overlays: changedOverlays })
        ).toMatchObject({
          driftedOverlayNamespaces: ['deployment'],
          stale: true,
        });
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    });

    test(`${layout}: rejects audit tampering even when the contract is unchanged`, async () => {
      const dir = createTempDir();
      try {
        const graph = annotateTopoGraphForces(deriveTopoGraph(makeTopo()), [
          forceCases[0],
        ]);
        const lockPath = await writeGraph(dir, graph, layout);
        const graphPath =
          layout === 'root'
            ? lockPath
            : join(committedLockDir(dir), 'topo.lock');
        writeFileSync(
          graphPath,
          readFileSync(graphPath, 'utf8').replace(
            'test.removed',
            'test.tampered'
          )
        );

        expect(await checkDrift(dir, makeTopo())).toMatchObject({
          blockedReason: expect.stringContaining('hash'),
          currentHash: 'blocked',
          stale: true,
        });
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    });
  }

  test('blocks when a legacy manifest has no graph artifact', async () => {
    const dir = createTempDir();
    try {
      await writeManifest(
        dir,
        deriveTopoGraphHash(deriveTopoGraph(makeTopo()))
      );
      rmSync(join(committedLockDir(dir), 'topo.lock'));
      expect(await checkDrift(dir, makeTopo())).toMatchObject({
        blockedReason: expect.stringContaining('topo.lock'),
        currentHash: 'blocked',
        stale: true,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('uses the live topo hash even when a saved topo export exists', async () => {
    const dir = createTempDir();
    try {
      const savedHash = seedSavedTopo(dir);
      if (savedHash === undefined) {
        throw new Error('expected saved hash');
      }
      await writeManifest(dir, savedHash);

      const result = await checkDrift(dir, makeChangedTopo());

      expect(result.stale).toBe(true);
      expect(result.committedHash).toBe(savedHash);
      expect(result.currentHash).not.toBe(savedHash);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('blocks when the recorded artifact hash does not match the graph', async () => {
    const dir = createTempDir();
    try {
      const outdatedHash = '0'.repeat(64);
      await writeManifest(dir, outdatedHash);

      const result = await checkDrift(dir, makeTopo());
      expect(result.stale).toBe(true);
      expect(result.blockedReason).toContain('hash');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('blocks drift calculation for malformed legacy lock manifests', async () => {
    const dir = createTempDir();
    try {
      writeFileSync(
        join(committedLockDir(dir), 'trails.lock'),
        `${JSON.stringify({ hash: '1'.repeat(64), version: 2 }, null, 2)}\n`
      );

      const result = await checkDrift(dir, makeTopo());
      expect(result.stale).toBe(true);
      expect(result.blockedReason).toContain(
        'regenerate with `trails compile`'
      );
      expect(result.currentHash).toBe('blocked');
      expect(result.committedHash).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('blocks drift calculation when the manifest lacks the topo.lock artifact', async () => {
    const dir = createTempDir();
    try {
      await writeLockManifest(
        {
          artifacts: [
            {
              path: 'other.lock',
              role: 'topo',
              sha256: 'f'.repeat(64),
            },
          ],
          scope: { app: 'test-app' },
          summary: { entities: 0, resources: 0, signals: 0, trails: 1 },
          version: LOCK_MANIFEST_SCHEMA_VERSION,
        },
        { dir: committedLockDir(dir) }
      );

      const result = await checkDrift(dir, makeTopo());
      expect(result.stale).toBe(true);
      expect(result.blockedReason).toContain('topo.lock artifact');
      expect(result.currentHash).toBe('blocked');
      expect(result.committedHash).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('blocks drift calculation when draft state remains in the topo', async () => {
    const dir = createTempDir();
    try {
      const draftTrail = trail('test.hello', {
        composes: ['_draft.test.prepare'],
        implementation: () => Result.ok({ greeting: 'hi' }),
        input: z.object({ name: z.string() }),
        output: z.object({ greeting: z.string() }),
      });

      const result = await checkDrift(dir, topo('test-app', { draftTrail }));

      expect(result.stale).toBe(true);
      expect(result.blockedReason).toContain('draft');
      expect(result.currentHash).toBe('blocked');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('staleDriftMessage', () => {
  test('names drifted overlay namespaces and the fixing command', () => {
    const message = staleDriftMessage({
      committedHash: 'aaa',
      currentHash: 'bbb',
      driftedOverlayNamespaces: ['acme', 'surfaces'],
      stale: true,
    });

    expect(message).toContain('drifted overlay namespaces: acme, surfaces');
    expect(message).toContain('`trails compile`');
  });

  test('stays byte-identical to the pre-namespace message when none are identified', () => {
    const message = staleDriftMessage({
      committedHash: 'aaa',
      currentHash: 'bbb',
      stale: true,
    });

    expect(message).toBe(
      'trails.lock is stale (regenerate with `trails compile`)'
    );
  });
});
