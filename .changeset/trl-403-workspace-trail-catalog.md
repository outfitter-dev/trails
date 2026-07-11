---
'@ontrails/topography': minor
---

Extend the lockfile schema to catalog trail IDs across apps. `SurfaceLock` now carries a Zod-validated `workspaceTrails` map whose entries include the trail ID, owning app name, and app module path, plus a narrowed `version: '2'` envelope for structured locks. The new `readWorkspaceLock()` reader returns the enriched trail-id index when present, or `null` for legacy / single-app locks. `TopoSnapshot` gains an optional `appName` attribution column (SQLite `topo_snapshots.app_name`, schema version 11) so snapshots can be attributed to their owning app. Single-app repos remain backward compatible — no workspace metadata is emitted unless the writer is given a `workspaceTrails` map.
