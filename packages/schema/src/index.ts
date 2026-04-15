// Generation
export { deriveSurfaceMap } from './derive.js';
export { deriveSurfaceMapHash } from './hash.js';
export { deriveSurfaceMapDiff } from './diff.js';

// OpenAPI
export { deriveOpenApiSpec } from './openapi.js';
export type { OpenApiOptions, OpenApiSpec, OpenApiServer } from './openapi.js';

// File I/O
export {
  writeTrailheadMap,
  readTrailheadMap,
  writeTrailheadLock,
  readTrailheadLockData,
  readTrailheadLock,
} from './io.js';

// Types
export type {
  TrailheadMap,
  TrailheadMapEntry,
  TrailheadLock,
  DiffEntry,
  DiffResult,
  JsonSchema,
  TrailheadContourReference,
  WriteOptions,
  ReadOptions,
} from './types.js';
