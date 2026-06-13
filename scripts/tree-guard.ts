#!/usr/bin/env bun
/**
 * Tree-stability guard for git hooks.
 *
 * Hook checks (tests, typecheck, warden) read the live working tree. When a
 * concurrent process — another agent, `gt`, an editor — checks out a branch
 * or edits files mid-run, those checks read a mixed tree and fail in ways
 * that look like flaky tests instead of what they are: an unstable checkout.
 * See the 2026-06-12 create.test.ts incident — a concurrent `git checkout`
 * during a pre-push run mixed the two sides of a lockstep commit.
 *
 * Usage:
 *   bun scripts/tree-guard.ts run -- bun run test
 *   bun scripts/tree-guard.ts snapshot   # compatibility/manual bracket start
 *   bun scripts/tree-guard.ts verify     # compatibility/manual bracket end
 */
import { existsSync, rmSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

interface TreeSnapshot {
  capturedAt: string;
  head: string;
  headReflog: string;
  status: string;
}

const HOOK_OWNED_TEMP_PREFIXES = ['.trails-life-'] as const;

const isHookOwnedTempStatusLine = (line: string): boolean => {
  if (!line.startsWith('?? ')) {
    return false;
  }
  const path = line.slice(3);
  return path
    .split('/')
    .some((segment) =>
      HOOK_OWNED_TEMP_PREFIXES.some((prefix) => segment.startsWith(prefix))
    );
};

const normalizeStatus = (status: string): string =>
  status
    .split('\n')
    .filter((line) => line.length > 0 && !isHookOwnedTempStatusLine(line))
    .join('\n');

const git = (...args: readonly string[]): string => {
  const proc = Bun.spawnSync({
    cmd: ['git', ...args],
    env: { ...process.env, GIT_PAGER: 'cat' },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (proc.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (exit ${proc.exitCode ?? 'null'}): ${proc.stderr.toString()}`
    );
  }
  return proc.stdout.toString().trim();
};

const captureSnapshot = (): TreeSnapshot => ({
  capturedAt: new Date().toISOString(),
  head: git('rev-parse', 'HEAD'),
  headReflog: git('reflog', 'show', '--format=%H%x00%gs', '-1', 'HEAD'),
  status: normalizeStatus(git('status', '--porcelain')),
});

const snapshotPath = (): string =>
  join(git('rev-parse', '--absolute-git-dir'), 'tree-guard.json');

const toPosixPath = (path: string): string => path.split(sep).join('/');

const trackedFiles = (): Set<string> =>
  new Set(git('ls-files', '-z').split('\0').filter(Boolean));

const repoKnownTrackedFiles = (): Set<string> => {
  const files = trackedFiles();
  const refs = git(
    'for-each-ref',
    '--format=%(objectname)',
    'refs/heads',
    'refs/remotes'
  )
    .split('\n')
    .filter(Boolean);

  for (const ref of refs) {
    for (const file of git('ls-tree', '-r', '--name-only', '-z', ref)
      .split('\0')
      .filter(Boolean)) {
      files.add(file);
    }
  }

  return files;
};

const missingAncestorDirectories = (root: string, path: string): string[] => {
  const directories: string[] = [];
  let dir = dirname(path);
  while (dir !== '.') {
    if (!existsSync(join(root, dir))) {
      directories.push(dir);
    }
    dir = dirname(dir);
  }
  return directories;
};

const nearestExistingDirectory = (root: string, file: string): string => {
  let dir = dirname(file);
  while (dir !== '.') {
    const absoluteDir = join(root, dir);
    if (existsSync(absoluteDir)) {
      return absoluteDir;
    }
    dir = dirname(dir);
  }
  return root;
};

const trackedDirectories = (files: Iterable<string>): Set<string> => {
  const root = git('rev-parse', '--show-toplevel');
  return new Set(
    [...files].map((file) => nearestExistingDirectory(root, file))
  );
};

const watchTrackedFileChanges = (observed: Set<string>): (() => void) => {
  const root = git('rev-parse', '--show-toplevel');
  const files = repoKnownTrackedFiles();
  const knownMissingDirectories = new Set(
    [...files].flatMap((file) => missingAncestorDirectories(root, file))
  );
  const watchers: FSWatcher[] = [];

  for (const dir of trackedDirectories(files)) {
    try {
      watchers.push(
        watch(dir, { persistent: false }, (_event, filename) => {
          if (filename === null) {
            observed.add(
              `tracked-file directory changed while hook checks were running: ${toPosixPath(relative(root, dir))}`
            );
            return;
          }

          const file =
            typeof filename === 'string' ? filename : filename.toString();
          const path = toPosixPath(relative(root, resolve(dir, file)));
          if (files.has(path) || knownMissingDirectories.has(path)) {
            observed.add(
              `repo-known tracked path changed while hook checks were running: ${path}`
            );
          }
        })
      );
    } catch (error) {
      observed.add(
        `tracked-file watch could not be armed for ${toPosixPath(relative(root, dir))}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };
};

const poll = async (): Promise<'poll'> => {
  await Bun.sleep(250);
  return 'poll';
};

const snapshot = async (): Promise<number> => {
  await Bun.write(snapshotPath(), JSON.stringify(captureSnapshot(), null, 2));
  return 0;
};

const compareSnapshots = (
  recorded: TreeSnapshot,
  current: TreeSnapshot
): string[] => {
  const drift: string[] = [];
  if (current.head !== recorded.head) {
    drift.push(`HEAD moved: ${recorded.head} -> ${current.head}`);
  }
  if (current.headReflog !== recorded.headReflog) {
    drift.push('HEAD reflog changed during hook checks');
  }
  if (current.status !== recorded.status) {
    drift.push(
      'working tree status changed (files modified, added, or removed)'
    );
  }
  return drift;
};

const formatDrift = (
  recorded: TreeSnapshot,
  drift: readonly string[]
): string =>
  [
    'tree-guard: the working tree changed while hook checks were running.',
    ...drift.map((line) => `  - ${line}`),
    '',
    'A concurrent process (another agent, gt, or an editor) mutated this',
    `checkout after ${recorded.capturedAt}. The check results above ran`,
    'against a mixed tree and are unreliable — failures may be phantom and',
    'passes may be false.',
    '',
    'Wait for the concurrent operation to finish, then re-run the push.',
  ].join('\n');

const verify = async (): Promise<number> => {
  const path = snapshotPath();
  if (!existsSync(path)) {
    console.error(
      'tree-guard: no snapshot found. Run `bun scripts/tree-guard.ts snapshot` before checks (is the hook ordering intact?).'
    );
    return 1;
  }
  const recorded = (await Bun.file(path).json()) as TreeSnapshot;
  rmSync(path, { force: true });

  let drift: string[];
  try {
    drift = compareSnapshots(recorded, captureSnapshot());
  } catch (error) {
    drift = [
      `tree state could not be read: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  if (drift.length === 0) {
    return 0;
  }

  console.error(formatDrift(recorded, drift));
  return 1;
};

const run = async (cmd: readonly string[]): Promise<number> => {
  if (cmd.length === 0) {
    console.error('Usage: bun scripts/tree-guard.ts run -- <command...>');
    return 1;
  }

  const recorded = captureSnapshot();
  const observed = new Set<string>();
  const closeWatchers = watchTrackedFileChanges(observed);
  const proc = Bun.spawn({
    cmd,
    env: { ...process.env, GIT_PAGER: 'cat', TRAILS_TREE_GUARD: '1' },
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  });

  try {
    let exitCode: number | undefined;
    while (exitCode === undefined) {
      const result = await Promise.race([proc.exited, poll()]);
      if (result !== 'poll') {
        exitCode = result;
        break;
      }
      try {
        for (const line of compareSnapshots(recorded, captureSnapshot())) {
          observed.add(line);
        }
      } catch (error) {
        observed.add(
          `tree state could not be read: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    try {
      for (const line of compareSnapshots(recorded, captureSnapshot())) {
        observed.add(line);
      }
    } catch (error) {
      observed.add(
        `tree state could not be read: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (observed.size > 0) {
      console.error(formatDrift(recorded, [...observed]));
      return 1;
    }
    return exitCode;
  } finally {
    closeWatchers();
  }
};

const main = async (): Promise<number> => {
  const mode = process.argv.at(2);
  switch (mode) {
    case 'run': {
      const separatorIndex = process.argv.indexOf('--');
      const cmd =
        separatorIndex === -1
          ? process.argv.slice(3)
          : process.argv.slice(separatorIndex + 1);
      return await run(cmd);
    }
    case 'snapshot': {
      return await snapshot();
    }
    case 'verify': {
      return await verify();
    }
    default: {
      console.error(
        'Usage: bun scripts/tree-guard.ts <run|snapshot|verify> [-- <command...>]'
      );
      return 1;
    }
  }
};

process.exit(await main());
