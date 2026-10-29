import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
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

import { resolveProjectLocks } from '../trails/resolve.js';
import { validateTrail } from '../trails/validate.js';
import { wardenTrail } from '../trails/warden.js';
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
  writeStandaloneApp,
} from './resolve-fixture.js';

const directories: string[] = [];
let previousStateHome: string | undefined;

const temporaryDirectory = (name = 'trails-resolve-'): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), name)));
  directories.push(directory);
  return directory;
};

beforeEach(() => {
  previousStateHome = process.env.TRAILS_STATE_HOME;
  process.env.TRAILS_STATE_HOME = temporaryDirectory('trails-resolve-state-');
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

describe('trails resolve integration', () => {
  test('recovers a stacked consumer conflict with complete audit history and converges', async () => {
    const root = temporaryDirectory();
    writeStandaloneApp(root);
    const lockPath = join(root, 'trails.lock');
    await compile(root);
    const common = force(
      'alpha',
      '2026-10-01T00:00:00.000Z',
      'common ancestor event'
    );
    appendEntryForce(lockPath, common);
    commit(root, 'test: establish retained lock evidence');
    const base = git(root, 'rev-parse', 'HEAD').trim();

    git(root, 'switch', '--quiet', '-c', 'stack/alpha');
    writeFileSync(join(root, 'alpha.ts'), trailSource('alpha', 'alpha branch'));
    await compile(root);
    const ours = force(
      'alpha',
      '2026-10-02T00:00:00.000Z',
      'alpha branch event'
    );
    appendGraphForce(lockPath, ours);
    commit(root, 'test: change alpha contract');

    git(root, 'switch', '--quiet', '-c', 'stack/beta', base);
    writeFileSync(join(root, 'beta.ts'), trailSource('beta', 'beta branch'));
    await compile(root);
    const theirs = force(
      'beta',
      '2026-10-03T00:00:00.000Z',
      'beta branch event'
    );
    appendGraphForce(lockPath, theirs);
    commit(root, 'test: change beta contract');

    git(root, 'switch', '--quiet', 'stack/alpha');
    const merged = gitMayFail(root, 'merge', '--no-edit', 'stack/beta');
    expect(merged.exitCode).not.toBe(0);
    expect(git(root, 'diff', '--name-only', '--diff-filter=U').trim()).toBe(
      'trails.lock'
    );

    const recovered = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(recovered.isOk()).toBe(true);
    if (recovered.isErr()) {
      throw recovered.error;
    }
    expect(recovered.value.artifacts[0]?.sources).toEqual([
      'ours',
      'theirs',
      'base',
    ]);
    const firstBytes = readFileSync(lockPath, 'utf8');
    const forceFacts = allForces(readLock(lockPath)).map((event) => [
      event.id,
      event.acceptedAt,
      event.detail,
    ]);
    expect(forceFacts).toContainEqual([
      common.id,
      common.acceptedAt,
      common.detail,
    ]);
    expect(forceFacts).toContainEqual([ours.id, ours.acceptedAt, ours.detail]);
    expect(forceFacts).toContainEqual([
      theirs.id,
      theirs.acceptedAt,
      theirs.detail,
    ]);
    expect(
      forceFacts.filter((facts) => facts[2] === common.detail)
    ).toHaveLength(1);

    const repeated = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(repeated.isOk()).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe(firstBytes);
    await compile(root);
    expect(readFileSync(lockPath, 'utf8')).toBe(firstBytes);

    const validated = await validateTrail.implementation(
      { module: './app.ts', rootDir: root },
      { cwd: root } as never
    );
    expect(validated.isOk()).toBe(true);
    const governed = await wardenTrail.implementation(
      { depth: 'all', format: 'json', lock: 'cached', rootDir: root },
      { cwd: root, env: {} } as never
    );
    expect(governed.isOk()).toBe(true);
    if (governed.isOk()) {
      expect(governed.value.drift).toMatchObject({ stale: false });
    }
    expect(existsSync(join(root, '.trails', 'trails.lock'))).toBe(false);
  });

  test('fails a genuine breaking change before mutating a valid selected lock', async () => {
    const root = temporaryDirectory();
    writeStandaloneApp(root);
    const lockPath = join(root, 'trails.lock');
    await compile(root);
    const before = readFileSync(lockPath, 'utf8');
    writeFileSync(join(root, 'alpha.ts'), requiredAlphaSource());

    const result = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('breaking change');
      expect(result.error.message).toContain('--force');
    }
    expect(readFileSync(lockPath, 'utf8')).toBe(before);
  });

  test('requires force once for a genuine merged break, then preserves its accepted event exactly', async () => {
    const root = temporaryDirectory();
    writeStandaloneApp(root);
    const lockPath = join(root, 'trails.lock');
    await compile(root);
    commit(root, 'test: breaking recovery baseline');
    const base = git(root, 'rev-parse', 'HEAD').trim();
    const baseLock = readLock(lockPath);

    git(root, 'switch', '--quiet', '-c', 'breaking/ours');
    writeFileSync(join(root, 'alpha.ts'), requiredAlphaSource());
    rmSync(lockPath);
    await compile(root);
    const changedLock = readLock(lockPath);
    commit(root, 'test: authored breaking source');

    git(root, 'switch', '--quiet', '-c', 'breaking/theirs', base);
    writeFileSync(join(root, 'beta.ts'), trailSource('beta', 'theirs beta'));
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
    appendEntryForce(lockPath, historical);
    commit(root, 'test: independent sibling with matching old audit text');

    git(root, 'switch', '--quiet', 'breaking/ours');
    const merged = gitMayFail(root, 'merge', '--no-edit', 'breaking/theirs');
    expect(merged.exitCode).not.toBe(0);
    expect(git(root, 'diff', '--name-only', '--diff-filter=U').trim()).toBe(
      'trails.lock'
    );
    const conflicted = readFileSync(lockPath, 'utf8');

    const denied = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(denied.isErr()).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe(conflicted);

    const noPermit = Bun.spawnSync(
      [
        process.execPath,
        join(repoRoot, 'apps/trails/bin/trails.ts'),
        'resolve',
        '--root-dir',
        root,
        '--module',
        './app.ts',
        '--force',
        '--json',
      ],
      { cwd: root, env: process.env, stderr: 'pipe', stdout: 'pipe' }
    );
    expect(noPermit.exitCode).not.toBe(0);
    expect(`${noPermit.stdout}${noPermit.stderr}`).toContain('topo:write');
    expect(readFileSync(lockPath, 'utf8')).toBe(conflicted);

    const forced = await resolveProjectLocks(
      { force: true, module: './app.ts', rootDir: root },
      root
    );
    expect(forced.isOk()).toBe(true);
    if (forced.isErr()) {
      throw forced.error;
    }
    const resolved = readFileSync(lockPath, 'utf8');
    const accepted = allForces(readLock(lockPath)).filter(
      (event) => event.detail === historical.detail
    );
    expect(accepted).toContainEqual(historical);
    expect(
      accepted.some((event) => event.acceptedAt !== historical.acceptedAt)
    ).toBe(true);

    for (const forceOption of [undefined, true] as const) {
      const repeated = await resolveProjectLocks(
        { force: forceOption, module: './app.ts', rootDir: root },
        root
      );
      expect(repeated.isOk()).toBe(true);
      expect(readFileSync(lockPath, 'utf8')).toBe(resolved);
    }
    await compile(root);
    expect(readFileSync(lockPath, 'utf8')).toBe(resolved);

    writeFileSync(
      join(root, 'beta.ts'),
      trailSource('beta', 'theirs beta').replace(
        'input: z.object({}),',
        'input: z.object({ later: z.string() }),'
      )
    );
    const beforeChangedSource = readFileSync(lockPath, 'utf8');
    const changedAgain = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(changedAgain.isErr()).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe(beforeChangedSource);
    expect(baseLock.scope).toEqual(readLock(lockPath).scope);
  });

  test('refuses unresolved authored sources without changing lock bytes or Git stages', async () => {
    const root = temporaryDirectory();
    writeStandaloneApp(root);
    const lockPath = join(root, 'trails.lock');
    await compile(root);
    commit(root, 'test: baseline');
    const base = git(root, 'rev-parse', 'HEAD').trim();
    git(root, 'switch', '--quiet', '-c', 'source/ours');
    writeFileSync(join(root, 'alpha.ts'), trailSource('alpha', 'ours'));
    commit(root, 'test: ours');
    git(root, 'switch', '--quiet', '-c', 'source/theirs', base);
    writeFileSync(join(root, 'alpha.ts'), trailSource('alpha', 'theirs'));
    commit(root, 'test: theirs');
    git(root, 'switch', '--quiet', 'source/ours');
    const merged = gitMayFail(root, 'merge', '--no-edit', 'source/theirs');
    expect(merged.exitCode).not.toBe(0);
    const beforeLock = readFileSync(lockPath, 'utf8');
    const beforeStages = git(root, 'ls-files', '-u');

    const result = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('authored source conflicts');
    }
    expect(readFileSync(lockPath, 'utf8')).toBe(beforeLock);
    expect(git(root, 'ls-files', '-u')).toBe(beforeStages);
  });

  test('targets one configured member from an explicit config without touching siblings', async () => {
    const root = temporaryDirectory('trails resolve workspace ');
    symlinkSync(
      join(repoRoot, 'node_modules'),
      join(root, 'node_modules'),
      'dir'
    );
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    const alphaRoot = join(root, 'apps', 'alpha app');
    const betaRoot = join(root, 'apps', 'beta app');
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
      alpha: { root: 'apps/alpha app', entry: 'app.ts' },
      beta: { root: 'apps/beta app', entry: 'app.ts' },
    },
  },
};
`
    );
    git(root, 'init', '--quiet', '--initial-branch=main');
    commit(root, 'test: configured member locks');
    const betaBytes = readFileSync(join(betaRoot, 'trails.lock'), 'utf8');

    const result = await resolveProjectLocks(
      { app: 'alpha', configPath },
      root
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.artifacts).toHaveLength(1);
    expect(result.value.artifacts[0]?.lockPath).toBe(
      join(alphaRoot, 'trails.lock')
    );
    expect(readFileSync(join(betaRoot, 'trails.lock'), 'utf8')).toBe(betaBytes);
    expect(existsSync(join(root, 'trails.lock'))).toBe(false);
    expect(existsSync(join(root, '.trails', 'trails.lock'))).toBe(false);
  });
});
