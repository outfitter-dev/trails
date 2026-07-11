/**
 * Content fingerprint over an app's source file set.
 *
 * The per-user topo store records this fingerprint on every snapshot so
 * consumers that serve stored exports can detect that the app sources
 * changed since the snapshot was taken and self-invalidate instead of
 * silently serving pre-edit facts (TRL-1196).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Directories that never contribute to the app source set. */
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.trails',
  '.trails-tmp',
  '.turbo',
  'dist',
  'node_modules',
]);

/** Files that are derived outputs rather than sources. */
const EXCLUDED_FILES = new Set(['trails.lock', 'topo.lock', 'bun.lock']);

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

const hasSourceExtension = (fileName: string): boolean => {
  const dot = fileName.lastIndexOf('.');
  return dot !== -1 && SOURCE_EXTENSIONS.has(fileName.slice(dot));
};

const collectSourceFiles = (dir: string, out: string[]) => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries.toSorted()) {
    const entryPath = join(dir, entry);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(entryPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry)) {
        collectSourceFiles(entryPath, out);
      }
      continue;
    }
    if (
      stats.isFile() &&
      hasSourceExtension(entry) &&
      !EXCLUDED_FILES.has(entry)
    ) {
      out.push(entryPath);
    }
  }
};

/**
 * Derive a SHA-256 fingerprint of the source files under `rootDir`.
 *
 * The fingerprint covers relative paths and file contents, so edits,
 * additions, removals, and renames all change it. Excluded directories
 * (`node_modules`, `dist`, `.git`, `.trails`, `.trails-tmp`, `.turbo`)
 * and derived artifacts (`trails.lock`, `topo.lock`, `bun.lock`) never
 * participate, so recompiling does not invalidate its own fingerprint.
 *
 * @example
 * ```ts
 * const fingerprint = deriveSourceFingerprint('/path/to/app');
 * // "3f8a…" — stable until a source file changes
 * ```
 */
export const deriveSourceFingerprint = (rootDir: string): string => {
  const files: string[] = [];
  collectSourceFiles(rootDir, files);

  const hasher = new Bun.CryptoHasher('sha256');
  for (const filePath of files) {
    const fileHasher = new Bun.CryptoHasher('sha256');
    fileHasher.update(readFileSync(filePath));
    hasher.update(relative(rootDir, filePath));
    hasher.update('\0');
    hasher.update(fileHasher.digest('hex'));
    hasher.update('\n');
  }
  return hasher.digest('hex');
};
