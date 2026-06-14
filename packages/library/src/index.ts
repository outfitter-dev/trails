/**
 * `@ontrails/library` — render a Trails topo as an idiomatic TypeScript library.
 *
 * The library surface is a peer of CLI, MCP, and HTTP. Its public ladder:
 *
 * - `deriveLibraryApi(graph, options)` — pure projection → `LibraryProjection`
 * - `surface(graph, options)` — in-memory callable client
 * - `compile(graph, options)` — TypeScript package emitter
 *
 * Those land across the projection, surface, and emitter lanes (Linear project
 * "Library surface & compiler"). This scaffold establishes the package and the
 * runtime-kernel seam; see `./kernel` and the Library Surface and Compiler ADR.
 */
export { deriveLibraryApi } from './derive.js';
export type {
  DeriveLibraryApiOptions,
  LibraryCollision,
  LibraryExclusion,
  LibraryExclusionReason,
  LibraryExport,
  LibraryExportSource,
  LibraryProjection,
} from './derive.js';
export { kernelRun } from './kernel.js';
export type {
  KernelRunOptions,
  Result,
  Topo,
  TrailContextInit,
} from './kernel.js';
export { surface } from './surface.js';
export type {
  LibraryClient,
  LibraryMethod,
  LibraryResultMethod,
  SurfaceLibraryOptions,
} from './surface.js';
