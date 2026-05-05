/**
 * Workspace-wide trail-id index for cross-app resolution.
 *
 * Builds a `{ trailId → appName }` index that lets `trails run <id>` resolve
 * a trail to its owning app without scanning every app's source. The index is
 * either read from a committed workspace lockfile (the cached, fast path) or
 * discovered by walking the workspace's `workspaces` glob, loading each app's
 * topo, and reading its trail ids.
 *
 * @remarks
 * **Boundary.** This module lives in `@ontrails/topographer` because it
 * persists artifacts derived from the resolved graph (per ADR-0042). Cross-app
 * resolution is CLI tooling that reads Topographer artifacts before runtime
 * begins — `@ontrails/core` resolves a single in-memory graph and stays
 * unaware of workspace topology.
 */

import { basename, isAbsolute, join, relative } from 'node:path';

import type { Topo } from '@ontrails/core';

import { readWorkspaceLock } from './io.js';
import type { WorkspaceTrailEntry, WorkspaceTrailIndex } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Loader contract for a single workspace app.
 *
 * Receives the resolved app directory and the workspace root, and returns the
 * loaded `Topo`. The default loader (see {@link defaultLoadTopo}) imports the
 * app's entry module and reads a `default`, `graph`, or `app` export. Tests
 * can substitute their own loader to avoid the dynamic-import dance against a
 * temp directory.
 */
export type WorkspaceTopoLoader = (
  appDir: string,
  workspaceRoot: string,
  entryRelative?: string | undefined
) => Promise<Topo>;

/**
 * Options accepted by {@link buildWorkspaceTrailIndex}.
 */
export interface BuildWorkspaceTrailIndexOptions {
  /** Workspace root (a directory containing a `package.json` with `workspaces`). */
  readonly cwd: string;
  /**
   * Loader for individual app topos. Defaults to {@link defaultLoadTopo} which
   * imports the resolved entry module via `await import()`.
   */
  readonly loadTopo?: WorkspaceTopoLoader;
  /**
   * Lock directory consulted before discovery runs. Defaults to `.trails`
   * relative to `cwd` — matches {@link readWorkspaceLock}'s default.
   */
  readonly lockDir?: string;
}

/**
 * Structured result of building the workspace trail-id index.
 *
 * @remarks
 * `index` is the trail-id-to-app-name map. `source` distinguishes a cache hit
 * (the lockfile already carried `workspaceTrails`) from discovery (apps were
 * walked and loaded). `apps` lists the app names actually represented in the
 * index; `warnings` reports load failures and last-write-wins collisions.
 */
export interface WorkspaceTrailIndexResult {
  readonly index: WorkspaceTrailIndex;
  readonly source: 'lockfile' | 'discovery';
  readonly apps: readonly string[];
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers — package.json reading
// ---------------------------------------------------------------------------

/** A small subset of app `package.json` fields the discovery layer cares about. */
export interface AppManifest {
  readonly name?: string | undefined;
  readonly trails?: { readonly module?: string | undefined } | undefined;
}

export const isAppManifest = (value: unknown): value is AppManifest => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if ('name' in candidate && typeof candidate['name'] !== 'string') {
    return false;
  }
  if ('trails' in candidate) {
    const trailsField = candidate['trails'];
    if (typeof trailsField !== 'object' || trailsField === null) {
      return false;
    }
    const moduleField = (trailsField as Record<string, unknown>)['module'];
    if (moduleField !== undefined && typeof moduleField !== 'string') {
      return false;
    }
  }
  return true;
};

export const readAppManifest = async (
  appDir: string
): Promise<AppManifest | null> => {
  const file = Bun.file(join(appDir, 'package.json'));
  if (!(await file.exists())) {
    return null;
  }
  try {
    const parsed: unknown = await file.json();
    return isAppManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export interface RootManifest {
  readonly workspaces?: readonly string[] | undefined;
}

export const isRootManifest = (value: unknown): value is RootManifest => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!('workspaces' in candidate)) {
    return true;
  }
  const ws = candidate['workspaces'];
  return Array.isArray(ws) && ws.every((entry) => typeof entry === 'string');
};

export const readWorkspacesGlobs = async (
  cwd: string
): Promise<readonly string[]> => {
  const file = Bun.file(join(cwd, 'package.json'));
  if (!(await file.exists())) {
    return [];
  }
  try {
    const parsed: unknown = await file.json();
    if (!isRootManifest(parsed) || parsed.workspaces === undefined) {
      return [];
    }
    return parsed.workspaces;
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Discovery — walk workspaces and identify Trails apps
// ---------------------------------------------------------------------------

interface CandidateApp {
  readonly appDir: string;
  readonly appName: string;
  readonly entryRelative: string;
  readonly modulePath: string;
}

/**
 * Resolve a single workspace member into a candidate app, or `null` if it
 * does not look like a Trails app (no `package.json`, or no Trails entry).
 *
 * The convention:
 * 1. The package.json must exist and parse.
 * 2. Either an explicit `trails.module` field must be present, OR a default
 *    `src/app.ts` file must exist in the member.
 * 3. The package's `name` field becomes the app name; if missing, the last
 *    path segment of the member directory is used as a stable fallback.
 */
const resolveCandidateApp = async (
  memberDir: string,
  workspaceRoot: string
): Promise<CandidateApp | null> => {
  const manifest = await readAppManifest(memberDir);
  if (manifest === null) {
    return null;
  }

  const explicitEntry = manifest.trails?.module;
  const entryRelative = explicitEntry ?? 'src/app.ts';
  if (manifest.trails?.module === undefined) {
    const conventionEntry = Bun.file(join(memberDir, 'src/app.ts'));
    if (!(await conventionEntry.exists())) {
      return null;
    }
  }

  const fallbackName = basename(memberDir) || memberDir;
  const appName = manifest.name ?? fallbackName;
  const modulePath = relative(workspaceRoot, join(memberDir, entryRelative));
  return { appDir: memberDir, appName, entryRelative, modulePath };
};

/**
 * Expand the workspace's `workspaces` globs into concrete member directories.
 *
 * Only directory-shaped globs are supported (`apps/*`, `packages/*`). The
 * scanner uses {@link Bun.Glob} so we stay Bun-native and avoid pulling in
 * extra glob libraries.
 */
const expandWorkspaceMembers = async (
  cwd: string,
  globs: readonly string[]
): Promise<readonly string[]> => {
  const members: string[] = [];
  for (const pattern of globs) {
    const glob = new Bun.Glob(pattern);
    for await (const match of glob.scan({ cwd, onlyFiles: false })) {
      members.push(join(cwd, match));
    }
  }
  // Sort for deterministic discovery order. Collision resolution depends on
  // a stable order so that "last-write-wins" is reproducible across runs.
  return [...members].toSorted();
};

// ---------------------------------------------------------------------------
// Default loader
// ---------------------------------------------------------------------------

/** Property names checked, in order, when extracting a Topo from a module. */
const TOPO_EXPORT_NAMES = ['default', 'graph', 'app'] as const;

const isTopo = (value: unknown): value is Topo => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['ids'] === 'function' &&
    typeof candidate['name'] === 'string'
  );
};

/**
 * Default loader: imports the app's entry module and returns the first export
 * matching the `default` / `graph` / `app` convention.
 */
export const defaultLoadTopo: WorkspaceTopoLoader = async (
  appDir,
  _workspaceRoot,
  entryRelative
) => {
  const entryAbsolute = join(appDir, entryRelative ?? 'src/app.ts');
  const mod = (await import(entryAbsolute)) as Record<string, unknown>;
  for (const exportName of TOPO_EXPORT_NAMES) {
    const candidate = mod[exportName];
    if (isTopo(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `App at "${appDir}" does not export a Topo via default, graph, or app.`
  );
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface IndexAccumulator {
  readonly entries: Map<string, WorkspaceTrailEntry>;
  readonly apps: Set<string>;
  readonly warnings: string[];
}

const recordTrails = (
  accumulator: IndexAccumulator,
  app: CandidateApp,
  trailIds: readonly string[]
): void => {
  for (const trailId of trailIds) {
    accumulator.apps.add(app.appName);
    const previousOwner = accumulator.entries.get(trailId);
    if (previousOwner !== undefined && previousOwner.appName !== app.appName) {
      accumulator.warnings.push(
        `Trail id "${trailId}" is registered by both "${previousOwner.appName}" and "${app.appName}"; last-write-wins until TRL-405 collision handling lands.`
      );
    }
    accumulator.entries.set(trailId, {
      appName: app.appName,
      modulePath: app.modulePath,
      trailId,
    });
  }
};

const buildFromLockfile = (
  workspaceTrails: WorkspaceTrailIndex
): WorkspaceTrailIndexResult => {
  const apps = new Set<string>();
  for (const entry of Object.values(workspaceTrails)) {
    apps.add(entry.appName);
  }
  return {
    apps: [...apps].toSorted(),
    index: Object.freeze({ ...workspaceTrails }),
    source: 'lockfile',
    warnings: [],
  };
};

const buildFromDiscovery = async (
  cwd: string,
  loadTopo: WorkspaceTopoLoader,
  initialWarnings: readonly string[] = []
): Promise<WorkspaceTrailIndexResult> => {
  const accumulator: IndexAccumulator = {
    apps: new Set<string>(),
    entries: new Map<string, WorkspaceTrailEntry>(),
    warnings: [...initialWarnings],
  };

  const globs = await readWorkspacesGlobs(cwd);
  if (globs.length === 0) {
    return {
      apps: [],
      index: Object.freeze({}),
      source: 'discovery',
      warnings: [...accumulator.warnings],
    };
  }

  const members = await expandWorkspaceMembers(cwd, globs);
  const resolvedCandidates = await Promise.all(
    members.map((memberDir) => resolveCandidateApp(memberDir, cwd))
  );
  const candidates = resolvedCandidates.filter(
    (candidate): candidate is CandidateApp => candidate !== null
  );
  const settled = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const loaded = await loadTopo(
        candidate.appDir,
        cwd,
        candidate.entryRelative
      );
      return { candidate, trailIds: loaded.ids() };
    })
  );
  for (const [index, result] of settled.entries()) {
    const candidate = candidates[index];
    if (candidate === undefined) {
      continue;
    }
    if (result.status === 'fulfilled') {
      recordTrails(accumulator, result.value.candidate, result.value.trailIds);
      continue;
    }
    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    accumulator.warnings.push(
      `Failed to load app "${candidate.appName}" at ${candidate.appDir}: ${message}`
    );
  }

  return {
    apps: [...accumulator.apps].toSorted(),
    index: Object.freeze(Object.fromEntries(accumulator.entries)),
    source: 'discovery',
    warnings: [...accumulator.warnings],
  };
};

/**
 * Build a workspace-wide trail-id-to-app-name index.
 *
 * Prefers a committed workspace lockfile (`.trails/trails.lock` carrying a
 * `workspaceTrails` entry) when present; otherwise walks the workspace's
 * `workspaces` globs, loads each app's topo, and reads its trail ids.
 *
 * @example
 * ```ts
 * const result = await buildWorkspaceTrailIndex({ cwd: process.cwd() });
 * if (result.source === 'lockfile') {
 *   // Cached path — no app loading happened.
 * }
 * const owningApp = result.index['my-app.do-thing'];
 * ```
 */
export const buildWorkspaceTrailIndex = async (
  options: BuildWorkspaceTrailIndexOptions
): Promise<WorkspaceTrailIndexResult> => {
  const { cwd, loadTopo = defaultLoadTopo, lockDir } = options;

  let resolvedLockDir: string;
  if (lockDir === undefined) {
    resolvedLockDir = join(cwd, '.trails');
  } else if (isAbsolute(lockDir)) {
    resolvedLockDir = lockDir;
  } else {
    resolvedLockDir = join(cwd, lockDir);
  }
  const lockedIndex = await readWorkspaceLock({
    dir: resolvedLockDir,
  });
  if (lockedIndex !== null) {
    return buildFromLockfile(lockedIndex);
  }

  return await buildFromDiscovery(cwd, loadTopo, [
    `No workspace lockfile found in "${resolvedLockDir}"; falling back to discovery.`,
  ]);
};
