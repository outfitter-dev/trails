/**
 * File I/O for topo graphs and lock files.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  LockManifest,
  ReadOptions,
  TopoGraph,
  TrailsLock,
  WorkspaceTopoMetadata,
  WorkspaceTrailIndex,
  WriteOptions,
} from './types.js';
import {
  LOCK_MANIFEST_SCHEMA_VERSION,
  lockManifestSchema,
  trailsLockSchema,
  topoGraphSchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DIR = '.trails';
const LOCK_MANIFEST_FILE = 'trails.lock';
const TOPO_GRAPH_FILE = 'topo.lock';
const LOCK_RECOVERY_GUIDANCE =
  'Restore a verified copy from Git, or follow the documented migration for its schema, before compiling. Do not delete a committed lock: source cannot reconstruct its force audit history.';
const UNSUPPORTED_LOCK_MESSAGE = `Unsupported trails.lock format. ${LOCK_RECOVERY_GUIDANCE}`;
const UNSUPPORTED_TOPO_GRAPH_MESSAGE = `Unsupported topo.lock format. ${LOCK_RECOVERY_GUIDANCE}`;

export const isTopoArtifactRegenerationError = (
  error: unknown
): error is Error =>
  error instanceof Error &&
  (error.message.includes('Unsupported trails.lock format') ||
    error.message.includes('Unsupported topo.lock format'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isNotFound = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as NodeJS.ErrnoException).code === 'ENOENT';

const resolveDir = (options?: ReadOptions | WriteOptions): string =>
  options?.dir ?? DEFAULT_DIR;

const ensureDir = async (dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true });
};

const readTextIfExists = async (filePath: string): Promise<string | null> => {
  try {
    return await Bun.file(filePath).text();
  } catch (error: unknown) {
    if (!isNotFound(error)) {
      throw error;
    }
    return null;
  }
};

const parseJson = (
  content: string,
  fileName: string,
  recoveryMessage: string
): unknown => {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    const reason = /^\s*(?:<<<<<<<|=======|>>>>>>>)/m.test(content)
      ? 'Git conflict markers'
      : 'Invalid JSON';
    throw new Error(`${reason} in ${fileName}. ${recoveryMessage}`);
  }
};

const parseLockManifest = (content: string): LockManifest => {
  const parsed = parseJson(
    content,
    LOCK_MANIFEST_FILE,
    UNSUPPORTED_LOCK_MESSAGE
  );
  const result = lockManifestSchema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }
  throw new Error(UNSUPPORTED_LOCK_MESSAGE);
};

const parseTrailsLock = (content: string): TrailsLock => {
  const parsed = parseJson(
    content,
    LOCK_MANIFEST_FILE,
    UNSUPPORTED_LOCK_MESSAGE
  );
  const result = trailsLockSchema.safeParse(parsed);
  if (result.success) {
    return result.data as TrailsLock;
  }
  throw new Error(UNSUPPORTED_LOCK_MESSAGE);
};

const parseTopoGraph = (content: string): TopoGraph => {
  const parsed = parseJson(
    content,
    TOPO_GRAPH_FILE,
    UNSUPPORTED_TOPO_GRAPH_MESSAGE
  );
  const result = topoGraphSchema.safeParse(parsed);
  if (result.success) {
    return result.data as TopoGraph;
  }
  throw new Error(UNSUPPORTED_TOPO_GRAPH_MESSAGE);
};

const lockManifestFromTrailsLock = (lock: TrailsLock): LockManifest => ({
  artifacts: [
    {
      path: TOPO_GRAPH_FILE,
      role: 'topo',
      sha256: lock.topoGraphHash,
    },
  ],
  scope: lock.scope,
  summary: lock.summary,
  version: LOCK_MANIFEST_SCHEMA_VERSION,
});

// ---------------------------------------------------------------------------
// TopoGraph
// ---------------------------------------------------------------------------

/**
 * Write a topo graph to `<dir>/topo.lock`.
 *
 * Creates the directory if it doesn't exist. Returns the file path.
 */
export const writeTopoGraph = async (
  topoGraph: TopoGraph,
  options?: WriteOptions
): Promise<string> => {
  const dir = resolveDir(options);
  await ensureDir(dir);
  const filePath = join(dir, TOPO_GRAPH_FILE);
  const json = `${JSON.stringify(topoGraph, null, 2)}\n`;
  await Bun.write(filePath, json);
  return filePath;
};

/**
 * Read a topo graph from `<dir>/trails.lock` or legacy `<dir>/topo.lock`.
 */
export const readTopoGraph = async (
  options?: ReadOptions
): Promise<TopoGraph | null> => {
  const dir = resolveDir(options);
  const lockContent = await readTextIfExists(join(dir, LOCK_MANIFEST_FILE));
  if (lockContent !== null) {
    try {
      return parseTrailsLock(lockContent).topoGraph as TopoGraph;
    } catch (error) {
      try {
        parseLockManifest(lockContent);
      } catch {
        throw error;
      }
      const legacyTopoContent = await readTextIfExists(
        join(dir, TOPO_GRAPH_FILE)
      );
      if (legacyTopoContent === null) {
        throw error;
      }
      return parseTopoGraph(legacyTopoContent);
    }
  }

  const content = await readTextIfExists(join(dir, TOPO_GRAPH_FILE));
  return content === null ? null : parseTopoGraph(content);
};

// ---------------------------------------------------------------------------
// Lock Manifest
// ---------------------------------------------------------------------------

/**
 * Write a lock v4 manifest to `<dir>/trails.lock`.
 *
 * Creates the directory if it doesn't exist. Returns the file path.
 */
export const writeLockManifest = async (
  lockManifest: LockManifest,
  options?: WriteOptions
): Promise<string> => {
  const dir = resolveDir(options);
  await ensureDir(dir);
  const filePath = join(dir, LOCK_MANIFEST_FILE);
  const parsed = lockManifestSchema.parse(lockManifest);
  await Bun.write(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  return filePath;
};

/**
 * Write a v4 Trails lock envelope to `<dir>/trails.lock`.
 */
export const writeTrailsLock = async (
  trailsLock: TrailsLock,
  options?: WriteOptions
): Promise<string> => {
  const dir = resolveDir(options);
  await ensureDir(dir);
  const filePath = join(dir, LOCK_MANIFEST_FILE);
  const parsed = trailsLockSchema.parse(trailsLock);
  await Bun.write(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  return filePath;
};

/**
 * Read a lock v4 manifest from `<dir>/trails.lock`.
 *
 * v5 root locks are derived back to the v4 manifest shape for compatibility.
 */
export const readLockManifest = async (
  options?: ReadOptions
): Promise<LockManifest | null> => {
  const dir = resolveDir(options);
  const content = await readTextIfExists(join(dir, LOCK_MANIFEST_FILE));
  if (content === null) {
    return null;
  }

  try {
    return lockManifestFromTrailsLock(parseTrailsLock(content));
  } catch {
    return parseLockManifest(content);
  }
};

/**
 * Read a v4 Trails lock envelope from `<dir>/trails.lock`.
 */
export const readTrailsLock = async (
  options?: ReadOptions
): Promise<TrailsLock | null> => {
  const dir = resolveDir(options);
  const content = await readTextIfExists(join(dir, LOCK_MANIFEST_FILE));
  return content === null ? null : parseTrailsLock(content);
};

/**
 * Read workspace metadata from the current topo graph artifact.
 */
export const readWorkspaceTopoMetadata = async (
  options?: ReadOptions
): Promise<WorkspaceTopoMetadata | null> => {
  const topoGraph = await readTopoGraph(options);
  if (topoGraph === null) {
    return null;
  }
  return topoGraph.workspace ?? null;
};

/**
 * Read the workspace trail-id index from the current topo graph artifact.
 */
export const readWorkspaceTrailIndex = async (
  options?: ReadOptions
): Promise<WorkspaceTrailIndex | null> => {
  const workspace = await readWorkspaceTopoMetadata(options);
  return workspace?.trails ?? null;
};

/** @deprecated Use {@link readWorkspaceTrailIndex}. */
export const readWorkspaceLock = async (
  options?: ReadOptions
): Promise<WorkspaceTrailIndex | null> => readWorkspaceTrailIndex(options);
