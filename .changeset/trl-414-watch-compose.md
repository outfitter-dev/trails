---
'@ontrails/trails': minor
---

Compose `--watch` with the split `run example` command and `--trace` cleanly. Moves the `--trace` session install/finalize bracket inside `runSurfaceOnce` so each watch rerun gets a fresh memory sink and stderr tree (previously the sink was process-scoped and accumulated records across reruns, suppressing the per-rerun tree until SIGINT). Adds integration tests covering the example-comparison rerun loop, trace-record freshness across reruns, and error recovery (a thrown rerun does not exit the watch loop). Documents the TDD-in-terminal workflow in the Direct Invocation ADR draft.
