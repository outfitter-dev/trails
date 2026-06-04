/**
 * SHA-256 hashing for topo graphs.
 *
 * Uses Bun.CryptoHasher for native hashing.
 */

import type { TopoGraph } from './types.js';

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
 * Compute a SHA-256 hash of a topo graph.
 *
 * The `generatedAt` field is excluded so that identical topos always
 * produce the same hash regardless of when they were generated.
 */
export const deriveStableHash = (value: unknown): string => {
  const canonical = canonicalize(value);
  const json = JSON.stringify(canonical);

  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(json);
  return hasher.digest('hex');
};

export const deriveTopoGraphHash = (topoGraph: TopoGraph): string => {
  // Strip generatedAt before hashing
  const { generatedAt: _unused, ...rest } = topoGraph;

  return deriveStableHash(rest);
};
