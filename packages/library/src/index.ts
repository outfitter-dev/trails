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
export { kernelRun } from './kernel.js';
export type { Result, Topo } from './kernel.js';
