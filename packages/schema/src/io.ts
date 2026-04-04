/**
 * File I/O for trailhead maps and lock files.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ReadOptions,
  TrailheadLock,
  TrailheadMap,
  WriteOptions,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DIR = '.trails';
const TRAILHEAD_MAP_FILE = '_trailhead.json';
const TRAILHEAD_LOCK_FILE = 'trails.lock';
const LEGACY_TRAILHEAD_LOCK_FILE = 'trailhead.lock';

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

const isTrailheadLock = (value: unknown): value is TrailheadLock => {
  const lock = value as Record<string, unknown>;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof lock['hash'] === 'string'
  );
};

const parseTrailheadLock = (content: string): TrailheadLock => {
  try {
    const parsed: unknown = JSON.parse(content);
    if (isTrailheadLock(parsed)) {
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
 * Write a committed lock to `<dir>/trails.lock`.
 *
 * String input preserves the legacy single-line hash format. Structured input
 * is serialized as JSON. Creates the directory if it doesn't exist.
 */
export const writeTrailheadLock = async (
  lock: string | TrailheadLock,
  options?: WriteOptions
): Promise<string> => {
  const dir = resolveDir(options);
  await ensureDir(dir);
  const filePath = join(dir, TRAILHEAD_LOCK_FILE);

  if (typeof lock === 'string') {
    await Bun.write(filePath, `${lock}\n`);
    return filePath;
  }

  await Bun.write(filePath, `${JSON.stringify(lock, null, 2)}\n`);
  return filePath;
};

/**
 * Read the committed lock from `<dir>/trails.lock`, falling back to the
 * legacy `<dir>/trailhead.lock` during migration.
 *
 * Structured JSON locks are normalized to expose their committed hash while
 * preserving additional metadata.
 */
export const readTrailheadLockData = async (
  options?: ReadOptions
): Promise<TrailheadLock | null> => {
  const dir = resolveDir(options);
  const content = await readFirstExistingText([
    join(dir, TRAILHEAD_LOCK_FILE),
    join(dir, LEGACY_TRAILHEAD_LOCK_FILE),
  ]);
  return content ? parseTrailheadLock(content) : null;
};

/**
 * Read the committed lock hash from `<dir>/trails.lock`, falling back to the
 * legacy `<dir>/trailhead.lock` during migration.
 */
export const readTrailheadLock = async (
  options?: ReadOptions
): Promise<string | null> => {
  const lock = await readTrailheadLockData(options);
  return lock?.hash ?? null;
};
