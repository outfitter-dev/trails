---
"@ontrails/trails": minor
"@ontrails/regrade": minor
---

Regrade history consolidates per transition, append-only: `regrade apply` appends a run entry stamped `{ planContentHash, lockHashAtRun }` to `.trails/regrade/history/<transition>.json` instead of overwriting lockhash-named files, identical re-runs are recognized as replays, the artifact carries a stable internal transition `id`, and `regrade check <transition>` verifies each recorded run at its own stamped lock. The report `history.status` union widens to `applied | checked | replay`.
