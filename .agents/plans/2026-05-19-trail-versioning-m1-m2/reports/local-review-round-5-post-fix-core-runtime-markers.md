# Local Review Round 5: Post-Fix Core Runtime Markers

Date: 2026-05-19
Lane: core type/TopoGraph authoring shape, pure transpose, marker correctness, runtime version resolution
Stack tip reviewed: `trl-116-run-examples-and-testall-across-live-version-entries`

## Verdict

Clean. I found no P0/P1/P2 findings.

I also found no P3 findings in this scoped pass.

## Checks Run

- `bun test packages/core/src/__tests__/trail.test.ts packages/core/src/__tests__/version-marker.test.ts packages/core/src/__tests__/version-runtime.test.ts packages/core/src/__tests__/version-execution.test.ts packages/core/src/__tests__/validate-topo.test.ts packages/topographer/src/__tests__/derive.test.ts packages/topographer/src/__tests__/diff.test.ts` - pass, 193 tests, 0 failures.
- `bun run --cwd packages/core typecheck` - pass.
- `bun run --cwd packages/topographer typecheck` - pass.
- `git diff --check origin/main...HEAD -- packages/core packages/topographer` - pass, no output.
- `rg -n "trails version|trails sunset|trails mark|trails fork|trails archive|status: \{ state: ['\"]active|kind: ['\"]forced|pending-force|force-event|--force|version\.markers|adapt:" packages/core/src packages/topographer/src packages/core/package.json packages/topographer/package.json` - no matches, exit 1 as expected.
- Broader M3 word sweep only found unrelated `force` usage in temp cleanup/tests/comments and the existing graph-only `TopoGraphEntry.forces?` type at `packages/topographer/src/types.ts:140`; I did not find source authoring or runtime implementation for M3 lifecycle/gates.

## Evidence

### Authoring Shape

- Historical entries require explicit schemas: `VersionEntry` has required `input`/`output` and `marker?: never` at `packages/core/src/trail.ts:102`; runtime normalization throws when either schema is absent at `packages/core/src/trail.ts:552` and calls those checks before classifying the entry at `packages/core/src/trail.ts:670`.
- Authored `kind` and `marker` are rejected: version entries reject both at `packages/core/src/trail.ts:674` and `packages/core/src/trail.ts:679`; top-level authored `marker` is rejected at `packages/core/src/trail.ts:880`. Regression coverage rejects `bad.kind`, top-level `bad.marker`, and version-entry `bad.version-marker` at `packages/core/src/__tests__/trail.test.ts:316`, `packages/core/src/__tests__/trail.test.ts:329`, and `packages/core/src/__tests__/trail.test.ts:336`.
- Current stays top-level: historical entries matching the current version throw `"must stay top-level"` at `packages/core/src/trail.ts:795`; normalized trails return current `input`/`output`/`blaze` at top level and add only `version`/`versions` metadata at `packages/core/src/trail.ts:913`. Test coverage rejects `bad.current-duplicate` at `packages/core/src/__tests__/trail.test.ts:349`.

### Pure Transpose

- Revision entries cannot own runtime fields: `TrailVersionRevisionEntry` marks `blaze`, `crossInput`, `crosses`, `detours`, `kind`, and `resources` as `never` at `packages/core/src/trail.ts:134`; runtime normalization rejects revision-owned `crossInput`, `crosses`, `resources`, and `detours` at `packages/core/src/trail.ts:643`.
- Transpose is pure by shape and execution: transpose functions receive only `{ input }` and `{ output }` in the type surface at `packages/core/src/trail.ts:115`; runtime calls them only with those single-field objects at `packages/core/src/version-runtime.ts:33` and `packages/core/src/version-runtime.ts:50`.
- Revision execution validates historical input, transposes into current input, executes current, transposes output back, then validates historical output at `packages/core/src/version-runtime.ts:67`. Test coverage confirms revision execution transposes through current and captures the current input at `packages/core/src/__tests__/version-execution.test.ts:154`.

### Fork Runtime Shape

- Fork entries own their runtime surface: `TrailVersionForkEntry` requires `blaze` and may declare `crosses`, `crossInput`, `detours`, and `resources` at `packages/core/src/trail.ts:156`.
- Fork execution materializes a fork trail with the fork's `blaze`, `crosses`, `detours`, `crossInput`, `input`, `output`, and `resources` at `packages/core/src/execute.ts:1343`.
- Runtime coverage confirms a fork version runs its own blaze, resources, crosses, and detours at `packages/core/src/__tests__/version-execution.test.ts:191`.

### Prior P2 Re-Checks

- Live fork `crosses` validation is fixed: `validateTopo` now iterates live non-archived fork entries, checks each fork cross, and emits version-scoped diagnostics at `packages/core/src/validate-topo.ts:134`. Test coverage fails a live fork with `crosses: ['entity.missing']` at `packages/core/src/__tests__/validate-topo.test.ts:119` and confirms archived fork crosses are skipped at `packages/core/src/__tests__/validate-topo.test.ts:149`.
- Live fork `resources` validation is fixed: `validateTopo` now iterates live non-archived fork entries and checks each fork resource against topo resources at `packages/core/src/validate-topo.ts:185`. Test coverage fails a live fork with a missing `db.main` resource at `packages/core/src/__tests__/validate-topo.test.ts:271`.
- All-digit marker display/reference round-trip is fixed: TopoGraph display markers are bare prefixes at `packages/topographer/src/versioning.ts:154`, and string references are parsed as numeric versions only when the version actually exists before falling through to marker-prefix resolution at `packages/topographer/src/versioning.ts:195`. Test coverage resolves all-digit marker prefix `'1234'` to version 1 while preserving `'2'` as current version 2 at `packages/topographer/src/__tests__/derive.test.ts:427`.
- Core runtime has the same all-digit marker behavior: version resolution tries numeric references first only when the number exists, then tries marker-prefix resolution when present at `packages/core/src/version-resolution.ts:211`. Runtime coverage resolves an all-digit marker prefix with no matching numeric version at `packages/core/src/__tests__/version-execution.test.ts:241`.
- Current marker canonicalization now includes stable runtime refs: current marker content includes `crosses`, `resources`, and `detours` at `packages/core/src/version-marker.ts:192`; historical fork marker content includes the same runtime refs at `packages/core/src/version-marker.ts:222`. Test coverage asserts current marker content includes those refs and changes marker identity when they change at `packages/core/src/__tests__/version-marker.test.ts:32`.

### Marker Projection and Resolution

- Stored markers are 16-character lowercase SHA-256 prefixes by enforcement at `packages/core/src/version-marker.ts:267`; display prefixes floor at 4 chars and expand until unambiguous at `packages/core/src/version-marker.ts:354`.
- Prefix resolution normalizes case, rejects invalid/short prefixes, rejects ambiguous prefixes, and returns the matched marker/version at `packages/core/src/version-marker.ts:384`. Test coverage for display floor and invalid/ambiguous prefixes lives at `packages/core/src/__tests__/version-marker.test.ts:73` and `packages/core/src/__tests__/version-marker.test.ts:84`.
- TopoGraph projects version entry `kind`/`marker` and fork runtime refs at `packages/topographer/src/versioning.ts:87`, while current marker/support projection stays top-level at `packages/topographer/src/versioning.ts:216`.

### Runtime Version Resolution

- Omitted version resolves to current by default at `packages/core/src/version-resolution.ts:241`.
- Explicit current re-enters the normal current pipeline with the version option stripped at `packages/core/src/execute.ts:1321`.
- Historical resolution dispatches revision entries through `executeTrailRevision` and fork entries through fork materialization at `packages/core/src/execute.ts:1391`.
- `ctx.cross()` remains current by default because bound cross forwarding strips the parent `version` option at `packages/core/src/execute.ts:875`. Test coverage exercises default current cross plus explicit revision/fork pins at `packages/core/src/__tests__/version-execution.test.ts:282`.

## Unable To Verify

No local claim above is unverified. I did not check remote CI or PR review state because this was scoped as a local post-fix review.
