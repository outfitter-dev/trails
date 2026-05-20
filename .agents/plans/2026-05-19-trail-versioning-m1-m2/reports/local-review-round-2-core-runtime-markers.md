# Local Review Round 2: Core / Runtime / Markers

Date: 2026-05-19
Stack tip reviewed: `trl-116-run-examples-and-testall-across-live-version-entries`

## Scope

- Core `version` / `versions` authoring shape.
- TopoGraph projection.
- Pure revision `transpose:`.
- Projected content-addressed markers.
- Runtime version resolution.

## Initial Findings

### P2: Revision entries allowed ignored `crossInput`

Revision entries rejected `crosses`, `resources`, and `detours`, but `crossInput` could still be authored and silently ignored. That violated the pure-revision rule.

Resolution: fixed on `trl-114-add-pure-transpose-transforms-for-revision-entries` by making revision `crossInput` impossible in types and rejected at runtime.

### P2: Live fork version dependencies were not topo-validated

Fork entries project and execute fork-local `crosses` and `resources`, but `validateTopo()` only checked top-level trail dependencies.

Resolution: fixed on `trl-113-define-trail-version-versions-authoring-shape` by validating non-archived fork version `crosses` / `resources` against the topo while preserving draft-id allowance and archived-entry inertness.

### P2: TopoGraph marker resolution failed all-digit marker prefixes

`resolveTopoGraphVersionReference(entry, "1234")` treated every all-digit string as a numeric version before trying marker-prefix resolution.

Resolution: fixed on `trl-739-featcore-compute-content-addressed-version-markers` by using numeric resolution only when that version exists, then falling through to marker-prefix resolution.

### P2: Current markers omitted stable top-level runtime contract fields

Current marker content hashed only `input`, `output`, and `kind`, while fork marker content also included stable runtime declarations such as `crosses`, `resources`, and `detours`.

Resolution: fixed on `trl-739-featcore-compute-content-addressed-version-markers` by projecting current `crosses`, `resources`, and `detours` through the same canonical helpers used for fork marker content.

### P2: Runtime marker derivation helper type omitted current runtime fields

After current markers began hashing top-level runtime declarations, `resolveTrailVersion()` still typed the marker derivation path as schema/version-only.

Resolution: fixed on `trl-115-resolve-trail-versions-during-execution` by requiring the marker resolution helper to receive the full current marker contract fields.

## Verification

- `bun test packages/core/src/__tests__/validate-topo.test.ts` passed after fork dependency validation.
- `bun run --cwd packages/core typecheck` passed after fork dependency validation.
- `bun test packages/core/src/__tests__/trail.test.ts` and core type tests passed after pure-revision `crossInput` rejection.
- `bun test packages/core/src/__tests__/version-marker.test.ts packages/topographer/src/__tests__/derive.test.ts` passed after marker fixes.
- `bun run --cwd packages/core typecheck` and `bun run --cwd packages/topographer typecheck` passed after marker fixes.
- Tip focused checks passed for runtime/version/topographer/guide/testing suites after restack.

## Clean Checks

- Revision transpose functions receive only `{ input }` / `{ output }`.
- Authored `kind` and `marker` remain rejected.
- Historical entries still require explicit `input` and `output`.
- `ctx.cross()` remains current by default and requires explicit version pins.
- Archived entries stay out of live default validation/example paths.

## Result

Round 2 initially found P2s. All P2s were fixed on the lowest owning branches and restacked. Latest state is clean for this lane.
