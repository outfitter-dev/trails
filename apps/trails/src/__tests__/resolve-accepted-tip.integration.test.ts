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

import { deriveTopoGraphForceIdentity } from '@ontrails/topography';
import type { TopoGraphForceEntry } from '@ontrails/topography';

import { resolveProjectLocks } from '../trails/resolve.js';
import { validateTrail } from '../trails/validate.js';
import {
  allForces,
  appendEntryForce,
  commit,
  compile,
  force,
  git,
  gitMayFail,
  readLock,
  requiredAlphaSource,
  trailSource,
  writeStandaloneApp,
} from './resolve-fixture.js';

const directories: string[] = [];
let previousStateHome: string | undefined;

const temporaryDirectory = (name = 'trails-resolve-accepted-tip-'): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), name)));
  directories.push(directory);
  return directory;
};

beforeEach(() => {
  previousStateHome = process.env.TRAILS_STATE_HOME;
  process.env.TRAILS_STATE_HOME = temporaryDirectory(
    'trails-resolve-accepted-tip-state-'
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

const eventIdentities = (
  events: readonly TopoGraphForceEntry[]
): readonly string[] =>
  [...new Set(events.map(deriveTopoGraphForceIdentity))].toSorted();

describe('trails resolve accepted current tip', () => {
  test('uses the forced current tip as contract evidence without accepting its break again', async () => {
    const root = temporaryDirectory();
    writeStandaloneApp(root);
    const lockPath = join(root, 'trails.lock');
    await compile(root);
    const priorAudit = force(
      'alpha',
      '2025-01-01T00:00:00.000Z',
      'prior retained audit'
    );
    appendEntryForce(lockPath, priorAudit);
    commit(root, 'test: accepted-tip base history');
    const base = git(root, 'rev-parse', 'HEAD').trim();

    git(root, 'switch', '--quiet', '-c', 'accepted/ours');
    writeFileSync(join(root, 'alpha.ts'), requiredAlphaSource());
    await compile(root, './app.ts', true);
    const oursLock = readLock(lockPath);
    const oursEvents = allForces(oursLock);
    const currentTipEvents = oursEvents.filter(
      (event) =>
        deriveTopoGraphForceIdentity(event) !==
        deriveTopoGraphForceIdentity(priorAudit)
    );
    expect(currentTipEvents.length).toBeGreaterThan(0);
    commit(root, 'test: accept breaking current tip');

    git(root, 'switch', '--quiet', '-c', 'accepted/theirs', base);
    writeFileSync(join(root, 'beta.ts'), trailSource('beta', 'theirs beta'));
    await compile(root);
    const theirsEvents = allForces(readLock(lockPath));
    commit(root, 'test: independent older-tip contract');

    git(root, 'switch', '--quiet', 'accepted/ours');
    const merged = gitMayFail(root, 'merge', '--no-edit', 'accepted/theirs');
    expect(merged.exitCode).not.toBe(0);
    expect(git(root, 'diff', '--name-only', '--diff-filter=U').trim()).toBe(
      'trails.lock'
    );
    const indexBefore = git(root, 'ls-files', '-u');

    const resolved = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(resolved.isOk()).toBe(true);
    if (resolved.isErr()) {
      throw resolved.error;
    }
    expect(git(root, 'ls-files', '-u')).toBe(indexBefore);
    const expectedIdentities = eventIdentities([
      ...oursEvents,
      ...theirsEvents,
    ]);
    const actualIdentities = eventIdentities(allForces(readLock(lockPath)));
    expect(actualIdentities).toEqual(expectedIdentities);
    expect(allForces(readLock(lockPath))).toContainEqual(priorAudit);
    for (const event of currentTipEvents) {
      expect(allForces(readLock(lockPath))).toContainEqual(event);
    }

    const canonical = readFileSync(lockPath, 'utf8');
    const repeated = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(repeated.isOk()).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe(canonical);
    await compile(root);
    expect(readFileSync(lockPath, 'utf8')).toBe(canonical);
    const validated = await validateTrail.implementation(
      { module: './app.ts', rootDir: root },
      { cwd: root } as never
    );
    expect(validated.isOk()).toBe(true);
  });

  test('retains independent forced transitions from both tips without accepting either again', async () => {
    const root = temporaryDirectory();
    writeStandaloneApp(root);
    const lockPath = join(root, 'trails.lock');
    await compile(root);
    commit(root, 'test: two-tip accepted base');
    const base = git(root, 'rev-parse', 'HEAD').trim();

    git(root, 'switch', '--quiet', '-c', 'accepted/both-ours');
    writeFileSync(join(root, 'alpha.ts'), requiredAlphaSource());
    await compile(root, './app.ts', true);
    const oursEvents = allForces(readLock(lockPath));
    expect(oursEvents.length).toBeGreaterThan(0);
    commit(root, 'test: force alpha transition');

    git(root, 'switch', '--quiet', '-c', 'accepted/both-theirs', base);
    writeFileSync(
      join(root, 'beta.ts'),
      trailSource('beta', 'required beta').replace(
        'input: z.object({}),',
        'input: z.object({ required: z.string() }),'
      )
    );
    await compile(root, './app.ts', true);
    const theirsEvents = allForces(readLock(lockPath));
    expect(theirsEvents.length).toBeGreaterThan(0);
    commit(root, 'test: force beta transition');

    git(root, 'switch', '--quiet', 'accepted/both-ours');
    const merged = gitMayFail(
      root,
      'merge',
      '--no-edit',
      'accepted/both-theirs'
    );
    expect(merged.exitCode).not.toBe(0);
    expect(git(root, 'diff', '--name-only', '--diff-filter=U').trim()).toBe(
      'trails.lock'
    );
    const indexBefore = git(root, 'ls-files', '-u');

    const resolved = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(resolved.isOk()).toBe(true);
    if (resolved.isErr()) {
      throw resolved.error;
    }
    expect(git(root, 'ls-files', '-u')).toBe(indexBefore);
    const expectedIdentities = eventIdentities([
      ...oursEvents,
      ...theirsEvents,
    ]);
    expect(eventIdentities(allForces(readLock(lockPath)))).toEqual(
      expectedIdentities
    );

    const canonical = readFileSync(lockPath, 'utf8');
    const repeated = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(repeated.isOk()).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe(canonical);
    await compile(root);
    expect(readFileSync(lockPath, 'utf8')).toBe(canonical);
  });
});
