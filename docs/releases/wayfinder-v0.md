# Wayfinder V0 Release Notes

Wayfinder shipped as a real graph-read package for v0, not just a reserved shell. As of the TRL-1240 package fold and TRL-1241 rename, Wayfind remains the product, trail-id, CLI, and MCP brand, but the exported graph-read APIs now live in `@ontrails/topography`.

## What Ships

- `@ontrails/topography` exports `wayfinderTopo` and the v0 `wayfind.*` query trails for overview, typed search/listing, describe/contract inspection, examples, error facts, adapter facts, nearby relation reads, impact traversal, and explicit saved-baseline diffing.
- Graph queries read existing Topography artifacts or topo-store records. Adapter facts read package and conformance evidence through `@ontrails/adapter-kit`. V0 does not boot apps, resolve resources, reach the network, or mutate local state.
- Query results include source and drift metadata so agents can distinguish aligned artifacts from missing, stale, or schema-drifted artifacts.
- Version and example listings preserve trail-version semantics: version records sort numerically, parent trail example filters include current and historical version examples, and `exampleCoverage: false` stays scoped to uncovered entities.
- The Trails operator owns source-file outline assembly and exposes it through `trails wayfind file <file> --outline`, using `@ontrails/source` helpers and Topography's public Wayfind artifact-loading APIs.
- The Trails operator MCP surface exposes a selected read-only subset as direct tools and keeps broader saved-topo inspection grouped under `inspect`.

## Migration Posture

Existing apps do not expose Wayfinder automatically. Wayfinder trails are internal by default, and MCP/HTTP hosts must opt in with exact trail IDs behind their own authorization boundary.

Agents should try Wayfinder first when the question is about saved graph facts: which trails exist, what a contract looks like, which resources/signals/surfaces touch a trail, what is nearby, and what changed between two saved TopoGraphs. Use `trails wayfind`, `trails wayfind --trails --intent read`, `trails wayfind <id> --contract`, `trails wayfind <id> --deps`, `trails wayfind <id> --impact`, `trails wayfind pattern "wayfind.*"`, and `trails wayfind query "release drift"` as the operator-facing navigation shape. Use `trails wayfind file <file> --outline` before reading a large source file when a compact AST-backed source map would answer the first navigation question. Raw file search remains the fallback when artifacts are missing, stale beyond the task's tolerance, or when the question is about source code that Topography does not yet render.

## Dogfood Release Gate

Run `trails release smoke --check wayfinder-dogfood` after changes to Wayfinder, the Trails operator MCP topo, Topography artifact export, the Trails CLI Wayfinder commands, or the fresh app loader. In this repo, `bun run wayfinder:dogfood` calls the same trail command. The smoke exports the demo and operator topos into an isolated temporary root, reads saved artifacts through the unified `trails wayfind` shape, asserts aligned drift metadata, validates resources, signals, errors, relation views, invalid grammar, and rejected-compile artifact provenance, then removes the temporary artifacts before exiting.

Treat this as a release-time semantic probe for framework surfaces that should be visible to agents through saved graph facts. The check should pass before a surface-shaping branch leaves draft; if a branch deliberately skips it, the PR or handoff must explain why Wayfinder cannot yet inspect the changed surface.

## Non-Goals

V0 does not ship semantic search, signposts, or `wayfind.implications`. The operator CLI's `wayfind query` selector is a deterministic text filter over indexed graph facts; richer query behavior needs additional accepted substrates or field evidence before it can answer honestly.
