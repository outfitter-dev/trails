#!/usr/bin/env bun
/* oxlint-disable max-statements -- release preflight CLI with explicit reporting */
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const SUMMARY_DIST_TAGS = ['latest', 'beta'] as const;

interface Options {
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

const USAGE = `Usage: bun scripts/check-registry-preflight.ts [options]

Read-only npm registry preflight for public @ontrails/* workspaces.

Options:
  --tag <tag>            Expected npm dist-tag. Defaults to .changeset/pre.json
                         tag while in prerelease mode, otherwise "latest".
  --require-published    Fail when any workspace package is missing from npm.
                         Use after publication to verify every package exists.
  -h, --help             Show this help and exit.

Exit codes: 0 success, 1 registry posture failure, 2 arg-parse error.`;

const parseArgs = (argv: readonly string[]): Options => {
  let requirePublished = false;
  let tag: string | undefined;

  const needsValue = (flag: string, value: string | undefined): string => {
    if (value === undefined || value.startsWith('--')) {
      console.error(`${flag} requires a value`);
      console.error(USAGE);
      process.exit(2);
    }
    return value;
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] as string;
    if (arg === '--require-published') {
      requirePublished = true;
    } else if (arg === '--tag') {
      i += 1;
      tag = needsValue('--tag', argv[i]);
    } else if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      console.error(USAGE);
      process.exit(2);
    }
    i += 1;
  }

  return { requirePublished, tag };
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

const resolveDefaultTag = async (): Promise<string> => {
  const prePath = join(REPO_ROOT, '.changeset', 'pre.json');
  if (!(await Bun.file(prePath).exists())) {
    return 'latest';
  }
  const pre = await readJson<{ mode?: string; tag?: string }>(prePath);
  if (pre.mode !== 'pre') {
    return 'latest';
  }
  if (typeof pre.tag === 'string' && pre.tag.length > 0) {
    return pre.tag;
  }
  throw new Error(`${prePath} is in prerelease mode but has no tag`);
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

export const npmRegistryView: RegistryView = async (name) => {
  const proc = Bun.spawn(
    ['npm', 'view', name, 'name', 'version', 'dist-tags', '--json'],
    { stderr: 'pipe', stdin: 'ignore', stdout: 'pipe' }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode === 0) {
    return JSON.parse(stdout) as NpmView;
  }
  const combined = `${stdout}\n${stderr}`;
  if (combined.includes('E404') || combined.includes('404 Not Found')) {
    return null;
  }
  throw new Error(stderr.trim() || `npm view failed for ${name}`);
};

const checkWorkspaceRegistryPosture = async (
  workspace: RegistryWorkspace,
  view: RegistryView,
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
    return {
      distTags,
      expectedTagVersion: distTags[expectedTag],
      name: workspace.name,
      status: 'published',
      version: registry.version ?? '(unknown)',
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

export const checkRegistryPosture = async (
  workspaces: readonly RegistryWorkspace[],
  view: RegistryView,
  expectedTag: string
): Promise<RegistryResult[]> =>
  Promise.all(
    workspaces.map((workspace) =>
      checkWorkspaceRegistryPosture(workspace, view, expectedTag)
    )
  );

export const registryPostureErrors = (
  results: readonly RegistryResult[],
  expectedTag: string,
  requirePublished: boolean
): string[] => {
  const errors: string[] = [];
  for (const result of results) {
    if (result.status === 'inaccessible') {
      errors.push(`${result.name}: registry probe failed: ${result.error}`);
    } else if (result.status === 'missing') {
      if (requirePublished) {
        errors.push(`${result.name}: package is missing from the registry`);
      }
    } else if (result.expectedTagVersion !== result.workspaceVersion) {
      errors.push(
        `${result.name}: dist-tag ${expectedTag} points to ${result.expectedTagVersion ?? '(missing)'}, expected ${result.workspaceVersion}`
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

const printResults = (
  results: readonly RegistryResult[],
  expectedTag: string
): void => {
  console.log(`Registry preflight for dist-tag "${expectedTag}"`);
  for (const result of results) {
    if (result.status === 'published') {
      console.log(
        `✓ ${result.name}@${result.workspaceVersion}: published (registry version ${result.version}, expected ${expectedTag}=${result.expectedTagVersion ?? 'missing'}, tags ${formatDistTagSummary(result.distTags)})`
      );
    } else if (result.status === 'missing') {
      console.log(
        `• ${result.name}@${result.workspaceVersion}: first-time package candidate (not found on registry)`
      );
    } else {
      console.log(`✗ ${result.name}: registry probe failed: ${result.error}`);
    }
  }
};

export const runRegistryPreflight = async (
  options: Options,
  view: RegistryView = npmRegistryView
): Promise<number> => {
  const expectedTag = options.tag ?? (await resolveDefaultTag());
  const workspaces = await discoverRegistryWorkspaces();
  const results = await checkRegistryPosture(workspaces, view, expectedTag);
  printResults(results, expectedTag);
  const errors = registryPostureErrors(
    results,
    expectedTag,
    options.requirePublished
  );
  if (errors.length > 0) {
    console.error('\nRegistry preflight failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return 1;
  }
  console.log('\nRegistry preflight passed.');
  return 0;
};

if (import.meta.main) {
  try {
    process.exit(await runRegistryPreflight(parseArgs(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
