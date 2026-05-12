/**
 * File I/O for topo graphs and lock files.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  LockManifest,
  ReadOptions,
  TopoGraph,
  WorkspaceTrailIndex,
  WriteOptions,
} from './types.js';
import { lockManifestSchema, topoGraphSchema } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DIR = '.trails';
const LOCK_MANIFEST_FILE = 'trails.lock';
const TOPO_GRAPH_FILE = 'topo.lock';
const REGENERATE_LOCK_MESSAGE =
  'Unsupported trails.lock format; regenerate with `trails topo compile`.';
const REGENERATE_TOPO_GRAPH_MESSAGE =
  'Unsupported topo.lock format; regenerate with `trails topo compile`.';

export const isTopoArtifactRegenerationError = (
  error: unknown
): error is Error =>
  error instanceof Error &&
  (error.message.includes(REGENERATE_LOCK_MESSAGE) ||
    error.message.includes(REGENERATE_TOPO_GRAPH_MESSAGE));

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
  regenerateMessage: string
): unknown => {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${fileName}. ${regenerateMessage}`);
  }
};

const parseLockManifest = (content: string): LockManifest => {
  const parsed = parseJson(
    content,
    LOCK_MANIFEST_FILE,
    REGENERATE_LOCK_MESSAGE
  );
  const result = lockManifestSchema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }
  throw new Error(REGENERATE_LOCK_MESSAGE);
};

const parseTopoGraph = (content: string): TopoGraph => {
  const parsed = parseJson(
    content,
    TOPO_GRAPH_FILE,
    REGENERATE_TOPO_GRAPH_MESSAGE
  );
  const result = topoGraphSchema.safeParse(parsed);
  if (result.success) {
    return result.data as TopoGraph;
  }
  throw new Error(REGENERATE_TOPO_GRAPH_MESSAGE);
};

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
 * Read a topo graph from `<dir>/topo.lock`.
 */
export const readTopoGraph = async (
  options?: ReadOptions
): Promise<TopoGraph | null> => {
  const dir = resolveDir(options);
  const content = await readTextIfExists(join(dir, TOPO_GRAPH_FILE));
  return content ? parseTopoGraph(content) : null;
};

// ---------------------------------------------------------------------------
// Lock Manifest
// ---------------------------------------------------------------------------

/**
 * Write a lock v3 manifest to `<dir>/trails.lock`.
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
 * Read a lock v3 manifest from `<dir>/trails.lock`.
 */
export const readLockManifest = async (
  options?: ReadOptions
): Promise<LockManifest | null> => {
  const dir = resolveDir(options);
  const content = await readTextIfExists(join(dir, LOCK_MANIFEST_FILE));
  return content ? parseLockManifest(content) : null;
};

/**
 * Read the workspace trail-id index from the current lock manifest.
 */
export const readWorkspaceLock = async (
  options?: ReadOptions
): Promise<WorkspaceTrailIndex | null> => {
  const lock = await readLockManifest(options);
  if (lock === null) {
    return null;
  }
  const { workspaceTrails } = lock;
  if (workspaceTrails === undefined) {
    return null;
  }
  return workspaceTrails;
};
