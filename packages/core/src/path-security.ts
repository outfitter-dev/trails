/**
 * Path security utilities for preventing path traversal attacks.
 *
 * All functions are runtime-agnostic (Node / Bun compatible).
 */

import { resolve, relative, normalize, isAbsolute } from 'node:path';

import { PermissionError } from './errors.js';
import { Result } from './result.js';

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Returns true when `target` is equal to or a descendant of `base`. */
const isWithin = (base: string, target: string): boolean => {
  const rel = relative(base, target);
  // Empty string means they are the same directory.
  // A relative path starting with ".." means it escapes.
  // An absolute path means a completely different tree.
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves `userPath` relative to `basePath` and ensures it stays within
 * the base directory. Returns the resolved absolute path on success, or a
 * `PermissionError` if the path escapes.
 *
 * Uses lexical path comparison (not `realpath`). Does not follow symlinks —
 * if an attacker can create symlinks inside `basePath`, those could point
 * outside the base. Use `realpath` before calling in symlink-sensitive environments.
 */
export const securePath = (
  basePath: string,
  userPath: string
): Result<string, PermissionError> => {
  const base = resolve(basePath);
  const resolved = resolve(base, userPath);

  if (!isWithin(base, resolved)) {
    return Result.err(
      new PermissionError(
        `Path traversal detected: "${userPath}" escapes "${basePath}"`,
        {
          context: { basePath: base, resolved, userPath },
        }
      )
    );
  }

  return Result.ok(resolved);
};

/**
 * Returns `true` if `userPath` (resolved against `basePath`) stays within
 * `basePath`.
 */
export const isPathSafe = (basePath: string, userPath: string): boolean => {
  const base = resolve(basePath);
  const resolved = resolve(base, userPath);
  return isWithin(base, resolved);
};

/**
 * Joins multiple path segments, resolves them against `basePath`, and
 * validates the result stays within the base directory.
 */
export const resolveSafePath = (
  basePath: string,
  ...segments: string[]
): Result<string, PermissionError> => {
  const base = resolve(basePath);
  const joined = resolve(base, ...segments.map((s) => normalize(s)));

  if (!isWithin(base, joined)) {
    return Result.err(
      new PermissionError(
        `Path traversal detected: segments escape "${basePath}"`,
        { context: { basePath: base, resolved: joined, segments } }
      )
    );
  }

  return Result.ok(joined);
};
