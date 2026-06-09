/**
 * Agent-shaped wayfinding API for Trails.
 *
 * `@ontrails/wayfinder` is the public package home for trails that let agents
 * query a Trails app's resolved topo and package-level authoring facts without
 * re-deriving them from `grep` plus file reads.
 *
 * The v0 graph-read catalog is cold and deterministic: it reads existing
 * Topographer artifacts, topo-store provenance, and adapter-kit package
 * evidence, but it does not boot apps, resolve resources, reach the network, or
 * mutate local state.
 */

export { deriveTrailErrorFacts } from './error-facts.js';
export type {
  TrailErrorEvidenceInput,
  TrailErrorFact,
  TrailErrorFactKind,
  TrailErrorFactProvenance,
  TrailErrorFacts,
  TrailErrorFactsCompleteness,
  TrailErrorFactsOptions,
  TrailErrorTaxonomyProjection,
} from './error-facts.js';
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
  wayfindAdaptersTrail,
  wayfindContractTrail,
  wayfindContoursTrail,
  wayfindDescribeTrail,
  wayfindDiffTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindFacetsTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
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
