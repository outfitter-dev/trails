// Derivation
export { deriveSurfaceMap } from './derive.js';
export { deriveSurfaceMapHash } from './hash.js';
export { deriveSurfaceMapDiff } from './diff.js';

// OpenAPI
export { deriveOpenApiSpec } from './openapi.js';
export type { OpenApiOptions, OpenApiSpec, OpenApiServer } from './openapi.js';

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
