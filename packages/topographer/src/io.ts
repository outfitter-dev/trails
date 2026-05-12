/**
 * File I/O for topo graphs and lock files.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ReadOptions,
  SurfaceLock,
  TopoGraph,
  WorkspaceTrailIndex,
  WriteOptions,
} from './types.js';
import { surfaceLockSchema } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DIR = '.trails';
const TOPO_GRAPH_FILE = '_surface.json';
const SURFACE_LOCK_FILE = 'trails.lock';

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

const parseLegacyStructuredLock = (value: unknown): SurfaceLock | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { hash } = value as { readonly hash?: unknown };
  return typeof hash === 'string' ? { hash: hash.trim() } : null;
};

const parseSurfaceLock = (content: string): SurfaceLock => {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'string') {
      return { hash: parsed.trim() };
    }
    const result = surfaceLockSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    const legacyStructuredLock = parseLegacyStructuredLock(parsed);
    if (legacyStructuredLock !== null) {
      return legacyStructuredLock;
    }
  } catch {
    // Fall through to the legacy hash-line format.
  }

  return { hash: content.trim() };
};

// ---------------------------------------------------------------------------
// TopoGraph
// ---------------------------------------------------------------------------

/**
 * Write a topo graph to `<dir>/_surface.json`.
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
 * Read a topo graph from `<dir>/_surface.json`.
 */
export const readTopoGraph = async (
  options?: ReadOptions
): Promise<TopoGraph | null> => {
  const dir = resolveDir(options);
  const content = await readTextIfExists(join(dir, TOPO_GRAPH_FILE));
  return content ? (JSON.parse(content) as TopoGraph) : null;
};

// ---------------------------------------------------------------------------
// Surface Lock
// ---------------------------------------------------------------------------

/**
 * Stamp a structured lock with the current lockfile version.
 */
const versionStampLock = (lock: SurfaceLock): SurfaceLock =>
  surfaceLockSchema.parse({ ...lock, version: '2' });

/**
 * Write a committed lock to `<dir>/trails.lock`.
 *
 * String input preserves the legacy single-line hash format. Structured input
 * is serialized as JSON. Creates the directory if it doesn't exist.
 *
 * @remarks
 * Structured locks are validated with {@link surfaceLockSchema} and stamped
 * with the current `version: '2'` envelope before serialization.
 */
export const writeSurfaceLock = async (
  lock: string | SurfaceLock,
  options?: WriteOptions
): Promise<string> => {
  const dir = resolveDir(options);
  await ensureDir(dir);
  const filePath = join(dir, SURFACE_LOCK_FILE);

  if (typeof lock === 'string') {
    await Bun.write(filePath, `${lock}\n`);
    return filePath;
  }

  const stamped = versionStampLock(lock);
  await Bun.write(filePath, `${JSON.stringify(stamped, null, 2)}\n`);
  return filePath;
};

/**
 * Read the committed lock from `<dir>/trails.lock`.
 *
 * Structured JSON locks are normalized to expose their committed hash while
 * preserving additional metadata.
 */
export const readSurfaceLockData = async (
  options?: ReadOptions
): Promise<SurfaceLock | null> => {
  const dir = resolveDir(options);
  const content = await readTextIfExists(join(dir, SURFACE_LOCK_FILE));
  return content ? parseSurfaceLock(content) : null;
};

/**
 * Read the committed lock hash from `<dir>/trails.lock`.
 */
export const readSurfaceLock = async (
  options?: ReadOptions
): Promise<string | null> => {
  const lock = await readSurfaceLockData(options);
  return lock?.hash ?? null;
};

/**
 * Read the workspace trail-id index from `<dir>/trails.lock`.
 *
 * Returns the workspace trail index when the lock is a structured
 * JSON document carrying `workspaceTrails`, and `null` for legacy single-line
 * hash files, hash-only structured locks, or missing files.
 *
 * @remarks
 * This is the workspace-wide catalog consumed by `trails run <id>` to resolve
 * a trail to its owning app without scanning sources. Callers that need the
 * raw lock envelope (hash, version, etc.) should use {@link readSurfaceLockData}.
 */
export const readWorkspaceLock = async (
  options?: ReadOptions
): Promise<WorkspaceTrailIndex | null> => {
  const lock = await readSurfaceLockData(options);
  if (lock === null) {
    return null;
  }
  const { workspaceTrails } = lock;
  if (workspaceTrails === undefined) {
    return null;
  }
  return workspaceTrails;
};
