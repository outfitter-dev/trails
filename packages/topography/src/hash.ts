/**
 * SHA-256 hashing for topo graphs.
 *
 * Uses Bun.CryptoHasher for native hashing.
 */

import type { TopoGraph, TopoGraphEntry } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively sort all object keys for deterministic JSON serialization.
 * Arrays preserve order; primitives pass through.
 */
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a stable SHA-256 hash of a JSON-serializable value.
 */
export const deriveStableHash = (value: unknown): string => {
  const canonical = canonicalize(value);
  const json = JSON.stringify(canonical);

  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(json);
  return hasher.digest('hex');
};

/** Derive a stable graph hash without its generation timestamp. */
export const deriveTopoGraphHash = (topoGraph: TopoGraph): string => {
  // Strip generatedAt before hashing
  const { generatedAt: _unused, ...rest } = topoGraph;

  return deriveStableHash(rest);
};

/**
 * Derive a stable SHA-256 hash of one complete TopoGraph entry.
 *
 * Object key order is normalized recursively; array order and every entry
 * field remain significant.
 *
 * @example
 * ```ts
 * for (const entry of topoGraph.entries) {
 *   const hash = deriveTopoGraphEntryHash(entry);
 * }
 * ```
 */
export const deriveTopoGraphEntryHash = (entry: TopoGraphEntry): string =>
  deriveStableHash(entry);
