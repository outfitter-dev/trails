/**
 * Path security utilities for preventing path traversal attacks.
 *
 * All functions are runtime-agnostic (Node / Bun compatible).
 */

import { PermissionError } from './errors.js';
import { Result } from './result.js';
// Path security guards filesystem access on tooling paths: node:path
// loads lazily at first use so the core barrel's module graph stays
// execution-portable on runtimes without node: builtins (TRL-1198).
import { loadRuntimeBuiltin } from './runtime-builtins.js';

const nodePath = () => loadRuntimeBuiltin('node:path');

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Returns true when `target` is equal to or a descendant of `base`. */
const isWithin = (base: string, target: string): boolean => {
  const { isAbsolute, relative } = nodePath();
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
  const { resolve } = nodePath();
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
  const { resolve } = nodePath();
  const base = resolve(basePath);
  const resolved = resolve(base, userPath);
  return isWithin(base, resolved);
};

/**
 * Joins multiple path segments, resolves them against `basePath`, and
 * validates the result stays within the base directory.
 */
export const deriveSafePath = (
  basePath: string,
  ...segments: string[]
): Result<string, PermissionError> => {
  const { normalize, resolve } = nodePath();
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
