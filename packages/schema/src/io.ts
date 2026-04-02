/**
 * File I/O for trailhead maps and lock files.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { ReadOptions, TrailheadMap, WriteOptions } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DIR = '.trails';
const TRAILHEAD_MAP_FILE = '_trailhead.json';
const TRAILHEAD_LOCK_FILE = 'trailhead.lock';

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

const readFirstExistingText = async (
  filePaths: readonly string[]
): Promise<string | null> => {
  for (const filePath of filePaths) {
    try {
      return await Bun.file(filePath).text();
    } catch (error: unknown) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Trailhead Map
// ---------------------------------------------------------------------------

/**
 * Write a trailhead map to `<dir>/_trailhead.json`.
 *
 * Creates the directory if it doesn't exist. Returns the file path.
 */
export const writeTrailheadMap = async (
  trailheadMap: TrailheadMap,
  options?: WriteOptions
): Promise<string> => {
  const dir = resolveDir(options);
  await ensureDir(dir);
  const filePath = join(dir, TRAILHEAD_MAP_FILE);
  const json = `${JSON.stringify(trailheadMap, null, 2)}\n`;
  await Bun.write(filePath, json);
  return filePath;
};

/**
 * Read a trailhead map from `<dir>/_trailhead.json`.
 */
export const readTrailheadMap = async (
  options?: ReadOptions
): Promise<TrailheadMap | null> => {
  const dir = resolveDir(options);
  const content = await readFirstExistingText([join(dir, TRAILHEAD_MAP_FILE)]);
  return content ? (JSON.parse(content) as TrailheadMap) : null;
};

// ---------------------------------------------------------------------------
// Trailhead Lock
// ---------------------------------------------------------------------------

/**
 * Write a hash to `<dir>/trailhead.lock` as a single line.
 *
 * Creates the directory if it doesn't exist. Returns the file path.
 */
export const writeTrailheadLock = async (
  hash: string,
  options?: WriteOptions
): Promise<string> => {
  const dir = resolveDir(options);
  await ensureDir(dir);
  const filePath = join(dir, TRAILHEAD_LOCK_FILE);
  await Bun.write(filePath, `${hash}\n`);
  return filePath;
};

/**
 * Read the hash from `<dir>/trailhead.lock`.
 */
export const readTrailheadLock = async (
  options?: ReadOptions
): Promise<string | null> => {
  const dir = resolveDir(options);
  const content = await readFirstExistingText([join(dir, TRAILHEAD_LOCK_FILE)]);
  return content ? content.trim() : null;
};
