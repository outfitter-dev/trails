import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TopoGraphForceEntry } from '@ontrails/topography';

import { resolveProjectLocks } from '../trails/resolve.js';
import { validateTrail } from '../trails/validate.js';
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
  trailSource,
  writeStandaloneApp,
} from './resolve-fixture.js';

const directories: string[] = [];
let previousStateHome: string | undefined;

const temporaryDirectory = (name = 'trails-resolve-rebase-'): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), name)));
  directories.push(directory);
  return directory;
};

beforeEach(() => {
  previousStateHome = process.env.TRAILS_STATE_HOME;
  process.env.TRAILS_STATE_HOME = temporaryDirectory(
    'trails-resolve-rebase-state-'
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

const continueRebase = (root: string): void => {
  const result = Bun.spawnSync(['git', 'rebase', '--continue'], {
    cwd: root,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] =>
            entry[1] !== undefined && !entry[0].startsWith('GIT_')
        )
      ),
      GIT_EDITOR: 'true',
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(Buffer.from(result.stderr).toString('utf8'));
  }
};

const resolveRebaseConflict = async (
  root: string,
  expectedEvents: readonly TopoGraphForceEntry[]
): Promise<void> => {
  expect(git(root, 'diff', '--name-only', '--diff-filter=U').trim()).toBe(
    'trails.lock'
  );
  const indexBefore = git(root, 'ls-files', '-u');
  const result = await resolveProjectLocks(
    { module: './app.ts', rootDir: root },
    root
  );
  if (result.isErr()) {
    throw result.error;
  }
  expect(git(root, 'ls-files', '-u')).toBe(indexBefore);
  expect(readFileSync(join(root, 'trails.lock'), 'utf8')).not.toContain(
    '<<<<<<<'
  );
  const lockPath = join(root, 'trails.lock');
  const canonical = readFileSync(lockPath, 'utf8');
  const events = allForces(readLock(lockPath));
  for (const event of expectedEvents) {
    expect(events).toContainEqual(event);
  }

  const oursHash = (
    JSON.parse(git(root, 'show', ':2:trails.lock')) as {
      topoGraphHash: string;
    }
  ).topoGraphHash;
  const theirsHash = (
    JSON.parse(git(root, 'show', ':3:trails.lock')) as {
      topoGraphHash: string;
    }
  ).topoGraphHash;
  writeFileSync(
    lockPath,
    canonical.replace(
      / {2}"topoGraphHash": "[^"]+",/u,
      `<<<<<<< ours\n  "topoGraphHash": "${oursHash}",\n=======\n  "topoGraphHash": "${theirsHash}",\n>>>>>>> theirs`
    )
  );
  const hashOnly = await resolveProjectLocks(
    { module: './app.ts', rootDir: root },
    root
  );
  expect(hashOnly.isOk()).toBe(true);
  expect(readFileSync(lockPath, 'utf8')).toBe(canonical);
  expect(git(root, 'ls-files', '-u')).toBe(indexBefore);
  git(root, 'add', '--', 'trails.lock');
  continueRebase(root);
};

describe('trails resolve stacked rebase recovery', () => {
  test('recovers lower and upper generated-lock conflicts through explicit Git staging', async () => {
    const root = temporaryDirectory();
    writeStandaloneApp(root);
    git(root, 'config', 'user.name', 'Trails Test');
    git(root, 'config', 'user.email', 'trails-test@example.invalid');
    const lockPath = join(root, 'trails.lock');
    await compile(root);
    const common = force(
      'alpha',
      '2026-01-01T00:00:00.000Z',
      'stack common event'
    );
    appendEntryForce(lockPath, common);
    commit(root, 'test: stack base');
    const base = git(root, 'rev-parse', 'HEAD').trim();

    git(root, 'switch', '--quiet', '-c', 'stack/lower');
    writeFileSync(join(root, 'alpha.ts'), trailSource('alpha', 'lower alpha'));
    await compile(root);
    const lower = force(
      'alpha',
      '2026-01-02T00:00:00.000Z',
      'lower layer event'
    );
    appendGraphForce(lockPath, lower);
    commit(root, 'test: lower layer');
    const oldLower = git(root, 'rev-parse', 'HEAD').trim();

    git(root, 'switch', '--quiet', '-c', 'stack/upper');
    writeFileSync(join(root, 'gamma.ts'), trailSource('gamma', 'upper gamma'));
    writeFileSync(
      join(root, 'app.ts'),
      appSource()
        .replace(
          "import { beta } from './beta.js';",
          "import { beta } from './beta.js';\nimport { gamma } from './gamma.js';"
        )
        .replace('{ alpha, beta }', '{ alpha, beta, gamma }')
    );
    await compile(root);
    const upper = force(
      'gamma',
      '2026-01-03T00:00:00.000Z',
      'upper layer event'
    );
    appendGraphForce(lockPath, upper);
    commit(root, 'test: upper layer');

    git(root, 'switch', '--quiet', '-c', 'trunk/changed', base);
    writeFileSync(join(root, 'beta.ts'), trailSource('beta', 'trunk beta'));
    await compile(root);
    const trunk = force('beta', '2026-01-04T00:00:00.000Z', 'trunk event');
    appendGraphForce(lockPath, trunk);
    commit(root, 'test: changed trunk');

    git(root, 'switch', '--quiet', 'stack/lower');
    const lowerRebase = gitMayFail(root, 'rebase', 'trunk/changed');
    expect(lowerRebase.exitCode).not.toBe(0);
    await resolveRebaseConflict(root, [common, lower, trunk]);
    const newLower = git(root, 'rev-parse', 'HEAD').trim();
    expect(newLower).not.toBe(oldLower);

    git(root, 'switch', '--quiet', 'stack/upper');
    const upperRebase = gitMayFail(
      root,
      'rebase',
      '--onto',
      newLower,
      oldLower
    );
    expect(upperRebase.exitCode).not.toBe(0);
    await resolveRebaseConflict(root, [common, lower, trunk, upper]);

    expect(git(root, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(root, 'alpha.ts'), 'utf8')).toContain(
      'lower alpha'
    );
    expect(readFileSync(join(root, 'beta.ts'), 'utf8')).toContain('trunk beta');
    expect(readFileSync(join(root, 'gamma.ts'), 'utf8')).toContain(
      'upper gamma'
    );

    process.env.TRAILS_STATE_HOME = temporaryDirectory(
      'trails-resolve-rebase-cold-state-'
    );
    const finalBytes = readFileSync(lockPath, 'utf8');
    await compile(root);
    expect(readFileSync(lockPath, 'utf8')).toBe(finalBytes);
    const validated = await validateTrail.implementation(
      { module: './app.ts', rootDir: root },
      { cwd: root } as never
    );
    expect(validated.isOk()).toBe(true);
    for (const event of [common, lower, trunk, upper]) {
      expect(allForces(readLock(lockPath))).toContainEqual(event);
    }
  });
});
