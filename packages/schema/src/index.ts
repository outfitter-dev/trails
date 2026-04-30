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
