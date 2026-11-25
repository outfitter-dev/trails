/**
 * SHA-256 hashing for topo graphs.
 *
 * Uses Bun.CryptoHasher for native hashing.
 */

import type { TopoGraph, TopoGraphEntry } from './types.js';
import { TRAIL_METADATA_HASH_VERSION } from './types.js';

type GraphEntry = Pick<TopoGraphEntry, 'kind'> & { readonly meta?: unknown };
type GraphHashInput = Pick<
  TopoGraph,
  'generatedAt' | 'trailMetadataHashVersion'
> & {
  readonly entries: readonly GraphEntry[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively sort all object keys for deterministic JSON serialization.
 * Arrays preserve order; primitives pass through.
 */
const canonicalizeRecord = (
  value: object,
  visit: (key: string, field: unknown) => unknown,
  includeAllKeys = false
): Record<string, unknown> => {
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => includeAllKeys || key !== '__proto__')
      .toSorted()
      .map((key) => [key, visit(key, record[key])])
  );
};

const canonicalize = (value: unknown, includeAllKeys = false): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, includeAllKeys));
  }
  if (value !== null && typeof value === 'object') {
    return canonicalizeRecord(
      value,
      (_key, field) => canonicalize(field, includeAllKeys),
      includeAllKeys
    );
  }
  return value;
};

const canonicalizeEntry = (entry: GraphEntry) =>
  canonicalizeRecord(entry, (key, field) =>
    canonicalize(field, entry.kind === 'trail' && key === 'meta')
  );

const hashCanonical = (canonical: unknown): string => {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(JSON.stringify(canonical));
  return hasher.digest('hex');
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a stable SHA-256 hash of a JSON-serializable value.
 */
export const deriveStableHash = (value: unknown): string =>
  hashCanonical(canonicalize(value));

export const deriveTrailMetadataHash = (meta: TopoGraphEntry['meta']): string =>
  hashCanonical(canonicalize({ meta }, true));

export const deriveTrailMetadataHashMarker = (
  entries: readonly GraphEntry[]
): Pick<TopoGraph, 'trailMetadataHashVersion'> =>
  entries.some((entry) => entry.kind === 'trail' && entry.meta !== undefined)
    ? { trailMetadataHashVersion: TRAIL_METADATA_HASH_VERSION }
    : {};

/** Share the checksum between public and store-backed graphs. */
export const deriveTopoGraphRecordHash = (
  topoGraph: GraphHashInput
): string => {
  const { generatedAt: _unused, ...rest } = topoGraph;
  if (rest.trailMetadataHashVersion !== TRAIL_METADATA_HASH_VERSION) {
    return deriveStableHash(rest);
  }

  return hashCanonical(
    canonicalizeRecord(rest, (key, field) =>
      key === 'entries'
        ? topoGraph.entries.map(canonicalizeEntry)
        : canonicalize(field)
    )
  );
};

/** Derive a stable graph hash without its generation timestamp. */
export const deriveTopoGraphHash = (topoGraph: TopoGraph): string =>
  deriveTopoGraphRecordHash(topoGraph);

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
  hashCanonical(canonicalizeEntry(entry));
