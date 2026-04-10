// Generation
export { generateTrailheadMap } from './generate.js';
export { hashTrailheadMap } from './hash.js';
export { diffTrailheadMaps } from './diff.js';

// OpenAPI
export { generateOpenApiSpec } from './openapi.js';
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
