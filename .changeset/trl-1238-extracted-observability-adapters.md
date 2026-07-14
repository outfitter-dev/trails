---
'@ontrails/logtape': minor
'@ontrails/observability': major
'@ontrails/pino': minor
'@ontrails/warden': patch
---

Extract the real `@ontrails/logtape` and `@ontrails/pino` adapters from the
temporary observability subpaths. The new packages own their namesake foreign
dependencies and preserve Trails record metadata, levels, redaction boundaries,
and lifecycle behavior; the old subpaths are removed in the pre-v1 hard cut.

Add governed Regrade transitions for both exact import replacements and expose
the observability adapter target through the shared adapter readiness check.
