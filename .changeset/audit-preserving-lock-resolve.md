---
'@ontrails/trails': minor
'@ontrails/topography': patch
'@ontrails/warden': patch
---

Add `trails resolve` to recover selected generated app locks from resolved sources and verified Git parent evidence while preserving force audit history.

Make force retention kind-aware and idempotent, keep orphaned events at graph level, and report pending events for every supported entry kind without conflating distinct timestamps or reasons.

Keep retained audit warnings out of contract-break comparisons, report timestamp-only audit changes, and prevent lock path replacement from redirecting recovery writes.
