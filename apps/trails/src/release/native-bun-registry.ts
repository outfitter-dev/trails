import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { compareSemver } from './semver.js';
import { isInitialZeroLineRegistryTransition } from './zero-line-transition.js';

const REPO_ROOT = resolve(process.cwd());
const SUMMARY_DIST_TAGS = ['latest', 'beta'] as const;
/** Bound concurrent npm probes so release checks stay responsive on large workspaces. */
const PROBE_CONCURRENCY = 8;

/** Phase of a registry check: pre-publish readiness vs post-publish verification. */
export type RegistryCheckPhase = 'published' | 'ready';

export interface RegistryPreflightOptions {
  readonly requirePublished: boolean;
  readonly tag: string | undefined;
}

interface PackageJson {
  readonly name?: string;
  readonly private?: boolean;
  readonly version?: string;
}

export interface RegistryWorkspace {
  readonly name: string;
  readonly path: string;
  readonly version: string;
}

interface NpmView {
  readonly name?: string;
  readonly version?: string;
  readonly 'dist-tags'?: Record<string, string>;
}

export type RegistryResult =
  | {
      readonly distTags: Record<string, string>;
      readonly expectedTagVersion: string | undefined;
      readonly name: string;
      readonly status: 'published';
      readonly version: string;
      readonly versionPublished: boolean | undefined;
      readonly versionProof?: RegistryVersionProof | undefined;
      readonly workspaceVersion: string;
    }
  | {
      readonly name: string;
      readonly status: 'missing';
      readonly workspaceVersion: string;
    }
  | {
      readonly error: string;
      readonly name: string;
      readonly status: 'inaccessible';
      readonly workspaceVersion: string;
    };

/**
 * The single source of truth for what a package's registry state means for a
 * release. Both the release policy engine and the registry preflight derive
 * verdicts from this, so they cannot drift.
 */
export type PackageRegistryState =
  | { readonly kind: 'complete' }
  | { readonly kind: 'needs-publish' }
  | { readonly kind: 'first-time-package' }
  | {
      readonly kind: 'needs-tag-repair';
      readonly currentTagVersion: string | undefined;
    }
  | { readonly kind: 'tag-points-ahead'; readonly currentTagVersion: string }
  | { readonly kind: 'registry-inaccessible'; readonly error: string };

/** Minimal facts the classifier needs, mappable from any registry probe shape. */
export interface PackageRegistryFacts {
  readonly expectedTag?: string | undefined;
  readonly status: 'inaccessible' | 'missing' | 'published';
  readonly name?: string | undefined;
  readonly targetVersion: string;
  readonly expectedTagVersion: string | undefined;
  readonly versionPublished: boolean | undefined;
  readonly error?: string | undefined;
}

/** Consumer-facing evidence for an exact package version. */
export type RegistryVersionProof =
  | { readonly kind: 'consumer-pack'; readonly published: true }
  | { readonly kind: 'exact-metadata'; readonly published: true }
  | { readonly kind: 'unavailable'; readonly published: false };

/**
 * Classify a package's registry state from two orthogonal facts — whether the
 * target version is published, and where the dist-tag points relative to it —
 * plus reachability. Members are mutually exclusive by construction.
 *
 * `complete` requires affirmative consumer proof. A matching dist-tag cannot
 * substitute for exact-version metadata or an equivalent package fetch.
 * `undefined` means the consumer probe was not run, including compatibility
 * callers that supply an injected registry view without a version probe.
 */
export const classifyPackageRegistryState = (
  facts: PackageRegistryFacts
): PackageRegistryState => {
  if (facts.status === 'inaccessible') {
    return {
      error: facts.error ?? 'registry probe failed',
      kind: 'registry-inaccessible',
    };
  }
  if (facts.status === 'missing') {
    return { kind: 'first-time-package' };
  }

  const { expectedTagVersion, targetVersion, versionPublished } = facts;
  const tagAtTarget = expectedTagVersion === targetVersion;
  const tagAhead =
    expectedTagVersion !== undefined &&
    !tagAtTarget &&
    compareSemver(expectedTagVersion, targetVersion) > 0 &&
    !isInitialZeroLineRegistryTransition({
      currentTagVersion: expectedTagVersion,
      expectedTag: facts.expectedTag,
      name: facts.name,
      targetVersion,
    });

  if (tagAhead) {
    return { currentTagVersion: expectedTagVersion, kind: 'tag-points-ahead' };
  }
  if (tagAtTarget) {
    return versionPublished === true
      ? { kind: 'complete' }
      : { kind: 'needs-publish' };
  }
  if (versionPublished === true) {
    return { currentTagVersion: expectedTagVersion, kind: 'needs-tag-repair' };
  }
  return { kind: 'needs-publish' };
};

/** Map a registry probe result into the classifier's fact shape. */
export const factsFromRegistryResult = (
  result: RegistryResult,
  expectedTag?: string
): PackageRegistryFacts => {
  if (result.status === 'published') {
    return {
      expectedTag,
      expectedTagVersion: result.expectedTagVersion,
      name: result.name,
      status: 'published',
      targetVersion: result.workspaceVersion,
      versionPublished:
        result.versionProof?.published ?? result.versionPublished,
    };
  }
  if (result.status === 'inaccessible') {
    return {
      error: result.error,
      expectedTag,
      expectedTagVersion: undefined,
      name: result.name,
      status: 'inaccessible',
      targetVersion: result.workspaceVersion,
      versionPublished: false,
    };
  }
  return {
    expectedTag,
    expectedTagVersion: undefined,
    name: result.name,
    status: 'missing',
    targetVersion: result.workspaceVersion,
    versionPublished: false,
  };
};

const readJson = async <T>(path: string): Promise<T> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }
  return (await file.json()) as T;
};

const errorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error as { readonly code?: unknown };
  return typeof code === 'string' ? code : undefined;
};

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
        names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch (error) {
        if (errorCode(error) === 'ENOENT') {
          continue;
        }
        throw new Error(
          `Unable to read workspace directory ${relative(repoRoot, parent)}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        );
      }
      for (const name of names) {
        const dir = join(parent, name);
        if (await Bun.file(join(dir, 'package.json')).exists()) {
          dirs.push(dir);
        }
      }
    } else {
      const dir = join(repoRoot, pattern);
      if (await Bun.file(join(dir, 'package.json')).exists()) {
        dirs.push(dir);
      }
    }
  }
  return dirs;
};

export const discoverRegistryWorkspaces = async (
  repoRoot = REPO_ROOT
): Promise<RegistryWorkspace[]> => {
  const root = await readJson<{ workspaces?: string[] }>(
    join(repoRoot, 'package.json')
  );
  const dirs = await discoverWorkspaceDirs(repoRoot, root.workspaces ?? []);
  const workspaces: RegistryWorkspace[] = [];

  for (const dir of dirs) {
    const pkg = await readJson<PackageJson>(join(dir, 'package.json'));
    if (
      pkg.private === true ||
      typeof pkg.name !== 'string' ||
      !pkg.name.startsWith('@ontrails/') ||
      typeof pkg.version !== 'string'
    ) {
      continue;
    }
    workspaces.push({
      name: pkg.name,
      path: relative(repoRoot, dir),
      version: pkg.version,
    });
  }

  return workspaces.toSorted((a, b) => a.name.localeCompare(b.name));
};

export type RegistryView = (name: string) => Promise<NpmView | null>;

export interface NpmCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export type NpmCommandRunner = (
  args: readonly string[]
) => Promise<NpmCommandResult>;

const readSpawnResult = async (
  proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
): Promise<NpmCommandResult> => {
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
};

/** Run a read-only npm registry command, aborting its subprocess at the verification deadline. */
export const runNpmRegistryCommand = async (
  args: readonly string[],
  signal?: AbortSignal
): Promise<NpmCommandResult> => {
  signal?.throwIfAborted();
  return readSpawnResult(
    Bun.spawn(['npm', ...args], {
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
      ...(signal === undefined ? {} : { killSignal: 'SIGKILL', signal }),
    })
  );
};

const isNpmNotFoundOutput = (stdout: string, stderr: string): boolean => {
  const combined = `${stdout}\n${stderr}`;
  return combined.includes('E404') || combined.includes('404 Not Found');
};

const isNpmUnauthorizedOutput = (stdout: string, stderr: string): boolean => {
  const combined = `${stdout}\n${stderr}`;
  return combined.includes('E401') || combined.includes('401 Unauthorized');
};

const isNpmExactVersionMissingOutput = (
  stdout: string,
  stderr: string
): boolean => {
  const combined = `${stdout}\n${stderr}`;
  return (
    combined.includes('ETARGET') ||
    combined.includes('No matching version found')
  );
};

export const parseNpmDistTagListOutput = (
  stdout: string
): Record<string, string> => {
  const distTags: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const separator = trimmed.indexOf(':');
    if (separator < 1) {
      continue;
    }
    const tag = trimmed.slice(0, separator).trim();
    const version = trimmed.slice(separator + 1).trim();
    if (tag.length > 0 && version.length > 0) {
      distTags[tag] = version;
    }
  }
  return distTags;
};

export const parseNpmPackDryRunPublishedVersion = (
  stdout: string,
  name: string,
  version: string
): boolean => {
  const parsed = JSON.parse(stdout.trim()) as unknown;
  if (!Array.isArray(parsed)) {
    return false;
  }
  return parsed.some((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }
    const candidate = entry as {
      readonly id?: unknown;
      readonly name?: unknown;
      readonly version?: unknown;
    };
    return (
      candidate.id === `${name}@${version}` ||
      (candidate.name === name && candidate.version === version)
    );
  });
};

const npmDistTagRegistryView = async (
  name: string,
  runNpm: NpmCommandRunner
): Promise<NpmView | null> => {
  const { exitCode, stderr, stdout } = await runNpm(['dist-tag', 'ls', name]);
  if (exitCode !== 0) {
    // npm returns E401 for the dist-tag endpoint of an unpublished scoped
    // package, even though the preceding package view returned E404. At this
    // fallback boundary both responses mean the package does not exist yet.
    if (
      isNpmNotFoundOutput(stdout, stderr) ||
      isNpmUnauthorizedOutput(stdout, stderr)
    ) {
      return null;
    }
    throw new Error(stderr.trim() || `npm dist-tag ls failed for ${name}`);
  }

  const distTags = parseNpmDistTagListOutput(stdout);
  const version =
    distTags['latest'] ?? distTags['beta'] ?? Object.values(distTags)[0];
  if (version === undefined) {
    return null;
  }
  return { 'dist-tags': distTags, name, version };
};

export const createNpmRegistryView =
  (runNpm: NpmCommandRunner = runNpmRegistryCommand): RegistryView =>
  async (name) => {
    const { exitCode, stderr, stdout } = await runNpm([
      'view',
      name,
      'name',
      'version',
      'dist-tags',
      '--json',
    ]);

    if (exitCode === 0) {
      return JSON.parse(stdout) as NpmView;
    }
    if (isNpmNotFoundOutput(stdout, stderr)) {
      return npmDistTagRegistryView(name, runNpm);
    }
    throw new Error(stderr.trim() || `npm view failed for ${name}`);
  };

export const npmRegistryView: RegistryView = createNpmRegistryView();

/** Probe whether an exact `name@version` is published. The missing fact that
 * a tag/version summary alone cannot answer. */
export type RegistryVersionView = (
  name: string,
  version: string
) => Promise<boolean | undefined>;

/** Probe with evidence that distinguishes metadata from package fetch proof. */
export type RegistryVersionProofView = (
  name: string,
  version: string
) => Promise<RegistryVersionProof>;

export type RegistryVersionProbeView = (
  name: string,
  version: string
) => Promise<boolean | RegistryVersionProof | undefined>;

const UNKNOWN_REGISTRY_VERSION_STATE: { readonly published?: boolean } = {};
const unknownRegistryVersionView: RegistryVersionView = async () =>
  UNKNOWN_REGISTRY_VERSION_STATE.published;

export const createNpmRegistryVersionProofView =
  (
    runNpm: NpmCommandRunner = runNpmRegistryCommand
  ): RegistryVersionProofView =>
  async (name, version) => {
    const { exitCode, stderr, stdout } = await runNpm([
      'view',
      `${name}@${version}`,
      'version',
      '--json',
    ]);

    if (exitCode === 0) {
      return JSON.parse(stdout.trim()) === version
        ? { kind: 'exact-metadata', published: true }
        : { kind: 'unavailable', published: false };
    }
    if (
      !isNpmExactVersionMissingOutput(stdout, stderr) &&
      !isNpmNotFoundOutput(stdout, stderr)
    ) {
      throw new Error(
        stderr.trim() || `npm view failed for ${name}@${version}`
      );
    }

    const packResult = await runNpm([
      'pack',
      `${name}@${version}`,
      '--dry-run',
      '--json',
    ]);
    if (packResult.exitCode === 0) {
      return parseNpmPackDryRunPublishedVersion(
        packResult.stdout,
        name,
        version
      )
        ? { kind: 'consumer-pack', published: true }
        : { kind: 'unavailable', published: false };
    }
    if (isNpmExactVersionMissingOutput(packResult.stdout, packResult.stderr)) {
      return { kind: 'unavailable', published: false };
    }
    if (isNpmNotFoundOutput(packResult.stdout, packResult.stderr)) {
      return { kind: 'unavailable', published: false };
    }
    throw new Error(
      packResult.stderr.trim() || `npm pack failed for ${name}@${version}`
    );
  };

export const createNpmRegistryVersionView = (
  runNpm: NpmCommandRunner = runNpmRegistryCommand
): RegistryVersionView => {
  const proofView = createNpmRegistryVersionProofView(runNpm);
  return async (name, version) => {
    const proof = await proofView(name, version);
    return proof.published;
  };
};

export const npmRegistryVersionView: RegistryVersionView =
  createNpmRegistryVersionView();
export const npmRegistryVersionProofView: RegistryVersionProofView =
  createNpmRegistryVersionProofView();

/** Run async tasks with a bounded number in flight, preserving input order. */
const mapBounded = async <T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
};

const checkWorkspaceRegistryPosture = async (
  workspace: RegistryWorkspace,
  view: RegistryView,
  versionView: RegistryVersionProbeView,
  expectedTag: string
): Promise<RegistryResult> => {
  try {
    const registry = await view(workspace.name);
    if (!registry) {
      return {
        name: workspace.name,
        status: 'missing',
        workspaceVersion: workspace.version,
      };
    }
    const distTags = registry['dist-tags'] ?? {};
    const versionProbe = await versionView(workspace.name, workspace.version);
    const versionProof =
      typeof versionProbe === 'object' ? versionProbe : undefined;
    const versionPublished =
      typeof versionProbe === 'object' ? versionProbe.published : versionProbe;
    return {
      distTags,
      expectedTagVersion: distTags[expectedTag],
      name: workspace.name,
      status: 'published',
      version: registry.version ?? '(unknown)',
      ...(versionProof === undefined ? {} : { versionProof }),
      versionPublished,
      workspaceVersion: workspace.version,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      name: workspace.name,
      status: 'inaccessible',
      workspaceVersion: workspace.version,
    };
  }
};

type CheckRegistryPostureArgs =
  | readonly [versionView: RegistryVersionProbeView, expectedTag: string]
  | readonly [expectedTag: string];

const normalizeCheckRegistryPostureArgs = (
  args: CheckRegistryPostureArgs
): {
  readonly expectedTag: string;
  readonly versionView: RegistryVersionProbeView;
} => {
  if (args.length === 1) {
    return { expectedTag: args[0], versionView: unknownRegistryVersionView };
  }
  return { expectedTag: args[1], versionView: args[0] };
};

export function checkRegistryPosture(
  workspaces: readonly RegistryWorkspace[],
  view: RegistryView,
  expectedTag: string
): Promise<RegistryResult[]>;
export function checkRegistryPosture(
  workspaces: readonly RegistryWorkspace[],
  view: RegistryView,
  versionView: RegistryVersionProbeView,
  expectedTag: string
): Promise<RegistryResult[]>;
export async function checkRegistryPosture(
  workspaces: readonly RegistryWorkspace[],
  view: RegistryView,
  ...args: CheckRegistryPostureArgs
): Promise<RegistryResult[]> {
  const { expectedTag, versionView } = normalizeCheckRegistryPostureArgs(args);
  return mapBounded(workspaces, PROBE_CONCURRENCY, (workspace) =>
    checkWorkspaceRegistryPosture(workspace, view, versionView, expectedTag)
  );
}

/**
 * Phase-aware registry errors, derived from the shared classifier.
 *
 * `ready` (pre-publish): only a tag pointing *ahead* of the target or an
 * inaccessible registry is an error. A behind tag or an unpublished target is
 * the expected state before publish runs, not a failure.
 *
 * `published` (post-publish): every package must be `complete`.
 */
const normalizeRegistryCheckPhase = (
  phaseOrRequirePublished: boolean | RegistryCheckPhase
): RegistryCheckPhase => {
  if (typeof phaseOrRequirePublished !== 'boolean') {
    return phaseOrRequirePublished;
  }
  return phaseOrRequirePublished ? 'published' : 'ready';
};

const targetVersionFailure = (result: RegistryResult): string => {
  if (result.status !== 'published') {
    return 'is not published';
  }
  if (result.versionProof?.kind === 'unavailable') {
    return 'lacks exact-version metadata and consumer pack proof';
  }
  if (result.versionPublished === undefined) {
    return 'publish state was not probed';
  }
  return 'is not published';
};

export const registryPostureErrors = (
  results: readonly RegistryResult[],
  expectedTag: string,
  phaseOrRequirePublished: boolean | RegistryCheckPhase
): string[] => {
  const phase = normalizeRegistryCheckPhase(phaseOrRequirePublished);
  const errors: string[] = [];
  for (const result of results) {
    const state = classifyPackageRegistryState(
      factsFromRegistryResult(result, expectedTag)
    );
    if (state.kind === 'registry-inaccessible') {
      errors.push(`${result.name}: registry probe failed: ${state.error}`);
      continue;
    }
    if (state.kind === 'tag-points-ahead') {
      errors.push(
        `${result.name}: dist-tag ${expectedTag} points to ${state.currentTagVersion}, which is newer than target ${result.workspaceVersion}`
      );
      continue;
    }
    if (phase === 'ready' || state.kind === 'complete') {
      continue;
    }
    if (state.kind === 'first-time-package') {
      errors.push(`${result.name}: package is missing from the registry`);
    } else if (state.kind === 'needs-publish') {
      errors.push(
        `${result.name}: target version ${result.workspaceVersion} ${targetVersionFailure(result)}`
      );
    } else if (state.kind === 'needs-tag-repair') {
      errors.push(
        `${result.name}: needs dist-tag update — ${expectedTag} points to ${state.currentTagVersion ?? '(missing)'}, target ${result.workspaceVersion}`
      );
    }
  }
  return errors;
};

export const formatDistTagSummary = (
  distTags: Readonly<Record<string, string>>
): string =>
  SUMMARY_DIST_TAGS.map((tag) => `${tag}=${distTags[tag] ?? 'missing'}`).join(
    ', '
  );
