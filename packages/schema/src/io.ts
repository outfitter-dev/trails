/**
 * File I/O for surface maps and lock files.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { ReadOptions, SurfaceMap, WriteOptions } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DIR = '.trails';
const SURFACE_MAP_FILE = '_surface.json';
const SURFACE_LOCK_FILE = 'surface.lock';

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

// ---------------------------------------------------------------------------
// Surface Map
// ---------------------------------------------------------------------------

/**
 * Write a surface map to `<dir>/_surface.json`.
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
 * Read a surface map from `<dir>/_surface.json`.
 *
 * Returns `null` if the file doesn't exist.
 */
export const readSurfaceMap = async (
  options?: ReadOptions
): Promise<SurfaceMap | null> => {
  const dir = resolveDir(options);
  const filePath = join(dir, SURFACE_MAP_FILE);
  try {
    const content = await Bun.file(filePath).text();
    return JSON.parse(content) as SurfaceMap;
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Surface Lock
// ---------------------------------------------------------------------------

/**
 * Write a hash to `<dir>/surface.lock` as a single line.
 *
 * Creates the directory if it doesn't exist. Returns the file path.
 */
export const writeSurfaceLock = async (
  hash: string,
  options?: WriteOptions
): Promise<string> => {
  const dir = resolveDir(options);
  await ensureDir(dir);
  const filePath = join(dir, SURFACE_LOCK_FILE);
  await Bun.write(filePath, `${hash}\n`);
  return filePath;
};

/**
 * Read the hash from `<dir>/surface.lock`.
 *
 * Returns `null` if the file doesn't exist.
 */
export const readSurfaceLock = async (
  options?: ReadOptions
): Promise<string | null> => {
  const dir = resolveDir(options);
  const filePath = join(dir, SURFACE_LOCK_FILE);
  try {
    const content = await Bun.file(filePath).text();
    return content.trim();
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
};
