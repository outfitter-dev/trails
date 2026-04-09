---
'@ontrails/core': minor
'@ontrails/cli': minor
'@ontrails/tracing': minor
'@ontrails/warden': minor
---

Lexicon rename cleanup (ADR-0023). Breaking for `@ontrails/core`, `@ontrails/cli`, and `@ontrails/tracing` at the boundary; internal-only churn for `@ontrails/warden`.

- **core**: the topo store schema renames `topo_provisions` / `topo_trail_provisions` → `topo_resources` / `topo_trail_resources` and `provision_count` → `resource_count`. Schema version bumped v4→v5. Stores still carrying the legacy schema are detected on open, dropped, and recreated from the new DDL — previous topo saves are cleared. Stored-data helpers `listTopoStoreProvisions` / `getTopoStoreProvision` / `readProvisionUsage` / `mapProvisionRow` renamed to their `resource` counterparts. TS row types `TopoTrailProvisionRow` / `TopoProvisionRow` renamed to `TopoTrailResourceRow` / `TopoResourceRow`.
- **cli**: CLI output mode env vars are now derived from the topo name per ADR-0023. Legacy globals `TRAILS_JSON` / `TRAILS_JSONL` are no longer honored — a topo named `stash` reads `STASH_JSON` / `STASH_JSONL`. `ActionResultContext` gains a `topoName: string` field; `resolveOutputMode(flags, topoName)` takes a topo name argument.
- **tracing**: legacy `.trails/dev/tracker.db` migration path removed. Any user still running a pre-rename beta build with a `tracker.db` should delete it or migrate before upgrading.
- **warden**: internal-only rename of `provisionDeclarations` / `provisionExists` rules and their trails to `resourceDeclarations` / `resourceExists`. No behavior change.
