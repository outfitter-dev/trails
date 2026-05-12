// `@ontrails/topographer` owns durable graph artifacts derived from the
// resolved graph (per ADR-0042). The companion `@ontrails/wayfinder`
// package ships trails over these artifacts; the v0 catalog is defined
// in the wayfinding draft ADR at docs/adr/drafts/20260503-wayfinding.md.

// Derivation
export { deriveTopoGraph } from './derive.js';
export { deriveTopoGraphHash } from './hash.js';
export { deriveTopoGraphDiff } from './diff.js';

// File I/O
export {
  writeTopoGraph,
  readTopoGraph,
  writeSurfaceLock,
  readSurfaceLockData,
  readSurfaceLock,
  readWorkspaceLock,
} from './io.js';
export {
  surfaceLockSchema,
  workspaceTrailEntrySchema,
  workspaceTrailIndexSchema,
} from './types.js';

// Workspace-wide trail-id index (cross-app resolution for `trails run <id>`).
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
  WorkspaceTrailCollision,
  WorkspaceTrailIndexResult,
} from './workspace-topos.js';

// Types
export type {
  TopoGraph,
  TopoGraphEntry,
  TopoGraphFieldOverride,
  TopoGraphFieldOverrideKey,
  TopoGraphLayerReference,
  SurfaceLock,
  WorkspaceTrailEntry,
  WorkspaceTrailIndex,
  DiffEntry,
  DiffResult,
  JsonSchema,
  TopoGraphContourReference,
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
  TopoStoreExportRecord,
  TopoStoreResourceRecord,
  TopoStoreRef,
  TopoStoreTrailDetailRecord,
  TopoStoreTrailRecord,
} from './topo-store.js';
