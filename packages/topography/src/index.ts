// `@ontrails/topography` owns durable graph artifacts derived from the
// resolved graph (per ADR-0042). Wayfind reads those artifacts through
// graph-read trails exported from this package.

// Derivation
export { deriveTopoGraph } from './derive.js';
export {
  deriveActivationGraph,
  deriveDeclaredTrailActivation,
  deriveSignalActivationRelations,
} from './activation-report.js';
export type {
  ActivationChainReport,
  ActivationEdgeReport,
  ActivationGraphReport,
  ActivationOverviewReport,
  ActivationSourceReport,
  SignalActivationRelations,
  TrailActivationReport,
} from './activation-report.js';
export { deriveTopoGraphHash } from './hash.js';
export { collectTopoGraphOverlays } from './overlays.js';
export { deriveSourceFingerprint } from './source-fingerprint.js';
export { deriveTopoGraphDiff } from './diff.js';
export {
  annotateTopoGraphForces,
  carryForwardTopoGraphForces,
  deriveTopoGraphForceEntries,
  stripTopoGraphForces,
} from './forces.js';
export type { TopoGraphForceOptions } from './forces.js';
export {
  collectTopoGraphVersionMarkers,
  deriveTopoGraphVersionMarkerRecords,
  resolveTopoGraphVersionReference,
} from './versioning.js';
export type {
  TopoGraphVersionMarkerRecord,
  TopoGraphVersionMarkerResolution,
} from './versioning.js';

// File I/O
export {
  writeTopoGraph,
  readTopoGraph,
  isTopoArtifactRegenerationError,
  writeLockManifest,
  readLockManifest,
  writeTrailsLock,
  readTrailsLock,
  readWorkspaceTopoMetadata,
  readWorkspaceTrailIndex,
  readWorkspaceLock,
} from './io.js';
export {
  lockManifestArtifactSchema,
  lockManifestSchema,
  lockManifestSummarySchema,
  LOCK_MANIFEST_SCHEMA_VERSION,
  TOPO_GRAPH_SCHEMA_VERSION,
  TRAILS_LOCK_SCHEMA_VERSION,
  trailsLockSchema,
  topoGraphTrailheadEntrySchema,
  topoGraphLibraryProjectionSchema,
  workspaceTopoMetadataSchema,
  workspaceTrailCollisionSchema,
  workspaceTrailEntrySchema,
  workspaceTrailIndexSchema,
} from './types.js';

// Workspace-wide trail-id index (compose-app resolution for `trails run <id>`).
export {
  buildWorkspaceTrailIndex,
  defaultLoadTopo,
  isAppManifest,
  isRootManifest,
  readAppManifest,
  readWorkspacesGlobs,
} from './workspace-topos.js';
export type {
  AppManifest,
  BuildWorkspaceTrailIndexOptions,
  RootManifest,
  WorkspaceTopoLoader,
  WorkspaceTrailIndexResult,
} from './workspace-topos.js';

// Types
export type {
  TopoGraph,
  TopoGraphEntry,
  TopoGraphTrailheadEntry,
  TopoGraphForceEntry,
  TopoGraphFieldOverride,
  TopoGraphFieldOverrideKey,
  TopoGraphLibraryCollision,
  TopoGraphLibraryExclusion,
  TopoGraphLibraryExclusionReason,
  TopoGraphLibraryExport,
  TopoGraphLibraryExportSource,
  TopoGraphLibraryProjection,
  TopoGraphLayerReference,
  TopoGraphOverlayRegistration,
  TopoGraphOverlays,
  DeriveTopoGraphOptions,
  TopoGraphVersionDetour,
  TopoGraphVersionEntry,
  LockManifest,
  LockManifestArtifact,
  LockManifestSummary,
  TrailsLock,
  WorkspaceTopoMetadata,
  WorkspaceTrailCollision,
  WorkspaceTrailEntry,
  WorkspaceTrailIndex,
  DiffEntry,
  DiffResult,
  JsonSchema,
  TopoGraphEntityReference,
  TopoGraphActivationEdge,
  TopoGraphActivationEntry,
  TopoGraphActivationSource,
  WriteOptions,
  ReadOptions,
} from './types.js';

// Topo-store public API. Persistence layer for the resolved topo graph; relies
// on `@ontrails/core` for primitive types and the generic `trails-db` helpers.
// See ADR-0042 for the core/topography boundary doctrine.
export {
  createTopoSnapshot,
  createMockTopoStore,
  createTopoStore,
  listTopoSnapshots,
  pinTopoSnapshot,
  topoStore,
  TOPO_STORE_SCHEMA_VERSION,
  unpinTopoSnapshot,
} from './topo-store.js';
export type {
  CreateTopoSnapshotInput,
  ListTopoSnapshotsOptions,
  MockTopoStoreSeed,
  ReadOnlyTopoStore,
  TopoSnapshot,
  TopoStoreActivationContextRecord,
  TopoStoreEntityRecord,
  TopoStoreEntryKind,
  TopoStoreExportRecord,
  TopoStoreResourceRecord,
  TopoStoreRef,
  TopoStoreSignalDetailRecord,
  TopoStoreSignalRecord,
  TopoStoreSurfaceProjectionRecord,
  TopoStoreTopoGraphEntryRecord,
  TopoStoreTopoGraphRecord,
  TopoStoreTrailDetailRecord,
  TopoStoreTrailRecord,
} from './topo-store.js';

// Wayfind graph-read APIs. The product, trail IDs, and public type names remain
// Wayfinder/wayfind even though the package owner is now Topography.
export { deriveTrailErrorFacts } from './wayfind/error-facts.js';
export type {
  TrailErrorEvidenceInput,
  TrailErrorFact,
  TrailErrorFactKind,
  TrailErrorFactProvenance,
  TrailErrorFacts,
  TrailErrorFactsCompleteness,
  TrailErrorFactsOptions,
  TrailErrorTaxonomyProjection,
} from './wayfind/error-facts.js';
export {
  createWayfinderEntityPredicate,
  createWayfinderFilterContext,
  createWayfinderGraphEntityPredicate,
  filterWayfinderEntityRefs,
  listWayfinderEntityRefs,
  wayfinderEntityFilterSchema,
  wayfinderEntityKindSchema,
  wayfinderIntentSchema,
} from './wayfind/filters.js';
export type {
  WayfinderEntityFilterInput,
  WayfinderEntityFilters,
  WayfinderEntityKind,
  WayfinderEntityRef,
  WayfinderFilterContext,
  WayfinderIntent,
} from './wayfind/filters.js';
export {
  loadWayfinderArtifacts,
  wayfinderTopoGraphSource,
  wayfinderTopoStoreSource,
} from './wayfind/loader.js';
export type {
  WayfinderArtifactLoad,
  WayfinderArtifactLoaderOptions,
  WayfinderTopoStoreLoad,
} from './wayfind/loader.js';
export {
  resolveWayfinderPopulation,
  resolveWayfinderRelations,
  wayfinderDriftStatusSchema,
  wayfinderIncludeSchema,
  wayfinderNavigationPlanSchema,
  wayfinderRelationModeSchema,
  wayfinderResolverSchema,
  wayfinderSourceModeSchema,
  wayfinderViewSchema,
} from './wayfind/navigation.js';
export type {
  WayfinderDriftStatus,
  WayfinderInclude,
  WayfinderNavigationPlan,
  WayfinderPopulationInput,
  WayfinderRelationMode,
  WayfinderRelationResolver,
  WayfinderResolvedRelationInput,
  WayfinderResolvedRelations,
  WayfinderResolver,
  WayfinderSourceMode,
  WayfinderView,
} from './wayfind/navigation.js';
export {
  wayfindAdaptersTrail,
  wayfindContractTrail,
  wayfindDescribeTrail,
  wayfindDiffTrail,
  wayfindEntitiesTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOverlayTrail,
  wayfindOverviewTrail,
  wayfindResourcesTrail,
  wayfindSearchTrail,
  wayfindSignalsTrail,
  wayfindSurfacesTrail,
  wayfindTrailheadsTrail,
  wayfindTrailsTrail,
  wayfindVersionsTrail,
  wayfinderTopo,
} from './wayfind/queries.js';
export {
  wayfinderDriftFromArtifactStatus,
  wayfinderDriftFromFreshness,
  wayfinderFact,
} from './wayfind/provenance.js';
export type {
  WayfinderArtifactKind,
  WayfinderArtifactSource,
  WayfinderArtifactStatus,
  WayfinderArtifactStatusFresh,
  WayfinderArtifactStatusMissing,
  WayfinderArtifactStatusSchemaVersionDrift,
  WayfinderArtifactStatusStale,
  WayfinderContractRef,
  WayfinderFact,
  WayfinderFactCategory,
  WayfinderFactDrift,
  WayfinderFactDriftStatus,
  WayfinderFactInput,
  WayfinderFreshness,
  WayfinderFreshnessFresh,
  WayfinderFreshnessMissing,
  WayfinderFreshnessSchemaVersionDrift,
  WayfinderFreshnessStale,
  WayfinderStaleReason,
} from './wayfind/provenance.js';
