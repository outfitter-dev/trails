/**
 * Agent-shaped wayfinding API for Trails.
 *
 * `@ontrails/wayfinder` is the public package home for trails that let agents
 * query a Trails app's resolved topo without re-deriving it from `grep` and
 * file reads. A future catalog may include trails such as `wayfind.overview`,
 * `wayfind.search`, `wayfind.contract`, `wayfind.nearby`, and
 * `wayfind.examples`; this package currently ships as a substrate only.
 *
 * No query trails are exported yet. The exported loader and provenance helpers
 * give the v0 trails a cold, deterministic, materialized artifact substrate
 * when they land.
 */

/**
 * Indicates the wayfinder shell is loaded but ships no trails yet.
 *
 * Consumers can branch on this to detect when the v0 catalog lands without
 * inspecting the package version directly. Will be removed once real trails
 * are exported.
 */
export const WAYFINDER_SHELL = true as const;

export {
  loadWayfinderArtifacts,
  wayfinderTopoGraphSource,
  wayfinderTopoStoreSource,
} from './loader.js';
export type {
  WayfinderArtifactLoad,
  WayfinderArtifactLoaderOptions,
  WayfinderTopoStoreLoad,
} from './loader.js';
export { wayfinderFact } from './provenance.js';
export type {
  WayfinderArtifactKind,
  WayfinderArtifactSource,
  WayfinderContractRef,
  WayfinderFact,
  WayfinderFactCategory,
  WayfinderFreshness,
  WayfinderFreshnessFresh,
  WayfinderFreshnessMissing,
  WayfinderFreshnessSchemaVersionDrift,
  WayfinderFreshnessStale,
  WayfinderStaleReason,
} from './provenance.js';
