import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  deriveTrailsDbPath,
  Result,
  topo,
  trail,
  ValidationError,
} from '@ontrails/core';
import { deriveTopoGraphHash } from '@ontrails/topography';
import type { TrailsLock } from '@ontrails/topography';
import { z } from 'zod';

import { compileCurrentTopo } from '../trails/compile.js';

const repoRoot = resolve(import.meta.dir, '../../../..');
const directories: string[] = [];
let previousStateHome: string | undefined;

const temporaryDirectory = (): string => {
  const path = realpathSync(
    mkdtempSync(join(tmpdir(), 'trails-compile-integrity-'))
  );
  directories.push(path);
  return path;
};

beforeEach(() => {
  previousStateHome = process.env.TRAILS_STATE_HOME;
  process.env.TRAILS_STATE_HOME = temporaryDirectory();
});

afterEach(() => {
  if (previousStateHome === undefined) {
    delete process.env.TRAILS_STATE_HOME;
  } else {
    process.env.TRAILS_STATE_HOME = previousStateHome;
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const currentTrail = trail('current', {
  implementation: async () => Result.ok({ ok: true }),
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});
const app = topo('integrity-fixture', { current: currentTrail });

const committedFixture = async () => {
  const rootDir = temporaryDirectory();
  symlinkSync(
    join(repoRoot, 'node_modules'),
    join(rootDir, 'node_modules'),
    'dir'
  );
  await Bun.write(join(rootDir, 'package.json'), '{"type":"module"}\n');
  await Bun.write(
    join(rootDir, 'app.ts'),
    `import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';
export const app = topo('integrity-fixture', { current: trail('current', {
  implementation: async () => Result.ok({ ok: true }),
  input: z.object({}), output: z.object({ ok: z.boolean() }),
}) });
`
  );
  const compiled = await compileCurrentTopo(app, { rootDir });
  if (compiled.isErr()) {
    throw compiled.error;
  }
  const lockPath = join(rootDir, 'trails.lock');
  const initial = (await Bun.file(lockPath).json()) as TrailsLock;
  const entryForce = {
    acceptedAt: '2026-10-01T00:00:00.000Z',
    change: 'modified' as const,
    detail: 'Retained entry audit fixture',
    id: 'current',
    kind: 'trail' as const,
    severity: 'breaking' as const,
    source: 'trails compile --force' as const,
  };
  const graph = {
    ...initial.topoGraph,
    entries: initial.topoGraph.entries.map((entry) => ({
      ...entry,
      forces: [entryForce],
    })),
    forces: [{ ...entryForce, change: 'removed' as const, id: 'removed' }],
  };
  const baseline = `${JSON.stringify({ ...initial, topoGraph: graph, topoGraphHash: deriveTopoGraphHash(graph) }, null, 2)}\n`;
  await Bun.write(lockPath, baseline);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
  );
  for (const args of [
    ['init', '--quiet'],
    ['add', 'app.ts', 'package.json', 'trails.lock'],
    [
      '-c',
      'user.name=Trails Test',
      '-c',
      'user.email=trails-test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'test: retained lock history',
    ],
  ]) {
    const git = Bun.spawnSync(['git', ...args], {
      cwd: rootDir,
      env,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    expect(git.exitCode).toBe(0);
  }
  expect(graph.forces).toHaveLength(1);
  expect(graph.entries[0]?.forces).toHaveLength(1);
  return { baseline, lockPath, rootDir };
};

const corrupt = (baseline: string, kind: string): string => {
  if (kind === 'conflict') {
    return baseline.replace(
      /"topoGraphHash": "[^"]+"/,
      '<<<<<<< HEAD\n$&\n=======\n$&\n>>>>>>> feature'
    );
  }
  if (kind === 'truncated') {
    return baseline.slice(0, -20);
  }
  return `${JSON.stringify({ ...JSON.parse(baseline), version: 99 }, null, 2)}\n`;
};

test.each(['conflict', 'truncated', 'version'])(
  'compile refuses %s without replacing audit history or persisting a snapshot',
  async (kind) => {
    const fixture = await committedFixture();
    const damaged = corrupt(fixture.baseline, kind);
    await Bun.write(fixture.lockPath, damaged);
    const dbPath = deriveTrailsDbPath({ rootDir: fixture.rootDir });
    const stored = readFileSync(dbPath);
    const result = await compileCurrentTopo(app, { rootDir: fixture.rootDir });
    expect(result.isErr()).toBe(true);
    expect(await Bun.file(fixture.lockPath).text()).toBe(damaged);
    expect(readFileSync(dbPath)).toEqual(stored);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toContain('trails.lock');
      expect(result.error.message).toContain('Git');
    }
  }
);

test.each([false, true])(
  'plain CLI compile refuses conflicted audit history (force=%s)',
  async (force) => {
    const fixture = await committedFixture();
    const damaged = corrupt(fixture.baseline, 'conflict');
    await Bun.write(fixture.lockPath, damaged);
    const child = Bun.spawnSync(
      [
        process.execPath,
        join(repoRoot, 'apps/trails/bin/trails.ts'),
        'compile',
        '--root-dir',
        fixture.rootDir,
        '--module',
        './app.ts',
        '--permit',
        '{"actors":[],"id":"test-compile","scopes":["topo:write"]}',
        '--json',
        ...(force ? ['--force'] : []),
      ],
      { cwd: fixture.rootDir, env: process.env, stderr: 'pipe', stdout: 'pipe' }
    );
    expect(child.exitCode).not.toBe(0);
    expect(`${child.stdout}${child.stderr}`).toContain('trails.lock');
    expect(`${child.stdout}${child.stderr}`).toContain('Git conflict markers');
    expect(`${child.stdout}${child.stderr}`).toContain(
      'Restore a verified copy from Git'
    );
    expect(await Bun.file(fixture.lockPath).text()).toBe(damaged);
  }
);

test('a missing lock still supports the first compile', async () => {
  const rootDir = temporaryDirectory();
  const result = await compileCurrentTopo(app, { rootDir });
  expect(result.isOk()).toBe(true);
  expect(await Bun.file(join(rootDir, 'trails.lock')).exists()).toBe(true);
});

test('an unreadable legacy lock also fails before creating persistent state', async () => {
  const rootDir = temporaryDirectory();
  const legacyPath = join(rootDir, '.trails', 'trails.lock');
  const damaged = '{"version": 5,';
  await Bun.write(legacyPath, damaged);
  const result = await compileCurrentTopo(app, { rootDir });
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message).toContain('Restore a verified copy from Git');
  }
  expect(await Bun.file(legacyPath).text()).toBe(damaged);
  expect(await Bun.file(join(rootDir, 'trails.lock')).exists()).toBe(false);
  expect(await Bun.file(deriveTrailsDbPath({ rootDir })).exists()).toBe(false);
});

test('readable committed locks retain graph and entry audit events', async () => {
  const fixture = await committedFixture();
  const before = JSON.parse(fixture.baseline) as TrailsLock;
  const result = await compileCurrentTopo(app, { rootDir: fixture.rootDir });
  expect(result.isOk()).toBe(true);
  const after = (await Bun.file(fixture.lockPath).json()) as TrailsLock;
  expect(JSON.stringify(after.topoGraph.forces)).toBe(
    JSON.stringify(before.topoGraph.forces)
  );
  expect(JSON.stringify(after.topoGraph.entries[0]?.forces)).toBe(
    JSON.stringify(before.topoGraph.entries[0]?.forces)
  );
});
