import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface ReleasePackCoherenceInput {
  readonly branchName?: string | undefined;
  readonly changedFiles: readonly string[];
}

export interface ReleasePackCoherenceWorkspace {
  readonly name: string;
  readonly path: string;
  readonly version?: string | undefined;
}

export interface ReleasePackCoherenceLockfileWorkspace {
  readonly name?: string | undefined;
  readonly version?: string | undefined;
}

export interface ReleasePackCoherenceLockfileInput {
  readonly lockfileWorkspaces: Readonly<
    Record<string, ReleasePackCoherenceLockfileWorkspace | undefined>
  >;
  readonly sourceWorkspaces: readonly ReleasePackCoherenceWorkspace[];
}

export interface ReleasePackCoherenceLockfileSyncResult {
  readonly text: string;
  readonly updates: readonly string[];
}

interface RootPackageJson {
  readonly workspaces?: readonly string[] | undefined;
}

interface WorkspacePackageJson {
  readonly name?: string | undefined;
  readonly version?: string | undefined;
}

interface BunLockfile {
  readonly workspaces?:
    | Readonly<
        Record<string, ReleasePackCoherenceLockfileWorkspace | undefined>
      >
    | undefined;
}

const RELEASE_BRANCH_NAME = 'changeset-release/main';
const REPO_ROOT = process.cwd();

export const isReleasePackCoherenceFile = (path: string): boolean =>
  path === 'bun.lock' ||
  path === '.changeset/pre.json' ||
  path === 'package.json' ||
  path.endsWith('/package.json') ||
  path.endsWith('/CHANGELOG.md');

export const shouldRunReleasePackCoherenceCheck = ({
  branchName,
  changedFiles,
}: ReleasePackCoherenceInput): boolean =>
  branchName === RELEASE_BRANCH_NAME ||
  changedFiles.some(isReleasePackCoherenceFile);

const commandText = (cmd: readonly string[]): string => cmd.join(' ');

const spawnCapture = async (cmd: readonly string[]): Promise<string> => {
  const proc = Bun.spawn(cmd as string[], {
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      [
        `Command failed: ${commandText(cmd)}`,
        `exit: ${exitCode}`,
        stdout.trim() ? `stdout:\n${stdout}` : undefined,
        stderr.trim() ? `stderr:\n${stderr}` : undefined,
      ]
        .filter((line): line is string => typeof line === 'string')
        .join('\n')
    );
  }
  return stdout;
};

const spawnInherit = async (cmd: readonly string[]): Promise<number> =>
  await Bun.spawn(cmd as string[], {
    env: { ...process.env, GIT_PAGER: 'cat' },
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  }).exited;

const currentBranchName = async (): Promise<string | undefined> => {
  const output = await spawnCapture(['git', 'branch', '--show-current']);
  const branch = output.trim();
  return branch.length > 0 ? branch : undefined;
};

const changedFilesFromGit = async (): Promise<readonly string[]> => {
  const mergeBaseOutput = await spawnCapture([
    'git',
    'merge-base',
    'origin/main',
    'HEAD',
  ]);
  const mergeBase = mergeBaseOutput.trim();
  const output = await spawnCapture([
    'git',
    'diff',
    '--name-only',
    '--diff-filter=ACMRT',
    `${mergeBase}...HEAD`,
  ]);
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
};

const changedFilesFromPath = async (
  path: string
): Promise<readonly string[]> => {
  const text = await readFile(path, 'utf8');
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
};

const removeJsonTrailingCommas = (text: string): string =>
  text.replaceAll(/,(\s*[}\]])/gu, '$1');

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T;

const readJsonc = async <T>(path: string): Promise<T> =>
  JSON.parse(removeJsonTrailingCommas(await readFile(path, 'utf8'))) as T;

const discoverWorkspaceDirs = async (
  patterns: readonly string[]
): Promise<string[]> => {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parent = join(REPO_ROOT, pattern.slice(0, -2));
      let names: string[] = [];
      try {
        const entries = await readdir(parent, { withFileTypes: true });
        names = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        continue;
      }
      for (const name of names) {
        const dir = join(parent, name);
        if (await Bun.file(join(dir, 'package.json')).exists()) {
          dirs.push(dir);
        }
      }
      continue;
    }

    const dir = join(REPO_ROOT, pattern);
    if (await Bun.file(join(dir, 'package.json')).exists()) {
      dirs.push(dir);
    }
  }
  return dirs;
};

const discoverSourceWorkspaces = async (): Promise<
  ReleasePackCoherenceWorkspace[]
> => {
  const root = await readJson<RootPackageJson>(join(REPO_ROOT, 'package.json'));
  if (!root.workspaces || root.workspaces.length === 0) {
    throw new Error('Root package.json has no "workspaces" field');
  }

  const dirs = await discoverWorkspaceDirs(root.workspaces);
  const workspaces: ReleasePackCoherenceWorkspace[] = [];
  for (const dir of dirs) {
    const pkg = await readJson<WorkspacePackageJson>(join(dir, 'package.json'));
    if (!pkg.name) {
      continue;
    }
    workspaces.push({
      name: pkg.name,
      path: relative(REPO_ROOT, dir),
      version: pkg.version,
    });
  }
  return workspaces;
};

export const findLockfileWorkspaceMetadataMismatches = ({
  lockfileWorkspaces,
  sourceWorkspaces,
}: ReleasePackCoherenceLockfileInput): string[] => {
  const mismatches: string[] = [];
  for (const workspace of sourceWorkspaces) {
    const lockWorkspace = lockfileWorkspaces[workspace.path];
    if (!lockWorkspace) {
      mismatches.push(
        `${workspace.path}/package.json is missing from bun.lock workspaces`
      );
      continue;
    }

    if (lockWorkspace.name !== workspace.name) {
      mismatches.push(
        `${workspace.path}/package.json has name ${workspace.name}, but bun.lock records ${lockWorkspace.name ?? '(missing)'}`
      );
    }

    if (
      typeof workspace.version === 'string' &&
      lockWorkspace.version !== workspace.version
    ) {
      mismatches.push(
        `${workspace.path}/package.json has version ${workspace.version}, but bun.lock records ${lockWorkspace.version ?? '(missing)'}`
      );
    }
  }
  return mismatches;
};

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const findWorkspaceBlockRange = (
  text: string,
  workspacePath: string
): { readonly start: number; readonly end: number } | undefined => {
  const keyMatch = new RegExp(
    `^    "${escapeRegExp(workspacePath)}": \\{`,
    'mu'
  ).exec(text);
  if (!keyMatch) {
    return undefined;
  }

  const openBrace = text.indexOf('{', keyMatch.index);
  if (openBrace === -1) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = openBrace; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { end: index + 1, start: openBrace };
      }
    }
  }

  return undefined;
};

export const syncLockfileWorkspaceMetadataText = (
  text: string,
  sourceWorkspaces: readonly ReleasePackCoherenceWorkspace[]
): ReleasePackCoherenceLockfileSyncResult => {
  let nextText = text;
  const updates: string[] = [];

  for (const workspace of sourceWorkspaces) {
    if (typeof workspace.version !== 'string') {
      continue;
    }

    const range = findWorkspaceBlockRange(nextText, workspace.path);
    if (!range) {
      continue;
    }

    const block = nextText.slice(range.start, range.end);
    const versionMatch = /^(\s*"version":\s*")([^"]*)(",?)$/mu.exec(block);
    if (!versionMatch || versionMatch[2] === workspace.version) {
      continue;
    }

    const replacement = `${versionMatch[1]}${workspace.version}${versionMatch[3]}`;
    const blockStart = range.start + versionMatch.index;
    const valueEnd = blockStart + versionMatch[0].length;
    nextText =
      nextText.slice(0, blockStart) + replacement + nextText.slice(valueEnd);
    updates.push(
      `${workspace.path}/package.json: ${versionMatch[2]} -> ${workspace.version}`
    );
  }

  return { text: nextText, updates };
};

const loadBunLockfile = async (): Promise<BunLockfile> =>
  await readJsonc<BunLockfile>(join(REPO_ROOT, 'bun.lock'));

const syncLockfileWorkspaceMetadata = async (): Promise<void> => {
  const lockfilePath = join(REPO_ROOT, 'bun.lock');
  const [lockfile, sourceWorkspaces] = await Promise.all([
    readFile(lockfilePath, 'utf8'),
    discoverSourceWorkspaces(),
  ]);
  const { text, updates } = syncLockfileWorkspaceMetadataText(
    lockfile,
    sourceWorkspaces
  );

  if (updates.length === 0) {
    console.error('release-pack: bun.lock workspace metadata already synced');
    return;
  }

  await writeFile(lockfilePath, text);
  console.error('release-pack: synced bun.lock workspace metadata');
  for (const update of updates) {
    console.error(`  ${update}`);
  }
};

const runLockfileWorkspaceMetadataCheck = async (): Promise<number> => {
  const lockfile = await loadBunLockfile();
  if (!lockfile.workspaces) {
    throw new Error('bun.lock has no "workspaces" object');
  }

  const mismatches = findLockfileWorkspaceMetadataMismatches({
    lockfileWorkspaces: lockfile.workspaces,
    sourceWorkspaces: await discoverSourceWorkspaces(),
  });

  if (mismatches.length === 0) {
    console.error('release-pack: bun.lock workspace metadata is coherent');
    return 0;
  }

  console.error('release-pack: bun.lock workspace metadata is stale');
  for (const mismatch of mismatches) {
    console.error(`  ${mismatch}`);
  }
  return 1;
};

export interface ReleasePackCoherenceParsedArgs {
  readonly branchName?: string | undefined;
  readonly changedFilesPath?: string | undefined;
  readonly fixLockfile: boolean;
  readonly lockfileOnly: boolean;
}

export const parseReleasePackCoherenceArgs = (
  args: readonly string[]
): ReleasePackCoherenceParsedArgs => {
  let branchName: string | undefined;
  let changedFilesPath: string | undefined;
  let fixLockfile = false;
  let lockfileOnly = false;
  const readValue = (index: number, flag: string): string => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(
        `Missing value for release pack coherence argument: ${flag}`
      );
    }
    return value;
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--branch') {
      branchName = readValue(index, arg);
      index += 1;
    } else if (arg === '--changed-files') {
      changedFilesPath = readValue(index, arg);
      index += 1;
    } else if (arg === '--lockfile-only') {
      lockfileOnly = true;
    } else if (arg === '--fix-lockfile') {
      fixLockfile = true;
    } else {
      throw new Error(`Unknown release pack coherence argument: ${arg}`);
    }
  }
  return { branchName, changedFilesPath, fixLockfile, lockfileOnly };
};

export const runReleasePackCoherenceCli = async (
  args: readonly string[] = process.argv.slice(2)
): Promise<number> => {
  try {
    const parsed = parseReleasePackCoherenceArgs(args);
    if (parsed.fixLockfile) {
      await syncLockfileWorkspaceMetadata();
      console.error('release-pack: checking bun.lock workspace metadata');
      return await runLockfileWorkspaceMetadataCheck();
    }

    const [branchName, changedFiles] = await Promise.all([
      parsed.branchName
        ? Promise.resolve(parsed.branchName)
        : currentBranchName(),
      parsed.changedFilesPath
        ? changedFilesFromPath(parsed.changedFilesPath)
        : changedFilesFromGit(),
    ]);

    if (!shouldRunReleasePackCoherenceCheck({ branchName, changedFiles })) {
      console.error(
        'release-pack: skipped; no package release metadata changed'
      );
      return 0;
    }

    if (parsed.lockfileOnly) {
      console.error('release-pack: checking bun.lock workspace metadata');
      return await runLockfileWorkspaceMetadataCheck();
    }

    console.error('release-pack: checking packed workspace metadata');
    return await spawnInherit(['bun', 'run', 'publish:check']);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};
