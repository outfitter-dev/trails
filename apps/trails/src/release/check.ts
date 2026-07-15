import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { loadTrailsConfigValue } from '@ontrails/config';

import { defaultReleaseConfig, releaseConfigSchema } from './config.js';
import type { ReleaseConfigInput, ReleaseFactType } from './config.js';
import { findPublicTrailContractChangeFacts } from './contract-facts.js';
import type { ContractReleaseFact } from './contract-facts.js';
import { findPackageRouteReleaseFacts } from './package-route-facts.js';
import type { PackageRouteReleaseFact } from './package-route-facts.js';

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
  readonly baseWorkspaceError?: string;
  readonly baseWorkspaces?: readonly WorkspaceInfo[];
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
  readonly activePackageChangesetsWithoutReleaseFacts: readonly string[];
  readonly changedChangesets: readonly string[];
  readonly contractFacts: readonly ContractReleaseFact[];
  readonly coveredPackages: readonly string[];
  readonly errors: readonly string[];
  readonly matchedRuleIds: readonly string[];
  readonly noReleaseOverride: boolean;
  readonly packageRouteFacts: readonly PackageRouteReleaseFact[];
  readonly passed: boolean;
  /** Compatibility alias for the existing GitHub label and package script. */
  readonly releaseNone: boolean;
  readonly uncoveredContractFacts: readonly ContractReleaseFact[];
  readonly versionRelease: boolean;
}

interface CliOptions {
  readonly baseRef?: string;
  readonly changedFilesPath?: string;
  readonly configPath?: string;
  readonly releaseNone: boolean;
  readonly repoRoot: string;
}

export interface ReleaseConfigLoadResult {
  readonly config?: ReleaseConfigInput | undefined;
  readonly configPath?: string | undefined;
}

export interface RunReleaseCheckOptions {
  readonly baseRef?: string;
  readonly changedFilesPath?: string;
  readonly configPath?: string;
  readonly env?: Record<string, string | undefined>;
  readonly releaseNone?: boolean;
  readonly repoRoot: string;
}

export interface ReleaseCheckReport extends ReleaseCheckResult {
  readonly configPath?: string;
  readonly formatted: string;
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
  path.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');

const normalizeWorkspacePattern = (pattern: string): string =>
  normalizePath(pattern) || '.';

const hasWorkspaceGlobSyntax = (pattern: string): boolean =>
  WORKSPACE_GLOB_SYNTAX_PATTERN.test(pattern);

const isSupportedWorkspacePattern = (pattern: string): boolean =>
  !hasWorkspaceGlobSyntax(pattern) ||
  (pattern.endsWith('/*') && !hasWorkspaceGlobSyntax(pattern.slice(0, -2)));

const unsupportedWorkspacePatternError = (pattern: string): string =>
  `Unsupported workspace pattern '${pattern}'. The release check supports exact workspace paths and one-level '/*' globs.`;

const readJson = async <T>(path: string): Promise<T> =>
  (await Bun.file(path).json()) as T;

const discoverWorkspaceDirs = async (
  repoRoot: string,
  patterns: readonly string[]
): Promise<string[]> => {
  const dirs: string[] = [];

  for (const pattern of patterns) {
    if (!isSupportedWorkspacePattern(pattern)) {
      throw new Error(unsupportedWorkspacePatternError(pattern));
    }

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
    return [];
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

interface BaseWorkspaceDiscovery {
  readonly error?: string;
  readonly workspaces: readonly WorkspaceInfo[];
}

const baseWorkspaceReadError = (baseRef: string): string =>
  `Release check could not read the base workspace inventory from '${baseRef}'. Fetch or provide a valid --base-ref before checking package routes.`;

const discoverBaseWorkspaces = (
  repoRoot: string,
  baseRef: string | undefined
): BaseWorkspaceDiscovery => {
  if (baseRef === undefined) {
    return { workspaces: [] };
  }

  const root = Bun.spawnSync({
    cmd: ['git', 'show', `${baseRef}:package.json`],
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (root.exitCode !== 0) {
    return { error: baseWorkspaceReadError(baseRef), workspaces: [] };
  }
  const workspacePatterns = (
    JSON.parse(root.stdout.toString()) as PackageJson
  ).workspaces?.map(normalizeWorkspacePattern);
  if (!workspacePatterns || workspacePatterns.length === 0) {
    return { workspaces: [] };
  }
  const unsupportedPattern = workspacePatterns.find(
    (pattern) => !isSupportedWorkspacePattern(pattern)
  );
  if (unsupportedPattern) {
    return {
      error: unsupportedWorkspacePatternError(unsupportedPattern),
      workspaces: [],
    };
  }

  const listed = Bun.spawnSync({
    cmd: ['git', 'ls-tree', '-r', '--name-only', baseRef],
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (listed.exitCode !== 0) {
    return { error: baseWorkspaceReadError(baseRef), workspaces: [] };
  }

  const workspaces: WorkspaceInfo[] = [];
  for (const relativePath of listed.stdout.toString().split(/\r?\n/u)) {
    if (
      !relativePath.endsWith('/package.json') &&
      relativePath !== 'package.json'
    ) {
      continue;
    }
    const workspacePath =
      relativePath === 'package.json'
        ? '.'
        : normalizePath(relativePath.replace(/\/package\.json$/u, ''));
    const isWorkspace = workspacePatterns.some(
      (pattern) =>
        pattern === workspacePath ||
        (pattern.endsWith('/*') &&
          workspacePath.startsWith(pattern.slice(0, -1)) &&
          !workspacePath.slice(pattern.length - 1).includes('/'))
    );
    if (!isWorkspace) {
      continue;
    }
    const shown = Bun.spawnSync({
      cmd: ['git', 'show', `${baseRef}:${relativePath}`],
      cwd: repoRoot,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    if (shown.exitCode !== 0) {
      return { error: baseWorkspaceReadError(baseRef), workspaces: [] };
    }
    const pkg = JSON.parse(shown.stdout.toString()) as PackageJson;
    if (!pkg.name) {
      continue;
    }
    workspaces.push({
      isPrivate: pkg.private === true,
      name: pkg.name,
      relativePath: workspacePath,
    });
  }
  return {
    workspaces: workspaces.toSorted((left, right) =>
      left.name.localeCompare(right.name)
    ),
  };
};

const resolveBaseWorkspaceInput = (
  input: ReleaseCheckInput
): BaseWorkspaceDiscovery => {
  if (input.baseWorkspaces !== undefined) {
    return {
      ...(input.baseWorkspaceError === undefined
        ? {}
        : { error: input.baseWorkspaceError }),
      workspaces: input.baseWorkspaces,
    };
  }

  const discovered = discoverBaseWorkspaces(input.repoRoot, input.baseRef);
  const error = input.baseWorkspaceError ?? discovered.error;

  return {
    ...(error === undefined ? {} : { error }),
    workspaces: discovered.workspaces,
  };
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

const readBaseChangeset = (
  repoRoot: string,
  baseRef: string | undefined,
  path: string
): string | null => {
  if (baseRef === undefined) {
    return null;
  }

  const result = Bun.spawnSync({
    cmd: ['git', 'show', `${baseRef}:${path}`],
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  return result.exitCode === 0 ? result.stdout.toString() : null;
};

const removeChangesetPackageRows = (
  content: string,
  packages: ReadonlySet<string>
): string => {
  let insideFrontmatter = false;

  return content
    .split('\n')
    .filter((line, index) => {
      const normalizedLine = line.replace(/\r$/u, '');

      if (normalizedLine === '---') {
        insideFrontmatter = index === 0;
        return true;
      }

      if (!insideFrontmatter) {
        return true;
      }

      const packageName = normalizedLine.match(CHANGESET_PACKAGE_PATTERN)?.[1];
      return packageName === undefined || !packages.has(packageName);
    })
    .join('\n');
};

const findRetiredPackageChangesetCleanups = (
  changedChangesetPaths: readonly string[],
  input: ReleaseCheckInput
): readonly string[] => {
  const workspaceNames = new Set(
    input.workspaces.map((workspace) => workspace.name)
  );

  return changedChangesetPaths.filter((path) => {
    const absolutePath = join(input.repoRoot, path);
    if (!existsSync(absolutePath)) {
      return false;
    }

    const baseContent = readBaseChangeset(input.repoRoot, input.baseRef, path);
    if (baseContent === null) {
      return false;
    }

    const retiredPackages = new Set(
      parseChangesetPackages(baseContent).filter(
        (packageName) => !workspaceNames.has(packageName)
      )
    );

    return (
      retiredPackages.size > 0 &&
      removeChangesetPackageRows(baseContent, retiredPackages) ===
        readFileSync(absolutePath, 'utf8')
    );
  });
};

const findChangedChangesetPaths = (
  changedFiles: readonly string[]
): readonly string[] =>
  changedFiles
    .map(normalizePath)
    .filter((path) => CHANGESET_PATH_PATTERN.test(path));

const findActiveChangedChangesetPaths = (
  changedFiles: readonly string[],
  repoRoot: string
): readonly string[] =>
  findChangedChangesetPaths(changedFiles).filter((path) =>
    existsSync(join(repoRoot, path))
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

const findPackageRouteRuleErrors = ({
  coveredPackages,
  packageRoute,
  requiresPackageRoute,
}: {
  readonly coveredPackages: readonly string[];
  readonly packageRoute: ReturnType<typeof findPackageRouteReleaseFacts>;
  readonly requiresPackageRoute: boolean;
}): readonly string[] => {
  if (!requiresPackageRoute) {
    return [];
  }

  const errors = packageRoute.diagnostics.map(
    (diagnostic) => diagnostic.message
  );

  const uncoveredIntents = packageRoute.intents.filter(
    (intent) =>
      !intent.eligiblePackages.some((packageName) =>
        coveredPackages.includes(packageName)
      )
  );

  if (uncoveredIntents.length > 0) {
    errors.push(
      `Public package route changesets must cover a surviving owner: ${uncoveredIntents
        .map((intent) => intent.sourcePackage)
        .join(', ')}`
    );
  }

  return errors;
};

export const checkReleaseRules = (
  input: ReleaseCheckInput
): ReleaseCheckResult => {
  const baseWorkspaceInput = resolveBaseWorkspaceInput(input);
  const noReleaseOverride =
    input.noReleaseOverride === true || input.releaseNone === true;
  const affectedPackages = findAffectedPackages(
    input.changedFiles,
    input.workspaces
  );
  const changedChangesets = findChangedChangesetPaths(input.changedFiles);
  const activeChangedChangesets = findActiveChangedChangesetPaths(
    input.changedFiles,
    input.repoRoot
  );
  const retiredPackageChangesetCleanups = new Set(
    findRetiredPackageChangesetCleanups(changedChangesets, input)
  );
  const changesets = findChangedChangesets(changedChangesets, input.repoRoot);
  const coveredPackages = [
    ...new Set(changesets.flatMap((changeset) => changeset.packages)),
  ].toSorted();
  const contractFacts = findGateContractFacts(input);
  const packageRoute = findPackageRouteReleaseFacts({
    baseWorkspaces: baseWorkspaceInput.workspaces,
    workspaces: input.workspaces,
  });
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
  const hasReleaseFacts =
    affectedPackages.length > 0 ||
    contractFacts.length > 0 ||
    packageRoute.facts.length > 0 ||
    versionRelease;
  const activePackageChangesetsWithoutReleaseFacts =
    activeChangedChangesets.length > 0 && !hasReleaseFacts
      ? activeChangedChangesets.filter(
          (path) => !retiredPackageChangesetCleanups.has(path)
        )
      : [];
  const matchedRuleIds = findMatchedRuleIds(input);
  const requiresPackageIntent = ruleMatchesFactType(input, 'package-content');
  const requiresPublicContractIntent = ruleMatchesFactType(
    input,
    'public-trail-contract'
  );
  const requiresPackageRoute = ruleMatchesFactType(
    input,
    'public-package-route'
  );
  const errors: string[] = [];

  if (baseWorkspaceInput.error) {
    errors.push(baseWorkspaceInput.error);
  }

  if (noReleaseOverride && changedChangesets.length > 0) {
    errors.push(
      '`release:none` conflicts with changed changeset files. Remove the label or the changeset.'
    );
  }

  if (activePackageChangesetsWithoutReleaseFacts.length > 0) {
    errors.push(
      `Active changesets require a matching package or release fact on this branch. Remove ${activePackageChangesetsWithoutReleaseFacts.join(', ')} or include the package-facing change here.`
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

  errors.push(
    ...findPackageRouteRuleErrors({
      coveredPackages,
      packageRoute,
      requiresPackageRoute,
    })
  );

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
    activePackageChangesetsWithoutReleaseFacts,
    affectedPackages,
    changedChangesets,
    contractFacts,
    coveredPackages,
    errors,
    matchedRuleIds,
    noReleaseOverride,
    packageRouteFacts: packageRoute.facts,
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

const hasGitRef = (repoRoot: string, ref: string): boolean => {
  const result = Bun.spawnSync({
    cmd: ['git', 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  return result.exitCode === 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

interface ResultLike {
  readonly error?: unknown;
  readonly value?: unknown;
  isErr(): boolean;
  isOk(): boolean;
}

const isResultLike = (value: unknown): value is ResultLike =>
  isRecord(value) &&
  typeof value['isOk'] === 'function' &&
  typeof value['isErr'] === 'function';

interface ResolvableConfig {
  resolve(options: {
    readonly cwd: string;
    readonly env: Record<string, string | undefined>;
  }): Promise<unknown>;
}

const isResolvableConfig = (value: unknown): value is ResolvableConfig =>
  isRecord(value) && typeof value['resolve'] === 'function';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const findConfigPath = (
  repoRoot: string,
  configPath: string | undefined
): string | undefined => {
  if (configPath !== undefined) {
    const resolvedPath = resolve(repoRoot, configPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Release config file not found: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  return undefined;
};

const extractReleaseConfig = (value: unknown): ReleaseConfigInput | undefined =>
  isRecord(value) && 'release' in value
    ? (value['release'] as ReleaseConfigInput)
    : undefined;

export const loadReleaseConfig = async ({
  configPath,
  env = {},
  repoRoot,
}: {
  readonly configPath?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly repoRoot: string;
}): Promise<ReleaseConfigLoadResult> => {
  const locatedConfigPath = findConfigPath(repoRoot, configPath);
  if (configPath !== undefined && locatedConfigPath === undefined) {
    return {};
  }

  try {
    const loaded = await loadTrailsConfigValue({
      configPath,
      rootDir: repoRoot,
    });
    const exported = loaded.value;
    if (exported === undefined) {
      return {};
    }

    if (isResolvableConfig(exported)) {
      const resolved = await exported.resolve({ cwd: repoRoot, env });
      if (isResultLike(resolved)) {
        if (resolved.isOk()) {
          return {
            config: extractReleaseConfig(resolved.value),
            configPath: loaded.configPath,
          };
        }
        throw new Error(
          `Failed to resolve release config: ${errorMessage(resolved.error)}`
        );
      }

      return {
        config: extractReleaseConfig(resolved),
        configPath: loaded.configPath,
      };
    }

    return {
      config: extractReleaseConfig(exported),
      configPath: loaded.configPath,
    };
  } catch (error) {
    throw new Error(`Failed to load release config: ${errorMessage(error)}`, {
      cause: error,
    });
  }
};

const parseArgs = (args: readonly string[]): CliOptions => {
  let baseRef: string | undefined;
  let changedFilesPath: string | undefined;
  let configPath: string | undefined;
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

    if (arg === '--config-path') {
      const value = args[index + 1];

      if (!value) {
        throw new Error('--config-path requires a config file path');
      }

      configPath = value;
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
    ...(configPath === undefined ? {} : { configPath }),
    releaseNone,
    repoRoot,
  };
};

export const formatReleaseCheckReport = (
  result: ReleaseCheckResult
): string => {
  const lines: string[] = [];

  if (result.passed) {
    if (result.affectedPackages.length === 0) {
      lines.push(
        'Release check passed: no publishable package content files changed.'
      );
      return lines.join('\n');
    }

    if (result.noReleaseOverride) {
      lines.push(
        `Release check passed via release:none override for: ${result.affectedPackages.join(', ')}`
      );
      return lines.join('\n');
    }

    if (result.versionRelease) {
      lines.push(
        `Release check passed for generated version release: ${result.affectedPackages.join(', ')}`
      );
      return lines.join('\n');
    }

    lines.push(
      `Release check passed for: ${result.affectedPackages.join(', ')}`
    );
    lines.push(`Changed changesets: ${result.changedChangesets.join(', ')}`);
    return lines.join('\n');
  }

  for (const error of result.errors) {
    lines.push(error);
  }

  if (result.affectedPackages.length > 0) {
    lines.push(`Affected packages: ${result.affectedPackages.join(', ')}`);
  }

  if (result.contractFacts.length > 0) {
    lines.push(
      `Public trail contract facts: ${result.contractFacts
        .map(formatContractFact)
        .join(', ')}`
    );
  }

  if (result.changedChangesets.length > 0) {
    lines.push(`Changed changesets: ${result.changedChangesets.join(', ')}`);
  }

  return lines.join('\n');
};

const renderResult = (result: ReleaseCheckResult): void => {
  const formatted = formatReleaseCheckReport(result);
  if (formatted.length === 0) {
    return;
  }

  if (result.passed) {
    console.log(formatted);
    return;
  }

  console.error(formatted);
};

export const runReleaseCheck = async (
  options: RunReleaseCheckOptions
): Promise<ReleaseCheckReport> => {
  const workspaces = await discoverWorkspaces(options.repoRoot);
  const changedFilesBaseError =
    options.changedFilesPath !== undefined && options.baseRef === undefined
      ? 'Release check requires --base-ref when --changed-files is used.'
      : undefined;
  const baseRef =
    options.baseRef ??
    (options.changedFilesPath === undefined &&
    (workspaces.length > 0 || hasGitRef(options.repoRoot, 'origin/main'))
      ? 'origin/main'
      : undefined);
  let changedFiles: readonly string[];

  if (options.changedFilesPath !== undefined) {
    changedFiles = readChangedFiles(options.changedFilesPath);
  } else if (workspaces.length > 0) {
    changedFiles = readLocalChangedFiles(
      options.repoRoot,
      baseRef ?? 'origin/main'
    );
  } else {
    changedFiles = [];
  }

  const loadedConfig = await loadReleaseConfig({
    ...(options.configPath === undefined
      ? {}
      : { configPath: options.configPath }),
    env: options.env,
    repoRoot: options.repoRoot,
  });
  const baseWorkspaceDiscovery = discoverBaseWorkspaces(
    options.repoRoot,
    baseRef
  );
  const baseWorkspaceError =
    changedFilesBaseError ?? baseWorkspaceDiscovery.error;
  const result = checkReleaseRules({
    ...(baseRef === undefined ? {} : { baseRef }),
    ...(baseWorkspaceError === undefined ? {} : { baseWorkspaceError }),
    baseWorkspaces: baseWorkspaceDiscovery.workspaces,
    changedFiles,
    ...(loadedConfig.config === undefined
      ? {}
      : { releaseConfig: loadedConfig.config }),
    releaseNone: options.releaseNone === true,
    repoRoot: options.repoRoot,
    workspaces,
  });

  return {
    ...result,
    ...(loadedConfig.configPath === undefined
      ? {}
      : { configPath: loadedConfig.configPath }),
    formatted: formatReleaseCheckReport(result),
  };
};

export const runReleaseCheckCli = async (
  args: readonly string[]
): Promise<number> => {
  const options = parseArgs(args);
  const result = await runReleaseCheck({
    ...(options.baseRef === undefined ? {} : { baseRef: options.baseRef }),
    ...(options.changedFilesPath === undefined
      ? {}
      : { changedFilesPath: options.changedFilesPath }),
    ...(options.configPath === undefined
      ? {}
      : { configPath: options.configPath }),
    env: process.env as Record<string, string | undefined>,
    releaseNone: options.releaseNone,
    repoRoot: options.repoRoot,
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
