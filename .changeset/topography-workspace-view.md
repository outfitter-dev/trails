---
"@ontrails/topography": minor
---

Add a Config-fed app-partitioned workspace view over app-local locks, with deterministic collision and hash facts plus separate completeness, binding, freshness, collection-boundary, and unowned-lock evidence. The lock census honors configured app roots that sit at or below default-ignored directories, while ignored directories inside an app root stay pruned so dependency locks are never reported as unowned.
