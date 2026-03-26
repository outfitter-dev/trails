// Generation
export { generateSurfaceMap } from './generate.js';
export { hashSurfaceMap } from './hash.js';
export { diffSurfaceMaps } from './diff.js';

// File I/O
export {
  writeSurfaceMap,
  readSurfaceMap,
  writeSurfaceLock,
  readSurfaceLock,
} from './io.js';

// Types
export type {
  SurfaceMap,
  SurfaceMapEntry,
  DiffEntry,
  DiffResult,
  JsonSchema,
  WriteOptions,
  ReadOptions,
} from './types.js';
