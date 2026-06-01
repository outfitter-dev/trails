// `@ontrails/topographer` owns durable graph artifacts derived from the
// resolved graph (per ADR-0042). The companion `@ontrails/wayfinder`
// package reserves the future trail catalog over these artifacts; no
// wayfinding trails ship yet.

// Derivation
export { deriveTopoGraph } from './derive.js';
export { deriveTopoGraphHash } from './hash.js';
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
  readWorkspaceTopoMetadata,
  readWorkspaceTrailIndex,
  readWorkspaceLock,
} from './io.js';
export {
  lockManifestArtifactSchema,
  lockManifestSchema,
  lockManifestSummarySchema,
  TOPO_GRAPH_SCHEMA_VERSION,
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
  TopoGraphForceEntry,
  TopoGraphFieldOverride,
  TopoGraphFieldOverrideKey,
  TopoGraphLayerReference,
  TopoGraphVersionDetour,
  TopoGraphVersionEntry,
  LockManifest,
  LockManifestArtifact,
  LockManifestSummary,
  WorkspaceTopoMetadata,
  WorkspaceTrailCollision,
  WorkspaceTrailEntry,
  WorkspaceTrailIndex,
  DiffEntry,
  DiffResult,
  JsonSchema,
  TopoGraphContourReference,
  TopoGraphActivationEdge,
  TopoGraphActivationEntry,
  TopoGraphActivationSource,
  WriteOptions,
  ReadOptions,
} from './types.js';

// Topo-store public API. Persistence layer for the resolved topo graph; relies
// on `@ontrails/core` for primitive types and the generic `trails-db` helpers.
// See ADR-0042 for the core/topographer boundary doctrine.
export {
  createTopoSnapshot,
  createMockTopoStore,
  createTopoStore,
  listTopoSnapshots,
  pinTopoSnapshot,
  topoStore,
  unpinTopoSnapshot,
} from './topo-store.js';
export type {
  CreateTopoSnapshotInput,
  ListTopoSnapshotsOptions,
  MockTopoStoreSeed,
  ReadOnlyTopoStore,
  TopoSnapshot,
  TopoStoreActivationContextRecord,
  TopoStoreContourRecord,
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
