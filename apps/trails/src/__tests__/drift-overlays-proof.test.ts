import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { checkDrift } from '@ontrails/warden';

import { compileTrail } from '../trails/compile.js';
import { loadFreshAppLease } from '../trails/load-app.js';

const fixtureParent = resolve(import.meta.dir, '../..', '.tmp-tests');

let fixtureDir: string | undefined;
let testStateHome: string | undefined;
let originalTrailsStateHome: string | undefined;

beforeEach(() => {
  originalTrailsStateHome = process.env['TRAILS_STATE_HOME'];
  testStateHome = mkdtempSync(join(tmpdir(), 'drift-overlays-state-'));
  process.env['TRAILS_STATE_HOME'] = testStateHome;
});

afterEach(() => {
  if (originalTrailsStateHome === undefined) {
    delete process.env['TRAILS_STATE_HOME'];
  } else {
    process.env['TRAILS_STATE_HOME'] = originalTrailsStateHome;
  }
  if (testStateHome) {
    rmSync(testStateHome, { force: true, recursive: true });
    testStateHome = undefined;
  }
  if (fixtureDir) {
    rmSync(fixtureDir, { force: true, recursive: true });
    fixtureDir = undefined;
  }
});

/**
 * Write the fixture app module. `bindingName` is the app-authored CLI
 * binding in the `surfaces` overlay; rewriting it simulates genuine
 * per-namespace overlay drift without touching the base trail graph.
 */
const writeFixtureApp = (dir: string, bindingName: string): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, surfaceOverlay, topo, trail } from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import { z } from 'zod';

const readFlag = trail('flags.read', {
  blaze: async () => Result.ok({ value: null }),
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ value: z.string().nullable() }),
});

export const app = topo('drift-overlays-fixture', { readFlag });

const factsOverlay = {
  derive: (current: Topo) => ({ trailCount: current.trails.size }),
  namespace: 'acme',
  schema: z.object({ trailCount: z.number() }).strict(),
};

export const trailsOverlays = [
  surfaceOverlay({ cli: { ${bindingName}: 'flags.read' } }),
  factsOverlay,
];
`
  );
};

const compileFixture = async (dir: string): Promise<void> => {
  const compiled = await compileTrail.blaze({ module: './src/app.ts' }, {
    cwd: dir,
  } as never);
  if (compiled.isErr()) {
    throw compiled.error;
  }
};

const newFixtureDir = (): string => {
  fixtureDir = join(
    fixtureParent,
    `drift-overlays-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  return fixtureDir;
};

describe('drift overlays proof (TRL-1209 drift symmetry)', () => {
  test('the TRL-1179 sequence is green, and genuine overlay drift names the namespace', async () => {
    const dir = newFixtureDir();
    writeFixtureApp(dir, 'ls');

    // (a) compile embeds the app-module overlays into trails.lock.
    await compileFixture(dir);

    // (b) the exact TRL-1179 failure sequence: fresh lease + checkDrift with
    // the lease's overlays. Both the compile lease and this drift check read
    // the app-module export through the shared adapter-kit
    // resolveTrailsOverlays channel, so the fresh graph carries the same
    // overlays the lock embeds and drift stays clean.
    const lease = await loadFreshAppLease('./src/app.ts', dir);
    try {
      expect(lease.overlays).toHaveLength(2);
      const fresh = await checkDrift(dir, lease.app, {
        overlays: lease.overlays,
      });
      expect(fresh.blockedReason).toBeUndefined();
      expect(fresh.stale).toBe(false);
      expect(fresh.driftedOverlayNamespaces).toBeUndefined();
    } finally {
      lease.release();
    }

    // (c) genuine drift: rewrite the app-authored binding without
    // recompiling, reload a fresh lease, and check drift again.
    writeFixtureApp(dir, 'show');
    const driftedLease = await loadFreshAppLease('./src/app.ts', dir);
    try {
      const drifted = await checkDrift(dir, driftedLease.app, {
        overlays: driftedLease.overlays,
      });
      expect(drifted.stale).toBe(true);
      // Only the app-authored `surfaces` namespace changed; the adapter
      // `acme` facts are byte-identical, so the diagnostic names exactly
      // the drifted namespace.
      expect(drifted.driftedOverlayNamespaces).toEqual(['surfaces']);
    } finally {
      driftedLease.release();
    }
  }, 120_000);
});
