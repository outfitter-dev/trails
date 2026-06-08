import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { defaultReleaseConfig, releaseConfigSchema } from './config.js';
import type { ReleaseConfigInput, ReleaseFactType } from './config.js';
import { findPublicTrailContractChangeFacts } from './contract-facts.js';
import type { ContractReleaseFact } from './contract-facts.js';

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

export interface ReleaseCheckInput {
  readonly baseRef?: string;
  readonly changedFiles: readonly string[];
  readonly contractFacts?: readonly ContractReleaseFact[];
  readonly noReleaseOverride?: boolean;
  readonly releaseConfig?: ReleaseConfigInput;
  /** Compatibility alias for the existing GitHub label and package script. */
  readonly releaseNone?: boolean;
  readonly repoRoot: string;
  readonly workspaces: readonly WorkspaceInfo[];
}

export interface ReleaseCheckResult {
  readonly affectedPackages: readonly string[];
  readonly changedChangesets: readonly string[];
  readonly contractFacts: readonly ContractReleaseFact[];
  readonly coveredPackages: readonly string[];
  readonly errors: readonly string[];
  readonly matchedRuleIds: readonly string[];
  readonly noReleaseOverride: boolean;
  readonly passed: boolean;
  /** Compatibility alias for the existing GitHub label and package script. */
  readonly releaseNone: boolean;
  readonly uncoveredContractFacts: readonly ContractReleaseFact[];
  readonly versionRelease: boolean;
}

interface CliOptions {
  readonly baseRef?: string;
  readonly changedFilesPath?: string;
  readonly releaseNone: boolean;
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
        `Unsupported workspace pattern '${pattern}'. The release check supports exact workspace paths and one-level '/*' globs.`
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

  return workspaces.toSorted((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
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
  changedFiles: readonly string[],
  workspaces: readonly WorkspaceInfo[]
): readonly string[] => {
  const affected = new Set<string>();
  const publishableWorkspaces = workspaces.filter(
    isPublishableOnTrailsWorkspace
  );

  for (const file of changedFiles.map(normalizePath)) {
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
  changedFiles: readonly string[],
  workspaces: readonly WorkspaceInfo[],
  coveredPackages: readonly string[]
): boolean => {
  const normalizedFiles = changedFiles.map(normalizePath);
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
  changedFiles: readonly string[]
): readonly string[] =>
  changedFiles
    .map(normalizePath)
    .filter((path) => CHANGESET_PATH_PATTERN.test(path));

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
  input: ReleaseCheckInput
): readonly ContractReleaseFact[] =>
  input.contractFacts ??
  findPublicTrailContractChangeFacts({
    ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
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

const ruleMatchesFactType = (
  input: ReleaseCheckInput,
  factType: ReleaseFactType
): boolean => {
  const releaseConfig = input.releaseConfig
    ? releaseConfigSchema.parse(input.releaseConfig)
    : defaultReleaseConfig;
  return releaseConfig.rules.some(
    (rule) =>
      rule.enabled && rule.severity === 'error' && rule.facts.includes(factType)
  );
};

const findMatchedRuleIds = (input: ReleaseCheckInput): readonly string[] => {
  const releaseConfig = input.releaseConfig
    ? releaseConfigSchema.parse(input.releaseConfig)
    : defaultReleaseConfig;
  return releaseConfig.rules
    .filter((rule) => rule.enabled && rule.severity === 'error')
    .map((rule) => rule.id)
    .toSorted();
};

export const checkReleaseRules = (
  input: ReleaseCheckInput
): ReleaseCheckResult => {
  const noReleaseOverride =
    input.noReleaseOverride === true || input.releaseNone === true;
  const affectedPackages = findAffectedPackages(
    input.changedFiles,
    input.workspaces
  );
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
  const matchedRuleIds = findMatchedRuleIds(input);
  const requiresPackageIntent = ruleMatchesFactType(input, 'package-content');
  const requiresPublicContractIntent = ruleMatchesFactType(
    input,
    'public-trail-contract'
  );
  const errors: string[] = [];

  if (noReleaseOverride && changedChangesets.length > 0) {
    errors.push(
      '`release:none` conflicts with changed changeset files. Remove the label or the changeset.'
    );
  }

  if (
    !noReleaseOverride &&
    !versionRelease &&
    requiresPackageIntent &&
    uncoveredPackages.length > 0
  ) {
    errors.push(
      `Release rules require intent for package content changes: ${uncoveredPackages.join(', ')}`
    );
  }

  if (
    !noReleaseOverride &&
    !versionRelease &&
    requiresPublicContractIntent &&
    uncoveredContractFacts.length > 0
  ) {
    errors.push(
      `Release rules require intent for public trail contract changes: ${uncoveredContractFacts
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
    matchedRuleIds,
    noReleaseOverride,
    passed: errors.length === 0,
    releaseNone: noReleaseOverride,
    uncoveredContractFacts,
    versionRelease,
  };
};

const readChangedFiles = (path: string): readonly string[] =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const parseChangedFilesOutput = (output: string): readonly string[] =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const readLocalChangedFiles = (
  repoRoot: string,
  baseRef: string
): readonly string[] => {
  const result = Bun.spawnSync({
    cmd: [
      'git',
      'diff',
      '--name-only',
      '--diff-filter=ACMRTUXB',
      `${baseRef}...HEAD`,
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
  let repoRoot = process.cwd();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--release-none') {
      releaseNone = true;
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
    ...(baseRef === undefined ? {} : { baseRef }),
    ...(changedFilesPath === undefined ? {} : { changedFilesPath }),
    releaseNone,
    repoRoot,
  };
};

const renderResult = (result: ReleaseCheckResult): void => {
  if (result.passed) {
    if (result.affectedPackages.length === 0) {
      console.log(
        'Release check passed: no publishable package content files changed.'
      );
      return;
    }

    if (result.noReleaseOverride) {
      console.log(
        `Release check passed via release:none override for: ${result.affectedPackages.join(', ')}`
      );
      return;
    }

    if (result.versionRelease) {
      console.log(
        `Release check passed for generated version release: ${result.affectedPackages.join(', ')}`
      );
      return;
    }

    console.log(
      `Release check passed for: ${result.affectedPackages.join(', ')}`
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

export const runReleaseCheckCli = async (
  args: readonly string[]
): Promise<number> => {
  const options = parseArgs(args);

  const workspaces = await discoverWorkspaces(options.repoRoot);
  const baseRef =
    options.baseRef ??
    (options.changedFilesPath === undefined ? 'origin/main' : undefined);
  const changedFiles = options.changedFilesPath
    ? readChangedFiles(options.changedFilesPath)
    : readLocalChangedFiles(options.repoRoot, baseRef ?? 'origin/main');
  const result = checkReleaseRules({
    ...(baseRef === undefined ? {} : { baseRef }),
    changedFiles,
    releaseNone: options.releaseNone,
    repoRoot: options.repoRoot,
    workspaces,
  });

  renderResult(result);

  return result.passed ? 0 : 1;
};

if (import.meta.main) {
  try {
    process.exit(await runReleaseCheckCli(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
