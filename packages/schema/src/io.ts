/**
 * File I/O for surface maps and lock files.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ReadOptions,
  SurfaceLock,
  SurfaceMap,
  WriteOptions,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DIR = '.trails';
const SURFACE_MAP_FILE = '_trailhead.json';
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

const isSurfaceLock = (value: unknown): value is SurfaceLock => {
  const lock = value as Record<string, unknown>;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof lock['hash'] === 'string'
  );
};

const parseSurfaceLock = (content: string): SurfaceLock => {
  try {
    const parsed: unknown = JSON.parse(content);
    if (isSurfaceLock(parsed)) {
      return parsed;
    }
    if (typeof parsed === 'string') {
      return { hash: parsed.trim() };
    }
  } catch {
    // Fall through to the legacy hash-line format.
  }

  return { hash: content.trim() };
};

// ---------------------------------------------------------------------------
// Surface Map
// ---------------------------------------------------------------------------

/**
 * Write a surface map to `<dir>/_trailhead.json`.
 *
 * Creates the directory if it doesn't exist. Returns the file path.
 */
export const writeSurfaceMap = async (
  surfaceMap: SurfaceMap,
  options?: WriteOptions
): Promise<string> => {
  const dir = resolveDir(options);
  await ensureDir(dir);
  const filePath = join(dir, SURFACE_MAP_FILE);
  const json = `${JSON.stringify(surfaceMap, null, 2)}\n`;
  await Bun.write(filePath, json);
  return filePath;
};

/**
 * Read a surface map from `<dir>/_trailhead.json`.
 */
export const readSurfaceMap = async (
  options?: ReadOptions
): Promise<SurfaceMap | null> => {
  const dir = resolveDir(options);
  const content = await readTextIfExists(join(dir, SURFACE_MAP_FILE));
  return content ? (JSON.parse(content) as SurfaceMap) : null;
};

// ---------------------------------------------------------------------------
// Surface Lock
// ---------------------------------------------------------------------------

/**
 * Write a committed lock to `<dir>/trails.lock`.
 *
 * String input preserves the legacy single-line hash format. Structured input
 * is serialized as JSON. Creates the directory if it doesn't exist.
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

  await Bun.write(filePath, `${JSON.stringify(lock, null, 2)}\n`);
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
