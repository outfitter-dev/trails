import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveTopoGraphDiff } from '@ontrails/topography';
import type { TopoGraphForceEntry, TrailsLock } from '@ontrails/topography';

import { resolveProjectLocks } from '../trails/resolve.js';
import {
  allForces,
  appendEntryForce,
  appendGraphForce,
  appSource,
  commit,
  compile,
  force,
  git,
  gitMayFail,
  readLock,
  repoRoot,
  requiredAlphaSource,
  trailSource,
  writeLock,
  writeStandaloneApp,
} from './resolve-fixture.js';

const directories: string[] = [];
let previousStateHome: string | undefined;

const temporaryDirectory = (name = 'trails-resolve-negative-'): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), name)));
  directories.push(directory);
  return directory;
};

beforeEach(() => {
  previousStateHome = process.env.TRAILS_STATE_HOME;
  process.env.TRAILS_STATE_HOME = temporaryDirectory(
    'trails-resolve-negative-state-'
  );
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

interface BreakingConflictFixture {
  readonly historical: TopoGraphForceEntry;
  readonly lockPath: string;
  readonly parentGraphEvent: TopoGraphForceEntry;
  readonly root: string;
}

const breakingConflictFixture = async (): Promise<BreakingConflictFixture> => {
  const root = temporaryDirectory();
  writeStandaloneApp(root);
  const lockPath = join(root, 'trails.lock');
  await compile(root);
  commit(root, 'test: negative convergence baseline');
  const base = git(root, 'rev-parse', 'HEAD').trim();

  git(root, 'switch', '--quiet', '-c', 'negative/ours');
  writeFileSync(join(root, 'alpha.ts'), requiredAlphaSource());
  rmSync(lockPath);
  await compile(root);
  const changedLock = readLock(lockPath);
  commit(root, 'test: negative convergence break');

  git(root, 'switch', '--quiet', '-c', 'negative/theirs', base);
  writeFileSync(join(root, 'beta.ts'), trailSource('beta', 'negative theirs'));
  rmSync(lockPath);
  await compile(root);
  const parentLock = readLock(lockPath);
  const [matchingBreak] = deriveTopoGraphDiff(
    parentLock.topoGraph,
    changedLock.topoGraph
  ).breaking;
  if (matchingBreak === undefined || matchingBreak.kind === 'trailhead') {
    throw new Error('Expected a forceable breaking fixture diff');
  }
  const historical = force(
    matchingBreak.id,
    '2025-01-01T00:00:00.000Z',
    matchingBreak.details[0] ?? 'matching historical event'
  );
  const parentGraphEvent = force(
    'beta',
    '2025-02-01T00:00:00.000Z',
    'retained graph parent event'
  );
  appendEntryForce(lockPath, historical);
  appendGraphForce(lockPath, parentGraphEvent);
  commit(root, 'test: retained negative convergence evidence');

  git(root, 'switch', '--quiet', 'negative/ours');
  const merged = gitMayFail(root, 'merge', '--no-edit', 'negative/theirs');
  expect(merged.exitCode).not.toBe(0);
  expect(git(root, 'diff', '--name-only', '--diff-filter=U').trim()).toBe(
    'trails.lock'
  );
  const forced = await resolveProjectLocks(
    { force: true, module: './app.ts', rootDir: root },
    root
  );
  if (forced.isErr()) {
    throw forced.error;
  }
  return { historical, lockPath, parentGraphEvent, root };
};

const replaceGraphEvent = (
  lock: TrailsLock,
  acceptedAt: string,
  replace: (event: TopoGraphForceEntry) => TopoGraphForceEntry
): TrailsLock => ({
  ...lock,
  topoGraph: {
    ...lock.topoGraph,
    forces: (lock.topoGraph.forces ?? []).map((event) =>
      event.acceptedAt === acceptedAt ? replace(event) : event
    ),
  },
});

describe('trails resolve convergence controls', () => {
  test('does not accept missing or mutated parent events as converged recovery', async () => {
    const fixture = await breakingConflictFixture();
    const canonical = readFileSync(fixture.lockPath, 'utf8');
    const canonicalLock = readLock(fixture.lockPath);
    const mutations: readonly [string, (lock: TrailsLock) => TrailsLock][] = [
      [
        'missing',
        (lock) => ({
          ...lock,
          topoGraph: {
            ...lock.topoGraph,
            forces: (lock.topoGraph.forces ?? []).filter(
              (event) =>
                event.acceptedAt !== fixture.parentGraphEvent.acceptedAt
            ),
          },
        }),
      ],
      [
        'kind',
        (lock) =>
          replaceGraphEvent(
            lock,
            fixture.parentGraphEvent.acceptedAt,
            (event) => ({ ...event, kind: 'resource' })
          ),
      ],
      [
        'reason',
        (lock) =>
          replaceGraphEvent(
            lock,
            fixture.parentGraphEvent.acceptedAt,
            (event) => ({ ...event, reason: 'changed reason' })
          ),
      ],
      [
        'timestamp',
        (lock) =>
          replaceGraphEvent(
            lock,
            fixture.parentGraphEvent.acceptedAt,
            (event) => ({ ...event, acceptedAt: '2030-01-01T00:00:00.000Z' })
          ),
      ],
    ];

    for (const [name, mutate] of mutations) {
      writeLock(fixture.lockPath, mutate(canonicalLock));
      const mutated = readFileSync(fixture.lockPath, 'utf8');
      const denied = await resolveProjectLocks(
        { module: './app.ts', rootDir: fixture.root },
        fixture.root
      );
      expect(denied.isErr(), name).toBe(true);
      expect(readFileSync(fixture.lockPath, 'utf8'), name).toBe(mutated);

      const repaired = await resolveProjectLocks(
        { force: true, module: './app.ts', rootDir: fixture.root },
        fixture.root
      );
      expect(repaired.isOk(), name).toBe(true);
      expect(allForces(readLock(fixture.lockPath)), name).toContainEqual(
        fixture.parentGraphEvent
      );
      writeFileSync(fixture.lockPath, canonical);
    }
    expect(allForces(readLock(fixture.lockPath))).toContainEqual(
      fixture.historical
    );
  });

  test('does not treat a schema-valid summary mutation as byte-identical convergence', async () => {
    const fixture = await breakingConflictFixture();
    const canonical = readLock(fixture.lockPath);
    writeLock(fixture.lockPath, {
      ...canonical,
      summary: { ...canonical.summary, trails: canonical.summary.trails + 1 },
    });
    const mutated = readFileSync(fixture.lockPath, 'utf8');

    const denied = await resolveProjectLocks(
      { module: './app.ts', rootDir: fixture.root },
      fixture.root
    );
    expect(denied.isErr()).toBe(true);
    expect(readFileSync(fixture.lockPath, 'utf8')).toBe(mutated);

    const repaired = await resolveProjectLocks(
      { force: true, module: './app.ts', rootDir: fixture.root },
      fixture.root
    );
    expect(repaired.isOk()).toBe(true);
    expect(readLock(fixture.lockPath).summary).toEqual(canonical.summary);
  });

  test('rejects an unknown retained overlay before mutating the selected lock', async () => {
    const root = temporaryDirectory();
    writeStandaloneApp(root);
    await compile(root);
    const lockPath = join(root, 'trails.lock');
    const lock = readLock(lockPath);
    writeLock(lockPath, {
      ...lock,
      topoGraph: {
        ...lock.topoGraph,
        overlays: { missing: { value: true } },
      },
    });
    const before = readFileSync(lockPath, 'utf8');

    const result = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('has no loaded source');
    }
    expect(readFileSync(lockPath, 'utf8')).toBe(before);
  });

  test('preflights every selected app before repairing any workspace lock', async () => {
    const root = temporaryDirectory();
    symlinkSync(
      join(repoRoot, 'node_modules'),
      join(root, 'node_modules'),
      'dir'
    );
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    const alphaRoot = join(root, 'apps', 'alpha');
    const betaRoot = join(root, 'apps', 'beta');
    for (const [appRoot, appId] of [
      [alphaRoot, 'alpha'],
      [betaRoot, 'beta'],
    ] as const) {
      mkdirSync(appRoot, { recursive: true });
      writeFileSync(join(appRoot, 'alpha.ts'), trailSource('alpha', appId));
      writeFileSync(join(appRoot, 'beta.ts'), trailSource('beta', appId));
      writeFileSync(join(appRoot, 'app.ts'), appSource(appId));
      await compile(appRoot);
    }
    const configPath = join(root, 'custom.config.ts');
    writeFileSync(
      configPath,
      `export default {
  workspace: {
    apps: {
      alpha: { root: 'apps/alpha', entry: 'app.ts' },
      beta: { root: 'apps/beta', entry: 'app.ts' },
    },
  },
};
`
    );
    git(root, 'init', '--quiet', '--initial-branch=main');
    commit(root, 'test: multi-app preflight baseline');

    const alphaPath = join(alphaRoot, 'trails.lock');
    const alpha = readLock(alphaPath);
    writeLock(alphaPath, {
      ...alpha,
      summary: { ...alpha.summary, trails: alpha.summary.trails + 1 },
    });
    writeFileSync(join(betaRoot, 'alpha.ts'), requiredAlphaSource());
    const alphaBefore = readFileSync(alphaPath, 'utf8');
    const betaPath = join(betaRoot, 'trails.lock');
    const betaBefore = readFileSync(betaPath, 'utf8');

    const result = await resolveProjectLocks({ configPath }, root);
    expect(result.isErr()).toBe(true);
    expect(readFileSync(alphaPath, 'utf8')).toBe(alphaBefore);
    expect(readFileSync(betaPath, 'utf8')).toBe(betaBefore);
  });
});
