/**
 * Agent-shaped wayfinding API for Trails.
 *
 * `@ontrails/wayfinder` is the public package home for trails that let agents
 * query a Trails app's resolved topo without re-deriving it from `grep` and
 * file reads. A future catalog may include trails such as `wayfind.overview`,
 * `wayfind.search`, `wayfind.trail`, and `wayfind.examples`; this package
 * currently ships as a marker only.
 *
 * No trails are exported yet. The shell exists to reserve the namespace and
 * give the v0 trails a clean home when they land. Peer dependencies on
 * `@ontrails/core` and `@ontrails/topographer` are declared optional in
 * `peerDependenciesMeta` until real trails consume them.
 */

/**
 * Indicates the wayfinder shell is loaded but ships no trails yet.
 *
 * Consumers can branch on this to detect when the v0 catalog lands without
 * inspecting the package version directly. Will be removed once real trails
 * are exported.
 */
export const WAYFINDER_SHELL = true as const;
