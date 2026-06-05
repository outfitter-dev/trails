/**
 * Agent-shaped wayfinding API for Trails.
 *
 * `@ontrails/wayfinder` is the public package home for trails that let agents
 * query a Trails app's resolved topo without re-deriving it from `grep` plus
 * file reads.
 *
 * The v0 graph-read catalog is cold and deterministic: it reads existing
 * Topographer artifacts and topo-store provenance, but it does not boot apps,
 * resolve resources, reach the network, or mutate local state.
 */

export {
  createWayfinderEntityPredicate,
  createWayfinderFilterContext,
  createWayfinderGraphEntityPredicate,
  filterWayfinderEntityRefs,
  listWayfinderEntityRefs,
  wayfinderEntityFilterSchema,
  wayfinderEntityKindSchema,
  wayfinderIntentSchema,
} from './filters.js';
export type {
  WayfinderEntityFilterInput,
  WayfinderEntityFilters,
  WayfinderEntityKind,
  WayfinderEntityRef,
  WayfinderFilterContext,
  WayfinderIntent,
} from './filters.js';
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
export {
  wayfindContractTrail,
  wayfindContoursTrail,
  wayfindDescribeTrail,
  wayfindExamplesTrail,
  wayfindFacetsTrail,
  wayfindOverviewTrail,
  wayfindResourcesTrail,
  wayfindSearchTrail,
  wayfindSignalsTrail,
  wayfindSurfacesTrail,
  wayfindTrailsTrail,
  wayfindVersionsTrail,
  wayfinderTopo,
} from './queries.js';
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
