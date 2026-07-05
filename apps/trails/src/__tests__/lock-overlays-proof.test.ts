import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { runLockRoundtripSmoke } from '../release/lock-roundtrip-smoke.js';
import { compileTrail } from '../trails/compile.js';
import { validateTrail } from '../trails/validate.js';

const repoRoot = resolve(import.meta.dir, '../../../..');
const fixtureParent = resolve(import.meta.dir, '../..', '.tmp-tests');

let fixtureDir: string | undefined;
let testStateHome: string | undefined;
let originalTrailsStateHome: string | undefined;

beforeEach(() => {
  originalTrailsStateHome = process.env['TRAILS_STATE_HOME'];
  testStateHome = mkdtempSync(join(tmpdir(), 'lock-overlays-state-'));
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

const writeFixtureApp = (dir: string): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, topo, trail } from '@ontrails/core';
import { cloudflareKv } from '@ontrails/cloudflare/kv';
import { cloudflareOverlay } from '@ontrails/cloudflare';
import { z } from 'zod';

const flags = cloudflareKv('flags', { binding: 'FLAGS' });

const readFlag = trail('flags.read', {
  blaze: async () => Result.ok({ value: null }),
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ value: z.string().nullable() }),
  resources: [flags],
});

export const app = topo('lock-overlays-fixture', { flags, readFlag });
export const trailsOverlays = [cloudflareOverlay];
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
    `lock-overlays-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  return fixtureDir;
};

const readLockOverlays = (dir: string): unknown => {
  const lock = JSON.parse(readFileSync(join(dir, 'trails.lock'), 'utf8')) as {
    readonly topoGraph?: { readonly overlays?: Record<string, unknown> };
  };
  return lock.topoGraph?.overlays;
};

describe('lock overlays proof (TRL-1199 compile-path collection)', () => {
  test('a cloudflare-adapter app compiles real overlays into trails.lock, round-trips byte-identically, and validates green', async () => {
    const dir = newFixtureDir();
    writeFixtureApp(dir);

    // (a) compile succeeds.
    await compileFixture(dir);

    // (b) the committed lock embeds the validated cloudflare facts.
    const overlays = readLockOverlays(dir);
    expect(overlays).toEqual({
      cloudflare: {
        bindings: [{ binding: 'FLAGS', resourceId: 'flags' }],
      },
    });

    // (c) cold-store recompile is byte-identical.
    const lockPath = relative(repoRoot, join(dir, 'trails.lock'));
    const roundtrip = await runLockRoundtripSmoke({
      lockPaths: [lockPath],
      repoRoot,
    });
    expect(roundtrip.passed).toBe(true);
    expect(roundtrip.message).toContain('byte-identical');

    // (d) validate re-derives the same graph, overlays included.
    const validated = await validateTrail.blaze({ module: './src/app.ts' }, {
      cwd: dir,
    } as never);
    if (validated.isErr()) {
      throw validated.error;
    }
    expect(validated.value.stale).toBe(false);

    // (e) a second compile writes the exact same bytes.
    const firstBytes = readFileSync(join(dir, 'trails.lock'), 'utf8');
    await compileFixture(dir);
    const secondBytes = readFileSync(join(dir, 'trails.lock'), 'utf8');
    expect(secondBytes).toBe(firstBytes);
  }, 120_000);
});
