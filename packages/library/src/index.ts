/**
 * `@ontrails/library` — render a Trails topo as an idiomatic TypeScript library.
 *
 * The library surface is a peer of CLI, MCP, and HTTP. Its public ladder:
 *
 * - `deriveLibraryApi(graph, options)` — pure rendering → `LibraryRenderingPlan`
 * - `surface(graph, options)` — in-memory callable client
 * - `compile(graph, options)` — TypeScript package emitter
 *
 * Those land across the rendering, surface, and emitter lanes (Linear project
 * "Library surface & compiler"). This scaffold establishes the package and the
 * runtime-kernel seam; see `./kernel` and the Library Surface and Compiler ADR.
 */
export { compile } from './compile.js';
export type { CompiledFile, CompileOptions, CompileResult } from './compile.js';
export { deriveLibraryApi } from './derive.js';
export type {
  DeriveLibraryApiOptions,
  LibraryCollision,
  LibraryExclusion,
  LibraryExclusionReason,
  LibraryExport,
  LibraryExportSource,
  LibraryRenderingPlan,
} from './derive.js';
export {
  LibraryAuthError,
  LibraryCancelledError,
  LibraryConflictError,
  LibraryError,
  LibraryInternalError,
  LibraryNetworkError,
  LibraryNotFoundError,
  LibraryPermissionError,
  LibraryRateLimitError,
  LibraryShiftError,
  LibraryTimeoutError,
  LibraryValidationError,
  toLibraryError,
} from './errors.js';
export type { LibraryErrorOptions } from './errors.js';
export { kernelRun } from './kernel.js';
export type { TrailInput, TrailOutput } from '@ontrails/core';
export type {
  KernelRunOptions,
  Result,
  Topo,
  TrailContextInit,
} from './kernel.js';
export { runLibraryResult, surface } from './surface.js';
export type {
  LibraryClient,
  LibraryMethod,
  LibraryResultMethod,
  SurfaceLibraryOptions,
} from './surface.js';
