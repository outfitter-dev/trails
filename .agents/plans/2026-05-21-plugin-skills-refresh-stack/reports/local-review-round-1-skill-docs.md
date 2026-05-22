# Local Review Round 1: Skill And Docs Doctrine

Date: 2026-05-22
Stack tip: `trl-753-republish-trails-plugin-and-document-the-release-path`
Score: 5/5

## Summary

The refreshed public docs and plugin skill surfaces align with current Trails doctrine. The main `trails` skill keeps the first-load teaching flow (`trail` -> `blaze` -> `topo` -> `surface` -> `run` -> `testAll`), qualifies WebSocket as planned, teaches Hono plus Bun-native HTTP, and reflects current testing/resource/error-taxonomy guidance. Deep references and templates cover `@ontrails/http/bun`, `createHttpHarness()`, `testSurfaceParity()`, `expectedMatch`, `ResourceContext.config`, `unmockable`, `VersionNotSupportedError`, `TopoGraph`, and `topo.lock`.

## Evidence

- `plugin/skills/trails/SKILL.md:11` says CLI/MCP/HTTP ship today and WebSocket is planned.
- `plugin/skills/trails/SKILL.md:61` orients surface packages, including `@ontrails/http/bun`.
- `plugin/skills/trails/SKILL.md:176` covers `mock` and `unmockable` resource testing.
- `plugin/skills/trails/SKILL.md:197` names `createCliHarness()`, `createMcpHarness()`, `createHttpHarness()`, and `testSurfaceParity()`.
- `plugin/skills/trails/references/http-surface.md:1` introduces shared HTTP core, Hono, Bun-native HTTP, and fetch kernel responsibilities.
- `plugin/skills/trails/references/testing-patterns.md:150` documents `expectedMatch`; `:259` documents `testSurfaceParity()`.
- `README.md:145` package table includes current public package coverage and shell-only `@ontrails/wayfinder`.
- `docs/api-reference.md:57` includes `VersionNotSupportedError`.
- `rg -n "trailhead|connector|transport|Surface maps|SurfaceMap|16 fixed-category|middleware|publication gates" ...` found only acceptable historical/lexicon/test-detection contexts after the cleanup.
- `bun run warden:skills:check`, `bun run docs:links`, `bun run docs:snippets`, `bun run docs:api-examples`, `bun run check`, and `bun run format:check` passed at the final stack tip.

## Findings

| Severity | Finding | Evidence | Prompt To Fix |
| --- | --- | --- | --- |
| None | No P0/P1/P2/P3 findings. | Checks and targeted review above. | No fix prompt needed. |
