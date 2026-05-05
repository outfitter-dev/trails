---
'@ontrails/cli': minor
---

Absorb `autoIterateLayer` behavior into CLI surface derivation. Trails whose output schema matches the paginated shape (`{ items, hasMore, nextCursor }`) now auto-emit a `--all` flag on the CLI command. When `--all` is set, the executor iterates pages with the trail's cursor field until `hasMore: false` and aggregates `items[]` across pages. With `--jsonl --all`, items stream one per line as they arrive (no in-memory aggregation). If a page reports `hasMore: true` without a non-empty `nextCursor`, `--all` now fails with `ValidationError` instead of silently truncating results. Detection lives in `packages/cli/src/pagination.ts`. The legacy `autoIterateLayer` export is **kept** through Phase 2–7 for back-compat; removal lands in TRL-475 (Phase 8).
