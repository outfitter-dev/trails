import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import {
  changedFileFilenames,
  changedFilePackagePaths,
} from './changed-files.ts';
import { findPublicTrailContractChangeFacts } from './contract-release-facts.ts';
import type { ChangedFileInput } from './changed-files.ts';
import type { ContractReleaseFact } from './contract-release-facts.ts';

interface PackageJson {
  readonly name?: string;
  readonly private?: boolean;
  readonly workspaces?: readonly string[];
}

export interface WorkspaceInfo {
  readonly isPrivate: boolean;
  readonly name: string;
  readonly relativePath: string;
}

export interface ReleaseDispositionCheckInput {
  readonly baseRef?: string;
  readonly changedFiles: readonly ChangedFileInput[];
  readonly contractFacts?: readonly ContractReleaseFact[];
  readonly releaseNone?: boolean;
  readonly releaseNoneReason?: string;
  readonly repoRoot: string;
  readonly workspaces: readonly WorkspaceInfo[];
}

export type ChangesetGateInput = ReleaseDispositionCheckInput;

export interface ReleaseDispositionCheckResult {
  readonly affectedPackages: readonly string[];
  readonly changedChangesets: readonly string[];
  readonly contractFacts: readonly ContractReleaseFact[];
  readonly coveredPackages: readonly string[];
  readonly errors: readonly string[];
  readonly passed: boolean;
  readonly releaseNone: boolean;
  readonly releaseNoneReason: string | null;
  readonly uncoveredContractFacts: readonly ContractReleaseFact[];
  readonly versionRelease: boolean;
}

export type ChangesetGateResult = ReleaseDispositionCheckResult;

interface CliOptions {
  readonly baseRef?: string;
  readonly changedFilesPath?: string;
  readonly releaseNone: boolean;
  readonly releaseNoneReason?: string;
  readonly repoRoot: string;
}

const NON_SHIPPING_PACKAGE_PATTERNS = [
  /(?:^|\/)__tests__(?:\/|$)/u,
  /(?:^|\/)__snapshots__(?:\/|$)/u,
  /(?:^|\/)dist(?:\/|$)/u,
  /(?:^|\/)\.turbo(?:\/|$)/u,
  /(?:^|\/)node_modules(?:\/|$)/u,
  /\.(?:test|spec|snap)\.[cm]?[jt]sx?$/u,
  /\.test-d\.ts$/u,
  /\.tsbuildinfo$/u,
] as const;

const CHANGESET_PATH_PATTERN = /^\.changeset\/[^/]+\.md$/u;
const CHANGESET_PACKAGE_PATTERN =
  /^['"]?(@ontrails\/[^'":]+)['"]?\s*:\s*(?:major|minor|patch)$/u;
const CHANGESET_PRERELEASE_STATE_PATH = '.changeset/pre.json';
const WORKSPACE_GLOB_SYNTAX_PATTERN = /[*?[\]{}]/u;
const VERSION_RELEASE_WORKSPACE_FILES = new Set([
  'CHANGELOG.md',
  'package.json',
]);

const normalizePath = (path: string): string =>
  path.replaceAll('\\', '/').replace(/^\.\//u, '');

const hasWorkspaceGlobSyntax = (pattern: string): boolean =>
  WORKSPACE_GLOB_SYNTAX_PATTERN.test(pattern);

const readJson = async <T>(path: string): Promise<T> =>
  (await Bun.file(path).json()) as T;

const discoverWorkspaceDirs = async (
  repoRoot: string,
  patterns: readonly string[]
): Promise<string[]> => {
  const dirs: string[] = [];

  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parent = join(repoRoot, pattern.slice(0, -2));
      let names: string[] = [];

      try {
        const entries = await readdir(parent, { withFileTypes: true });
        names = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) =>
            typeof entry.name === 'string' ? entry.name : String(entry.name)
          );
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

    const dir = join(repoRoot, pattern);

    if (await Bun.file(join(dir, 'package.json')).exists()) {
      dirs.push(dir);
      continue;
    }

    if (hasWorkspaceGlobSyntax(pattern)) {
      throw new Error(
        `Unsupported workspace pattern '${pattern}'. The release disposition check supports exact workspace paths and one-level '/*' globs.`
      );
    }

    throw new Error(
      `Workspace pattern '${pattern}' did not resolve to a package.json`
    );
  }

  return dirs;
};

export const discoverWorkspaces = async (
  repoRoot: string
): Promise<readonly WorkspaceInfo[]> => {
  const root = await readJson<PackageJson>(join(repoRoot, 'package.json'));

  if (!root.workspaces || root.workspaces.length === 0) {
    throw new Error('Root package.json has no workspaces field');
  }

  const dirs = await discoverWorkspaceDirs(repoRoot, root.workspaces);
  const workspaces: WorkspaceInfo[] = [];

  for (const dir of dirs) {
    const pkg = await readJson<PackageJson>(join(dir, 'package.json'));

    if (!pkg.name) {
      continue;
    }

    workspaces.push({
      isPrivate: pkg.private === true,
      name: pkg.name,
      relativePath: normalizePath(relative(repoRoot, dir)),
    });
  }

  return workspaces;
};

const isPublishableOnTrailsWorkspace = (workspace: WorkspaceInfo): boolean =>
  !workspace.isPrivate && workspace.name.startsWith('@ontrails/');

const isUnderWorkspace = (filePath: string, workspacePath: string): boolean =>
  filePath === workspacePath || filePath.startsWith(`${workspacePath}/`);

const getWorkspaceRelativePath = (
  filePath: string,
  workspacePath: string
): string => filePath.slice(workspacePath.length + 1);

const isNonShippingPackagePath = (workspaceRelativePath: string): boolean =>
  NON_SHIPPING_PACKAGE_PATTERNS.some((pattern) =>
    pattern.test(workspaceRelativePath)
  );

const findAffectedPackages = (
  changedFiles: readonly ChangedFileInput[],
  workspaces: readonly WorkspaceInfo[]
): readonly string[] => {
  const affected = new Set<string>();
  const publishableWorkspaces = workspaces.filter(
    isPublishableOnTrailsWorkspace
  );

  for (const file of changedFilePackagePaths(changedFiles)) {
    for (const workspace of publishableWorkspaces) {
      if (!isUnderWorkspace(file, workspace.relativePath)) {
        continue;
      }

      const workspaceRelativePath = getWorkspaceRelativePath(
        file,
        workspace.relativePath
      );

      if (isNonShippingPackagePath(workspaceRelativePath)) {
        continue;
      }

      affected.add(workspace.name);
    }
  }

  return [...affected].toSorted();
};

const isVersionReleaseChangeSet = (
  changedFiles: readonly ChangedFileInput[],
  workspaces: readonly WorkspaceInfo[],
  coveredPackages: readonly string[]
): boolean => {
  const normalizedFiles = changedFileFilenames(changedFiles);
  const coveredPackageSet = new Set(coveredPackages);

  if (!normalizedFiles.includes(CHANGESET_PRERELEASE_STATE_PATH)) {
    return false;
  }

  const publishableWorkspaces = workspaces.filter(
    isPublishableOnTrailsWorkspace
  );
  let hasWorkspaceVersionFile = false;

  for (const file of normalizedFiles) {
    for (const workspace of publishableWorkspaces) {
      if (!isUnderWorkspace(file, workspace.relativePath)) {
        continue;
      }

      const workspaceRelativePath = getWorkspaceRelativePath(
        file,
        workspace.relativePath
      );

      if (isNonShippingPackagePath(workspaceRelativePath)) {
        continue;
      }

      if (!VERSION_RELEASE_WORKSPACE_FILES.has(workspaceRelativePath)) {
        if (!coveredPackageSet.has(workspace.name)) {
          return false;
        }

        continue;
      }

      hasWorkspaceVersionFile = true;
    }
  }

  return hasWorkspaceVersionFile;
};

const parseChangesetPackages = (content: string): readonly string[] => {
  const lines = content.split(/\r?\n/u);

  if (lines[0] !== '---') {
    return [];
  }

  const closingIndex = lines.slice(1).indexOf('---');

  if (closingIndex === -1) {
    return [];
  }

  return lines.slice(1, closingIndex + 1).flatMap((line): string[] => {
    const match = line.match(CHANGESET_PACKAGE_PATTERN);
    return match?.[1] ? [match[1]] : [];
  });
};

const findChangedChangesetPaths = (
  changedFiles: readonly ChangedFileInput[]
): readonly string[] =>
  changedFileFilenames(changedFiles).filter((path) =>
    CHANGESET_PATH_PATTERN.test(path)
  );

const findChangedChangesets = (
  changedChangesetPaths: readonly string[],
  repoRoot: string
): readonly {
  readonly packages: readonly string[];
  readonly path: string;
}[] =>
  changedChangesetPaths.flatMap((path) => {
    const absolutePath = join(repoRoot, path);

    if (!existsSync(absolutePath)) {
      return [];
    }

    const packages = parseChangesetPackages(readFileSync(absolutePath, 'utf8'));

    return packages.length === 0 ? [] : [{ packages, path }];
  });

const findGateContractFacts = (
  input: ReleaseDispositionCheckInput
): readonly ContractReleaseFact[] =>
  input.contractFacts ??
  findPublicTrailContractChangeFacts({
    baseRef: input.baseRef,
    changedFiles: input.changedFiles,
    repoRoot: input.repoRoot,
    workspaces: input.workspaces,
  });

const isContractFactCovered = (
  fact: ContractReleaseFact,
  coveredPackages: readonly string[]
): boolean =>
  fact.packageName !== undefined && coveredPackages.includes(fact.packageName);

const formatContractFact = (fact: ContractReleaseFact): string =>
  `${fact.trailId} ${fact.aspect} (${fact.packageName ?? fact.path})`;

const hasReleaseNoneRationale = (value: string | undefined): boolean => {
  const normalized = value?.trim() ?? '';

  if (!normalized.toLowerCase().includes('release:none')) {
    return false;
  }

  const rationale = normalized.replaceAll(/release:none/giu, '').trim();
  return rationale.length >= 12;
};

export const checkReleaseDisposition = (
  input: ReleaseDispositionCheckInput
): ReleaseDispositionCheckResult => {
  const releaseNone = input.releaseNone === true;
  const affectedPackages = findAffectedPackages(
    input.changedFiles,
    input.workspaces
  );
  const releaseNoneReason = input.releaseNoneReason?.trim() ?? '';
  const changedChangesets = findChangedChangesetPaths(input.changedFiles);
  const changesets = findChangedChangesets(changedChangesets, input.repoRoot);
  const coveredPackages = [
    ...new Set(changesets.flatMap((changeset) => changeset.packages)),
  ].toSorted();
  const contractFacts = findGateContractFacts(input);
  const versionRelease = isVersionReleaseChangeSet(
    input.changedFiles,
    input.workspaces,
    coveredPackages
  );
  const uncoveredPackages = affectedPackages.filter(
    (packageName) => !coveredPackages.includes(packageName)
  );
  const uncoveredContractFacts = contractFacts.filter(
    (fact) => !isContractFactCovered(fact, coveredPackages)
  );
  const errors: string[] = [];

  if (releaseNone && changedChangesets.length > 0) {
    errors.push(
      '`release:none` conflicts with changed changeset files. Remove the label or the changeset.'
    );
  }

  if (releaseNone && !hasReleaseNoneRationale(releaseNoneReason)) {
    errors.push(
      '`release:none` needs a PR body rationale that mentions release:none and explains why no user-visible package content changed.'
    );
  }

  if (!releaseNone && !versionRelease && uncoveredPackages.length > 0) {
    errors.push(
      `Package-affecting changes need changeset entries for: ${uncoveredPackages.join(', ')}`
    );
  }

  if (!releaseNone && !versionRelease && uncoveredContractFacts.length > 0) {
    errors.push(
      `Public trail contract changes need release disposition: ${uncoveredContractFacts
        .map(formatContractFact)
        .join(', ')}`
    );
  }

  return {
    affectedPackages,
    changedChangesets,
    contractFacts,
    coveredPackages,
    errors,
    passed: errors.length === 0,
    releaseNone,
    releaseNoneReason: releaseNoneReason.length > 0 ? releaseNoneReason : null,
    uncoveredContractFacts,
    versionRelease,
  };
};

export const checkChangesetGate = checkReleaseDisposition;

const parseChangedFileRecord = (line: string): ChangedFileInput => {
  if (line.startsWith('{')) {
    const record = JSON.parse(line) as {
      readonly filename?: unknown;
      readonly previous_filename?: unknown;
      readonly previousFilename?: unknown;
      readonly status?: unknown;
    };

    if (typeof record.filename !== 'string') {
      throw new TypeError(
        `Changed file JSON record is missing filename: ${line}`
      );
    }

    let previousFilename: string | undefined;
    if (typeof record.previousFilename === 'string') {
      ({ previousFilename } = record);
    } else if (typeof record.previous_filename === 'string') {
      previousFilename = record.previous_filename;
    }

    return {
      filename: record.filename,
      ...(previousFilename ? { previousFilename } : {}),
      ...(typeof record.status === 'string' ? { status: record.status } : {}),
    };
  }

  const [filename, status, previousFilename] = line.split('\t');

  return {
    filename: filename ?? '',
    ...(previousFilename ? { previousFilename } : {}),
    ...(status ? { status } : {}),
  };
};

const readChangedFiles = (path: string): readonly ChangedFileInput[] =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseChangedFileRecord);

const parseChangedFilesOutput = (output: string): readonly ChangedFileInput[] =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const readLocalChangedFiles = (
  repoRoot: string
): readonly ChangedFileInput[] => {
  const result = Bun.spawnSync({
    cmd: [
      'git',
      'diff',
      '--name-only',
      '--diff-filter=ACMRTUXB',
      'origin/main...HEAD',
      '--',
      '.',
    ],
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to derive local changed files: ${result.stderr.toString()}`
    );
  }

  return parseChangedFilesOutput(result.stdout.toString());
};

const parseArgs = (args: readonly string[]): CliOptions => {
  let baseRef: string | undefined;
  let changedFilesPath: string | undefined;
  let releaseNone = false;
  let releaseNoneReason: string | undefined;
  let repoRoot = resolve(import.meta.dir, '..');

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--release-none') {
      releaseNone = true;
      continue;
    }

    if (arg === '--release-none-reason') {
      const value = args[index + 1];

      if (!value) {
        throw new Error('--release-none-reason requires text');
      }

      releaseNoneReason = value;
      index += 1;
      continue;
    }

    if (arg === '--base-ref') {
      const value = args[index + 1];

      if (!value) {
        throw new Error('--base-ref requires a git ref or commit');
      }

      baseRef = value;
      index += 1;
      continue;
    }

    if (arg === '--changed-files') {
      const value = args[index + 1];

      if (!value) {
        throw new Error('--changed-files requires a file path');
      }

      changedFilesPath = value;
      index += 1;
      continue;
    }

    if (arg === '--repo-root') {
      const value = args[index + 1];

      if (!value) {
        throw new Error('--repo-root requires a directory path');
      }

      repoRoot = resolve(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg ?? ''}`);
  }

  return {
    baseRef,
    changedFilesPath,
    releaseNone,
    releaseNoneReason,
    repoRoot,
  };
};

const renderResult = (result: ReleaseDispositionCheckResult): void => {
  if (result.passed) {
    if (result.affectedPackages.length === 0) {
      console.log(
        'Release disposition check passed: no publishable package-affecting files changed.'
      );
      return;
    }

    if (result.releaseNone) {
      console.log(
        `Release disposition check passed via release:none for: ${result.affectedPackages.join(', ')}`
      );
      return;
    }

    if (result.versionRelease) {
      console.log(
        `Release disposition check passed for generated version release: ${result.affectedPackages.join(', ')}`
      );
      return;
    }

    console.log(
      `Release disposition check passed for: ${result.affectedPackages.join(', ')}`
    );
    console.log(`Changed changesets: ${result.changedChangesets.join(', ')}`);
    return;
  }

  for (const error of result.errors) {
    console.error(error);
  }

  if (result.affectedPackages.length > 0) {
    console.error(`Affected packages: ${result.affectedPackages.join(', ')}`);
  }

  if (result.contractFacts.length > 0) {
    console.error(
      `Public trail contract facts: ${result.contractFacts
        .map(formatContractFact)
        .join(', ')}`
    );
  }

  if (result.changedChangesets.length > 0) {
    console.error(`Changed changesets: ${result.changedChangesets.join(', ')}`);
  }
};

const main = async (): Promise<number> => {
  const options = parseArgs(process.argv.slice(2));

  const workspaces = await discoverWorkspaces(options.repoRoot);
  const changedFiles = options.changedFilesPath
    ? readChangedFiles(options.changedFilesPath)
    : readLocalChangedFiles(options.repoRoot);
  const result = checkReleaseDisposition({
    baseRef:
      options.baseRef ??
      (options.changedFilesPath === undefined ? 'origin/main' : undefined),
    changedFiles,
    releaseNone: options.releaseNone,
    releaseNoneReason: options.releaseNoneReason,
    repoRoot: options.repoRoot,
    workspaces,
  });

  renderResult(result);

  return result.passed ? 0 : 1;
};

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
