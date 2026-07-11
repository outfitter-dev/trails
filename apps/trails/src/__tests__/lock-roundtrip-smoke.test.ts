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

const repoRoot = resolve(import.meta.dir, '../../../..');
const fixtureParent = resolve(import.meta.dir, '../..', '.tmp-tests');

let fixtureDir: string | undefined;
let testStateHome: string | undefined;
let originalTrailsStateHome: string | undefined;

beforeEach(() => {
  originalTrailsStateHome = process.env.TRAILS_STATE_HOME;
  testStateHome = mkdtempSync(join(tmpdir(), 'lock-rt-state-'));
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
  if (fixtureDir) {
    rmSync(fixtureDir, { force: true, recursive: true });
    fixtureDir = undefined;
  }
});

const writeFixtureApp = (dir: string, options?: { edited?: boolean }) => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const hello = trail('hello', {
  implementation: async (input) => Result.ok({ message: \`Hello, \${input.name ?? 'world'}!\` }),
  input: z.object({ name: z.string().optional()${options?.edited ? ".describe('Staled after compile')" : ''} }),
  intent: 'read',
  output: z.object({ message: z.string() }),
});

export const app = topo('lock-roundtrip-fixture', { hello });
`
  );
};

const compileFixture = async (dir: string): Promise<void> => {
  const compiled = await compileTrail.implementation(
    { module: './src/app.ts' },
    {
      cwd: dir,
    } as never
  );
  if (compiled.isErr()) {
    throw compiled.error;
  }
};

const newFixtureDir = (): string => {
  fixtureDir = join(
    fixtureParent,
    `lock-rt-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  return fixtureDir;
};

describe('lock round-trip smoke', () => {
  test('reports nothing to verify when no locks are committed', async () => {
    const result = await runLockRoundtripSmoke({ lockPaths: [], repoRoot });
    expect(result.passed).toBe(true);
    expect(result.lockCount).toBe(0);
    expect(result.message).toContain('nothing to verify');
  });

  test('passes when a committed lock recompiles cold to identical bytes', async () => {
    const dir = newFixtureDir();
    writeFixtureApp(dir);
    await compileFixture(dir);

    const lockPath = relative(repoRoot, join(dir, 'trails.lock'));
    const result = await runLockRoundtripSmoke({
      lockPaths: [lockPath],
      repoRoot,
    });
    expect(result.passed).toBe(true);
    expect(result.lockCount).toBe(1);
    expect(result.message).toContain('byte-identical');
  }, 60_000);

  test('fails on a deliberately staled fixture, names the divergence and the fixing command', async () => {
    const dir = newFixtureDir();
    writeFixtureApp(dir);
    await compileFixture(dir);
    const committed = readFileSync(join(dir, 'trails.lock'), 'utf8');

    // Stale the fixture: edit sources after compile, do not recompile.
    writeFixtureApp(dir, { edited: true });

    const lockPath = relative(repoRoot, join(dir, 'trails.lock'));
    let failure: Error | undefined;
    try {
      await runLockRoundtripSmoke({ lockPaths: [lockPath], repoRoot });
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }

    expect(failure).toBeDefined();
    expect(failure?.message).toContain('not byte-identical');
    expect(failure?.message).toContain('topoGraphHash');
    expect(failure?.message).toContain('compile --module');
    expect(failure?.message).toContain('Never hand-edit');

    // The gate is read-only: committed bytes are restored even on failure.
    expect(readFileSync(join(dir, 'trails.lock'), 'utf8')).toBe(committed);
  }, 60_000);
});
