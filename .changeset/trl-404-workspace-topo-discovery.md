---
'@ontrails/topography': minor
---

Add `buildWorkspaceTrailIndex()` for runtime workspace topo discovery and cross-app trail-ID resolution. Discovers apps via root `package.json` workspaces, identifies Trails apps by `package.json.trails.module` or a `src/app.ts` convention, and builds an enriched `{ trailId → { trailId, appName, modulePath } }` index. Prefers the lockfile's `workspaceTrails` map (from TRL-403) when present for fast paths; falls back to dynamic loader-based discovery otherwise. The loader is injectable for testing. This is the runtime substrate that `trails run <id>` (TRL-398) will use to resolve trail IDs to owning apps without scanning source. Per the TRL-608 boundary rule, this is Topographer-owned tooling — `@ontrails/core` is not modified.
