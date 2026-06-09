# Wayfinder V0 Release Notes

Wayfinder is now a real graph-read package, not just a reserved shell. The v0 catalog exports Trails over saved Topographer artifacts so agents can inspect a workspace topo without rebuilding facts from raw text search.

## What Ships

- `@ontrails/wayfinder` exports `wayfinderTopo` and the v0 `wayfind.*` query trails for overview, typed search/listing, describe/contract inspection, examples, error facts, adapter facts, nearby relation reads, impact traversal, and explicit saved-baseline diffing.
- Graph queries read existing Topographer artifacts or topo-store records. Adapter facts read package and conformance evidence through `@ontrails/adapter-kit`. V0 does not boot apps, resolve resources, reach the network, or mutate local state.
- Query results include source and freshness metadata so agents can distinguish fresh artifacts from missing, stale, or schema-drifted artifacts.
- Version and example listings preserve trail-version semantics: version records sort numerically, parent trail example filters include current and historical version examples, and `exampleCoverage: false` stays scoped to uncovered entities.
- The Trails operator MCP surface exposes a selected read-only subset as direct tools and keeps broader saved-topo inspection behind the `inspect` facet.

## Migration Posture

Existing apps do not expose Wayfinder automatically. Wayfinder trails are internal by default, and MCP/HTTP hosts must opt in with exact trail IDs behind their own authorization boundary.

Agents should try Wayfinder first when the question is about saved graph facts: which trails exist, what a contract looks like, which resources/signals/surfaces touch a trail, what is nearby, and what changed between two saved TopoGraphs. Raw file search remains the fallback when artifacts are missing, stale beyond the task's tolerance, or when the question is about source code that Topographer does not yet project.

## Dogfood Release Gate

Run `trails release smoke --check wayfinder-dogfood` after changes to Wayfinder, the Trails operator MCP topo, Topographer artifact export, the Trails CLI Wayfinder commands, or the fresh app loader. In this repo, `bun run wayfinder:dogfood` calls the same trail command. The smoke exports the real Trails operator topo into an isolated temporary root, reads those saved artifacts through `trails wayfind ...`, asserts fresh source metadata, and removes the temporary artifacts before exiting.

Treat this as a release-time check for new framework surfaces that should be visible to agents through saved graph facts. The check should pass before a surface-shaping branch leaves draft; if a branch deliberately skips it, the PR or handoff must explain why Wayfinder cannot yet inspect the changed surface.

## Non-Goals

V0 does not ship generic `wayfind.query`, semantic search, signposts, or `wayfind.implications`. Those need additional accepted substrates or field evidence before they can answer honestly.
