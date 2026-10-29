import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { deriveTopoGraphHash } from '@ontrails/topography';
import type {
  TopoGraph,
  TopoGraphForceEntry,
  TrailsLock,
} from '@ontrails/topography';

import { readResolveLockEvidence } from '../trails/resolve-evidence.js';

const directories: string[] = [];

const temporaryDirectory = (name = 'repo with spaces'): string => {
  const directory = mkdtempSync(join(tmpdir(), `trails-resolve-${name}-`));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const force = (detail: string): TopoGraphForceEntry => ({
  acceptedAt: `2026-10-${detail.length.toString().padStart(2, '0')}T00:00:00.000Z`,
  change: 'modified',
  detail,
  id: 'example',
  kind: 'trail',
  reason: `Retain ${detail}`,
  severity: 'breaking',
  source: 'trails compile --force',
});

const graphFor = (events: readonly TopoGraphForceEntry[]): TopoGraph => ({
  activationGraph: {
    edgeCount: 0,
    edges: [],
    sourceCount: 0,
    sourceKeys: [],
    trailIds: [],
  },
  activationSources: {},
  entries: [
    {
      exampleCount: 0,
      forces: events,
      id: 'example',
      input: { type: 'object' },
      intent: 'read',
      kind: 'trail',
      output: { type: 'object' },
      surfaces: [],
    },
  ],
  topoGraphSchemaVersion: 4,
});

const lockFor = (...events: readonly TopoGraphForceEntry[]): TrailsLock => {
  const topoGraph = graphFor(events);
  return {
    scope: { app: 'fixture' },
    summary: { entities: 0, resources: 0, signals: 0, trails: 1 },
    topoGraph,
    topoGraphHash: deriveTopoGraphHash(topoGraph),
    version: 5,
  };
};

const lockText = (...events: readonly TopoGraphForceEntry[]): string =>
  `${JSON.stringify(lockFor(...events), null, 2)}\n`;

const gitEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith('GIT_')
    )
  );

const git = (root: string, ...args: string[]): string => {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: root,
    env: gitEnvironment(),
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${Buffer.from(result.stderr).toString('utf8')}`
    );
  }
  return Buffer.from(result.stdout).toString('utf8');
};

const write = async (path: string, content: string): Promise<void> => {
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, content);
};

interface ConflictFixture {
  readonly lockPath: string;
  readonly root: string;
}

const parentLockText = (options?: {
  readonly malformedParent?: boolean;
  readonly tamperedParent?: boolean;
}): string => {
  if (options?.malformedParent) {
    return '{"version": 5';
  }
  const content = lockText(force('base'), force('other'));
  return options?.tamperedParent
    ? content.replace(
        /"topoGraphHash": "[0-9a-f]+"/u,
        '"topoGraphHash": "0000000000000000000000000000000000000000000000000000000000000000"'
      )
    : content;
};

const conflictFixture = async (options?: {
  readonly malformedParent?: boolean;
  readonly member?: boolean;
  readonly sourceConflict?: boolean;
  readonly tamperedParent?: boolean;
}): Promise<ConflictFixture> => {
  const root = temporaryDirectory();
  const relativeLockPath = options?.member
    ? 'apps/member app/trails.lock'
    : 'trails.lock';
  const lockPath = join(root, relativeLockPath);
  const sourcePath = join(root, 'src', 'contract.ts');
  git(root, 'init', '--quiet', '--initial-branch=main');
  await write(lockPath, lockText(force('base')));
  await write(sourcePath, 'export const value = "base";\n');
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=Trails Test',
    '-c',
    'user.email=trails-test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'base'
  );
  git(root, 'checkout', '--quiet', '-b', 'other');
  await write(lockPath, parentLockText(options));
  if (options?.sourceConflict) {
    await write(sourcePath, 'export const value = "other";\n');
  }
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=Trails Test',
    '-c',
    'user.email=trails-test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'other'
  );
  git(root, 'checkout', '--quiet', 'main');
  await write(lockPath, lockText(force('base'), force('main')));
  if (options?.sourceConflict) {
    await write(sourcePath, 'export const value = "main";\n');
  }
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=Trails Test',
    '-c',
    'user.email=trails-test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'main'
  );
  const merge = Bun.spawnSync(
    [
      'git',
      '-c',
      'user.name=Trails Test',
      '-c',
      'user.email=trails-test@example.invalid',
      'merge',
      '--no-edit',
      'other',
    ],
    { cwd: root, env: gitEnvironment(), stderr: 'pipe', stdout: 'pipe' }
  );
  expect(merge.exitCode).not.toBe(0);
  return { lockPath, root };
};

describe('readResolveLockEvidence', () => {
  test('reads a verified clean lock outside Git', async () => {
    const root = temporaryDirectory('non-git');
    const lockPath = join(root, 'trails.lock');
    const originalContent = lockText(force('clean'));
    await write(lockPath, originalContent);

    const result = await readResolveLockEvidence(lockPath);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.originalContent).toBe(originalContent);
      expect(result.value.sources).toEqual(['worktree']);
      expect(result.value.worktreeLock).toEqual(result.value.parents[0]);
      expect(result.value.parents[0]?.topoGraphHash).toBe(
        lockFor(force('clean')).topoGraphHash
      );
    }
  });

  test.each([false, true])(
    'reads real Git stages for root/member lock conflicts (member=%s)',
    async (member) => {
      const fixture = await conflictFixture({ member });
      const beforeLock = await Bun.file(fixture.lockPath).text();
      const beforeIndex = git(fixture.root, 'ls-files', '-u', '-z');

      const result = await readResolveLockEvidence(fixture.lockPath);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.sources).toEqual(['ours', 'theirs', 'base']);
        const details = result.value.parents.flatMap((parent) =>
          parent.topoGraph.entries.flatMap((entry) =>
            (entry.forces ?? []).map((event) => event.detail)
          )
        );
        expect(details).toContain('main');
        expect(details).toContain('other');
        expect(details).toContain('base');
        expect(result.value.originalContent).toBe(beforeLock);
      }
      expect(await Bun.file(fixture.lockPath).text()).toBe(beforeLock);
      expect(git(fixture.root, 'ls-files', '-u', '-z')).toBe(beforeIndex);
    }
  );

  test('includes a distinct independently valid worktree lock after the parent stages', async () => {
    const fixture = await conflictFixture();
    const resolved = lockText(
      force('base'),
      force('main'),
      force('other'),
      force('resolved')
    );
    await write(fixture.lockPath, resolved);

    const result = await readResolveLockEvidence(fixture.lockPath);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.sources).toEqual([
        'ours',
        'theirs',
        'base',
        'worktree',
      ]);
      expect(result.value.originalContent).toBe(resolved);
      expect(result.value.worktreeLock).toEqual(result.value.parents[3]);
    }
  });

  test('returns an integrity-valid worktree lock even when it is byte-identical to a parent stage', async () => {
    const fixture = await conflictFixture();
    const ours = git(fixture.root, 'show', ':2:trails.lock');
    await write(fixture.lockPath, ours);

    const result = await readResolveLockEvidence(fixture.lockPath);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.sources).toEqual(['ours', 'theirs', 'base']);
      expect(result.value.worktreeLock).toEqual(result.value.parents[0]);
      expect(result.value.originalContent).toBe(ours);
    }
  });

  test('does not return a malformed current lock when verified Git parents exist', async () => {
    const fixture = await conflictFixture();
    const malformed = '{"version": 5';
    await write(fixture.lockPath, malformed);

    const result = await readResolveLockEvidence(fixture.lockPath);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.sources).toEqual(['ours', 'theirs', 'base']);
      expect(result.value.worktreeLock).toBeUndefined();
      expect(result.value.originalContent).toBe(malformed);
    }
  });

  test('rejects a tampered Git parent stage without changing worktree or index', async () => {
    const fixture = await conflictFixture({ tamperedParent: true });
    const beforeLock = await Bun.file(fixture.lockPath).text();
    const beforeIndex = git(fixture.root, 'ls-files', '-u', '-z');

    const result = await readResolveLockEvidence(fixture.lockPath);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('integrity check');
    }
    expect(await Bun.file(fixture.lockPath).text()).toBe(beforeLock);
    expect(git(fixture.root, 'ls-files', '-u', '-z')).toBe(beforeIndex);
  });

  test('rejects a malformed Git parent stage', async () => {
    const fixture = await conflictFixture({ malformedParent: true });

    const result = await readResolveLockEvidence(fixture.lockPath);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('not valid JSON');
    }
  });

  test('rejects a tampered clean Git lock without parent stages', async () => {
    const root = temporaryDirectory('tampered-clean');
    const lockPath = join(root, 'trails.lock');
    git(root, 'init', '--quiet', '--initial-branch=main');
    const tampered = lockText(force('clean')).replace(
      /"topoGraphHash": "[0-9a-f]+"/u,
      '"topoGraphHash": "0000000000000000000000000000000000000000000000000000000000000000"'
    );
    await write(lockPath, tampered);

    const result = await readResolveLockEvidence(lockPath);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('integrity check');
    }
    expect(await Bun.file(lockPath).text()).toBe(tampered);
  });

  test('rejects unresolved authored source conflicts before reading lock parents', async () => {
    const fixture = await conflictFixture({ sourceConflict: true });
    const beforeLock = await Bun.file(fixture.lockPath).text();
    const beforeIndex = git(fixture.root, 'ls-files', '-u', '-z');

    const result = await readResolveLockEvidence(fixture.lockPath);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('authored source conflicts');
      expect(result.error.context?.['paths']).toEqual(['src/contract.ts']);
    }
    expect(await Bun.file(fixture.lockPath).text()).toBe(beforeLock);
    expect(git(fixture.root, 'ls-files', '-u', '-z')).toBe(beforeIndex);
  });

  test('rejects modify/delete conflicts missing a required parent stage', async () => {
    const root = temporaryDirectory('missing-stage');
    const lockPath = join(root, 'trails.lock');
    git(root, 'init', '--quiet', '--initial-branch=main');
    await write(lockPath, lockText(force('base')));
    git(root, 'add', 'trails.lock');
    git(
      root,
      '-c',
      'user.name=Trails Test',
      '-c',
      'user.email=trails-test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'base'
    );
    git(root, 'checkout', '--quiet', '-b', 'delete-lock');
    unlinkSync(lockPath);
    git(root, 'add', 'trails.lock');
    git(
      root,
      '-c',
      'user.name=Trails Test',
      '-c',
      'user.email=trails-test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'delete'
    );
    git(root, 'checkout', '--quiet', 'main');
    await write(lockPath, lockText(force('base'), force('main')));
    git(root, 'add', 'trails.lock');
    git(
      root,
      '-c',
      'user.name=Trails Test',
      '-c',
      'user.email=trails-test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'modify'
    );
    const merge = Bun.spawnSync(['git', 'merge', '--no-edit', 'delete-lock'], {
      cwd: root,
      env: gitEnvironment(),
      stderr: 'pipe',
      stdout: 'pipe',
    });
    expect(merge.exitCode).not.toBe(0);

    const result = await readResolveLockEvidence(lockPath);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('missing an ours or theirs');
    }
  });

  test('rejects missing, relative and out-of-worktree artifact paths', async () => {
    const missing = await readResolveLockEvidence(
      join(temporaryDirectory('missing'), 'trails.lock')
    );
    expect(missing.isErr()).toBe(true);
    if (missing.isErr()) {
      expect(missing.error.message).toContain('does not exist');
    }

    const relative = await readResolveLockEvidence('trails.lock');
    expect(relative.isErr()).toBe(true);
    if (relative.isErr()) {
      expect(relative.error.message).toContain('absolute');
    }

    const root = temporaryDirectory('containment');
    const outside = temporaryDirectory('outside');
    const outsideLock = join(outside, 'trails.lock');
    await write(outsideLock, lockText(force('outside')));
    git(root, 'init', '--quiet', '--initial-branch=main');
    const linkedLock = join(root, 'trails.lock');
    symlinkSync(outsideLock, linkedLock);
    const escaped = await readResolveLockEvidence(linkedLock);
    expect(escaped.isErr()).toBe(true);
    if (escaped.isErr()) {
      expect(escaped.error.message).toContain('symbolic link');
    }
  });

  test('rejects an in-app symbolic lock alias without changing its target', async () => {
    const root = temporaryDirectory('in-app-alias');
    const targetPath = join(root, 'retained-evidence.json');
    const targetContent = lockText(force('target'));
    await write(targetPath, targetContent);
    git(root, 'init', '--quiet', '--initial-branch=main');
    const lockPath = join(root, 'trails.lock');
    symlinkSync(targetPath, lockPath);

    const result = await readResolveLockEvidence(lockPath);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('symbolic link');
      expect(result.error.message).toContain('regular generated lock');
    }
    expect(await Bun.file(targetPath).text()).toBe(targetContent);
  });
});
