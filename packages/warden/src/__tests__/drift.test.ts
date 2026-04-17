import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createTopoStore, trail, topo, Result } from '@ontrails/core';
import { createTopoSnapshot } from '@ontrails/core/internal/topo-store';
import {
  openWriteTrailsDb,
  deriveTrailsDir,
} from '@ontrails/core/internal/trails-db';
import {
  deriveSurfaceMapHash,
  deriveSurfaceMap,
  writeSurfaceLock,
} from '@ontrails/schema';
import { z } from 'zod';

import { checkDrift } from '../drift.js';

const makeTopo = () => {
  const t = trail('test.hello', {
    blaze: () => Result.ok({ greeting: 'hi' }),
    input: z.object({ name: z.string() }),
    output: z.object({ greeting: z.string() }),
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

const seedSavedTopo = (dir: string): string | undefined => {
  const db = openWriteTrailsDb({ rootDir: dir });
  try {
    const result = createTopoSnapshot(db, makeTopo(), {
      createdAt: '2026-04-03T15:00:00.000Z',
    });
    if (result.isErr()) {
      throw result.error;
    }
  } finally {
    db.close();
  }

  return createTopoStore({ rootDir: dir }).exports.get()?.surfaceHash;
};

describe('checkDrift', () => {
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
      const hash = deriveSurfaceMapHash(deriveSurfaceMap(tp));
      await writeSurfaceLock(
        { hash, version: 1 },
        { dir: committedLockDir(dir) }
      );

      const result = await checkDrift(dir, tp);
      expect(result.stale).toBe(false);
      expect(result.committedHash).toBe(hash);
      expect(result.currentHash).toBe(hash);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('returns stale: true when lock does not match', async () => {
    const dir = createTempDir();
    try {
      writeFileSync(
        join(committedLockDir(dir), 'trails.lock'),
        'outdated-hash\n'
      );

      const result = await checkDrift(dir, makeTopo());
      expect(result.stale).toBe(true);
      expect(result.committedHash).toBe('outdated-hash');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('blocks drift calculation when draft state remains in the topo', async () => {
    const dir = createTempDir();
    try {
      const draftTrail = trail('test.hello', {
        blaze: () => Result.ok({ greeting: 'hi' }),
        crosses: ['_draft.test.prepare'],
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
