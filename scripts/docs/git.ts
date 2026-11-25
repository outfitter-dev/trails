import { posix } from 'node:path';

export interface GitTree {
  readonly commit: string;
  readonly files: ReadonlyMap<string, string>;
  readonly workspaces: readonly string[];
  readonly workspacePatterns: readonly string[];
}

export interface GitChange {
  readonly status: string;
  readonly from: string;
  readonly to?: string;
}

/** Keep history access read-only and preserve filenames through argument arrays and NUL records. */
export const gitOutput = (root: string, args: readonly string[]): string => {
  const result = Bun.spawnSync(['git', '--literal-pathspecs', ...args], {
    cwd: root,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || `git ${args[0]} failed`);
  }
  return result.stdout.toString();
};

export const resolveCommit = (root: string, ref: string): string =>
  gitOutput(root, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${ref}^{commit}`,
  ]).trim();

export const readGitFile = (
  root: string,
  commit: string,
  path: string
): string => gitOutput(root, ['show', `${commit}:${path}`]);

export const readGitTree = (root: string, commit: string): GitTree => {
  const files = new Map<string, string>();
  for (const record of gitOutput(root, ['ls-tree', '-r', '-z', commit]).split(
    '\0'
  )) {
    if (!record) {
      continue;
    }
    const separator = record.indexOf('\t');
    files.set(record.slice(separator + 1), record.slice(0, 6));
  }
  const manifest = files.has('package.json')
    ? JSON.parse(readGitFile(root, commit, 'package.json'))
    : {};
  const patterns: unknown = manifest.workspaces ?? [];
  if (
    !Array.isArray(patterns) ||
    !patterns.every((value) => typeof value === 'string')
  ) {
    throw new Error(
      `${commit}: package.json workspaces must be an array of patterns`
    );
  }
  const workspaces = [...files.keys()]
    .filter(
      (path) =>
        posix.basename(path) === 'package.json' && path !== 'package.json'
    )
    .map((path) => posix.dirname(path))
    .filter((path) =>
      patterns.some((pattern) => new Bun.Glob(pattern).match(path))
    );
  return { commit, files, workspacePatterns: patterns, workspaces };
};

export const readGitChanges = (
  root: string,
  before: string,
  head: string
): readonly GitChange[] => {
  const records = gitOutput(root, [
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    before,
    head,
    '--',
  ]).split('\0');
  const changes: GitChange[] = [];
  for (let index = 0; index < records.length && records[index]; index += 1) {
    const status = records[index];
    index += 1;
    const from = records[index];
    if (status.startsWith('R') || status.startsWith('C')) {
      index += 1;
      changes.push({ from, status, to: records[index] });
    } else {
      changes.push({ from, status });
    }
  }
  return changes;
};

export const uncommittedPaths = (root: string): readonly string[] =>
  [
    gitOutput(root, [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      'HEAD',
      '--',
    ]),
    gitOutput(root, ['ls-files', '--others', '--exclude-standard', '-z']),
  ].flatMap((output) => output.split('\0').filter(Boolean));
