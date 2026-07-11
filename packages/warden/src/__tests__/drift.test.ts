import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  createTopoStore,
  deriveTopoGraphHash,
  deriveTopoGraph,
  writeLockManifest,
} from '@ontrails/topographer';
import { createStoredTopoSnapshot } from '@ontrails/topographer/backend-support';
import { z } from 'zod';

import { checkDrift, staleDriftMessage } from '../drift.js';

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

const writeManifest = (dir: string, hash: string): Promise<string> =>
  writeLockManifest(
    {
      artifacts: [{ path: 'topo.lock', role: 'topo', sha256: hash }],
      scope: { app: 'test-app' },
      summary: { contours: 0, resources: 0, signals: 0, trails: 1 },
      version: 3,
    },
    { dir: committedLockDir(dir) }
  );

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

  test('returns stale: true when lock does not match', async () => {
    const dir = createTempDir();
    try {
      const outdatedHash = '0'.repeat(64);
      await writeManifest(dir, outdatedHash);

      const result = await checkDrift(dir, makeTopo());
      expect(result.stale).toBe(true);
      expect(result.committedHash).toBe(outdatedHash);
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
          summary: { contours: 0, resources: 0, signals: 0, trails: 1 },
          version: 3,
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
