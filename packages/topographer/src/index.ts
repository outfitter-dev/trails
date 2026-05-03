// `@ontrails/topographer` owns durable graph artifacts derived from the
// resolved graph (per ADR-0042). The companion `@ontrails/wayfinder`
// package ships trails over these artifacts; the v0 catalog is defined
// in the wayfinding draft ADR at docs/adr/drafts/20260503-wayfinding.md.

// Derivation
export { deriveSurfaceMap } from './derive.js';
export { deriveSurfaceMapHash } from './hash.js';
export { deriveSurfaceMapDiff } from './diff.js';

// File I/O
export {
  writeSurfaceMap,
  readSurfaceMap,
  writeSurfaceLock,
  readSurfaceLockData,
  readSurfaceLock,
} from './io.js';

// Types
export type {
  SurfaceMap,
  SurfaceMapEntry,
  SurfaceMapFieldOverride,
  SurfaceMapFieldOverrideKey,
  SurfaceLock,
  DiffEntry,
  DiffResult,
  JsonSchema,
  SurfaceMapContourReference,
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
export {
  countPinnedSnapshots,
  countPrunableSnapshots,
  countTopoSnapshots,
  pruneUnpinnedSnapshots,
} from './internal/topo-snapshots.js';
export {
  createTopoSnapshot as createStoredTopoSnapshot,
  getStoredTopoExport,
} from './internal/topo-store.js';
export type { StoredTopoExport } from './internal/topo-store.js';
