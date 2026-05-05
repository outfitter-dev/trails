---
'@ontrails/topographer': minor
---

Detect trail-ID collisions across apps in `buildWorkspaceTrailIndex()`. Replaces last-write-wins behavior with structured collision facts: `WorkspaceTrailIndexResult` now carries `collisions: WorkspaceTrailCollision[]` where each collision records the trail ID and the sorted list of owning apps. Colliding IDs are **omitted from `index`** so silent ambiguity is impossible; callers such as `trails run` must explicitly resolve via `--app` or prompt. Non-colliding IDs continue to resolve through the enriched `index` entries. Lockfile path always returns `collisions: []` because the lockfile is already a flat map and cannot collide.
