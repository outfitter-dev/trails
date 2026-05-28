---
created: 2026-05-06T15:25:17Z
updated: 2026-05-06T15:25:17Z
description: Pre-v1 audit (TRL-632) enumerating all publishable @ontrails/* package export maps and binary surfaces. Classifies entrypoints, identifies seven findings including internal leaks, subpath duplication, and docs/export drift, and proposes follow-up issues TRL-643 through TRL-648.
references:
  - packages/core/src/index.ts
  - packages/store/src/index.ts
  - packages/topographer/src/index.ts
  - packages/tracing/src/index.ts
  - packages/permits/package.json
  - packages/warden/README.md
  - docs/api-reference.md
  - docs/adr/0041-unified-observability.md
linear:
  - TRL-632
  - TRL-643
  - TRL-644
  - TRL-645
  - TRL-646
  - TRL-647
  - TRL-648
impl_status: implemented
---

# M1 Public Surface Audit

Date: 2026-05-06
Issue: TRL-632
Branch: trl-632-audit-public-exports-across-ontrails-packages

## Scope

This audit enumerates the publishable `@ontrails/*` package export maps and
public binary surfaces across `packages/*`, `connectors/*`, and `apps/*`, then
classifies the exposed entrypoints and the larger root barrels for v1
public-surface risk.

The Commander/npm package split is intentionally out of scope for this run per
the M4+ execution plan. `@ontrails/cli/commander` is listed here as an existing
exported subpath, but no follow-up issue is opened from this audit for that
migration.

## Export Map Inventory

| Package | Private | Public entrypoints | Classification |
| --- | --- | --- | --- |
| `@ontrails/cli` | no | `.`, `./commander` | CLI surface builder plus Commander compatibility subpath |
| `@ontrails/config` | no | `.` | Intended public package |
| `@ontrails/core` | no | `.`, `./patterns`, `./redaction`, `./store`, `./trails` | Intended public package with several root exports from `src/internal/*` |
| `@ontrails/drizzle` | no | `.` | Shipped connector package |
| `@ontrails/hono` | no | `.` | Shipped connector package |
| `@ontrails/http` | no | `.` | Framework-agnostic HTTP route model |
| `@ontrails/logging` | no | `.` | Legacy logging package that overlaps with `@ontrails/observe` |
| `@ontrails/logtape` | no | `.` | Shipped LogTape adapter package under `packages/*` |
| `@ontrails/mcp` | no | `.` | Intended public surface package |
| `@ontrails/observe` | no | `.` | Intended public observability package |
| `@ontrails/oxlint-plugin` | yes | `.` | Private repo tooling package, not release surface |
| `@ontrails/permits` | no | `.`, `./jwt`, `./testing` | Public package with connector and testing subpaths |
| `@ontrails/store` | no | `.`, `./jsonfile`, `./testing`, `./trails` | Public package with built-in connector/testing/trail subpaths |
| `@ontrails/testing` | no | `.` | Intended public testing package |
| `@ontrails/topographer` | no | `.` | Intended public package with admin/store escape hatches on root |
| `@ontrails/tracing` | no | `.`, `./otel` | Compatibility and connector-adjacent package after ADR-0041 |
| `@ontrails/trails` | no | bin: `trails`; no library export map | Published CLI app package |
| `@ontrails/vite` | no | `.` | Shipped runtime adapter package |
| `@ontrails/warden` | no | `.`, `./ast` | Intended public package with AST helper subpath |
| `@ontrails/wayfinder` | no | `.` | Shell placeholder export |

Verification commands:

- `jq -r '.workspaces[]' package.json`
- `for f in packages/*/package.json connectors/*/package.json apps/*/package.json; do jq ... "$f"; done`
- `for f in packages/*/src/index.ts connectors/*/src/index.ts apps/*/src/index.ts; do rg -n '^export' "$f"; done`

## Findings

### M1-1: `@ontrails/core` root exports several internal implementation groups

Evidence:

- `packages/core/src/index.ts:285-295` exports signal-reference helpers from
  `./internal/signal-ref.js`.
- `packages/core/src/index.ts:322-332` exports Trails DB helpers from
  `./internal/trails-db.js`.
- `packages/core/src/index.ts:356-369` exports layer projection helpers from
  `./internal/layer-projection.js`.
- `packages/core/src/index.ts:377-381` exports cross-batch helpers from
  `./internal/cross-batch.js`.
- `packages/core/src/index.ts:389-407` exports tracing helpers from
  `./internal/tracing.js`.
- `packages/core/src/index.ts:448-449` exports Zod wrapper helpers from
  `./internal/zod-wrappers.js`.

Classification: escape-hatch exports and likely subpath candidates.

Why this matters: in v1, root exports from `src/internal/*` make the package
boundary hard to reason about. Some of these helpers are now taught in docs, so
the problem is not simply that they are accidentally reachable; some have become
de facto public APIs without a stable module home.

Recommended follow-up: decide which helpers are real contract-support APIs,
move those modules out of `internal`, and publish explicit subpaths where a
root export would make the core barrel too broad.

### M1-2: `@ontrails/store` root exposes connector-support internals

Evidence:

- `packages/store/src/index.ts:6-12` exports `bindStoreDefinition`,
  `composeStoreSignalId`, `createStoreTableSignals`, `isValidResourceId`, and
  `StoreSignalChange` from `./internal/signal-identity.js`.
- `docs/api-reference.md:243` documents `bindStoreDefinition`, which means at
  least part of this internal module is actively public by teaching.

Classification: subpath candidate or internal leak.

Recommended follow-up: move the blessed helper set into a non-internal module
and decide whether connector authors import it from root, `@ontrails/store/signals`,
or another named subpath.

### M1-3: `@ontrails/topographer` root exposes direct store/admin helpers from internals

Evidence:

- `packages/topographer/src/index.ts:86-96` exports count/prune helpers plus
  `createStoredTopoSnapshot`, `getStoredTopoExport`, and `StoredTopoExport`
  from internal modules.
- `packages/topographer/README.md:74` and `docs/api-reference.md:226` teach
  direct DB-handle variants.

Classification: escape-hatch exports and likely `store` or `admin` subpath
candidates.

Recommended follow-up: either bless these as public by moving them out of
`internal`, or isolate direct DB/admin operations under a named subpath so the
root API remains contract-oriented.

### M1-4: `@ontrails/tracing` is still a compatibility and connector-adjacent surface

Evidence:

- `packages/tracing/src/index.ts:1-18` identifies root exports as core tracing
  compatibility.
- `packages/tracing/src/index.ts:59-76` exposes dev-store and internal
  dev-state helpers.
- `packages/tracing/src/index.ts:79-85` exposes OpenTelemetry helpers.
- `packages/tracing/package.json:15` publishes `./otel`.
- `docs/adr/0041-unified-observability.md` points production observability
  adapters toward `@ontrails/observe` or connector packages.

Classification: compatibility surface and connector candidate.

Recommended follow-up: define the v1 posture explicitly. Either keep
`@ontrails/tracing` as a compatibility/dev-state package, or migrate OTel and
dev-store exports into `@ontrails/observe` subpaths or connector packages.

### M1-5: JWT connector is exported from both `@ontrails/permits` root and `./jwt`

Evidence:

- `packages/permits/package.json:14-17` exports root, `./jwt`, and
  `./testing`.
- `packages/permits/src/index.ts:7` re-exports `createJwtConnector`,
  `JwtAlgorithm`, and `JwtConnectorOptions`.
- `packages/permits/src/connectors/jwt.ts` owns the connector implementation.

Classification: connector subpath duplication and root bloat.

Recommended follow-up: make the canonical JWT connector import
`@ontrails/permits/jwt`, or document why the root duplication is intentionally
part of the v1 surface.

### M1-6: Warden README names a subpath that is not exported

Evidence:

- `packages/warden/README.md:118-120` teaches importing `wrapRule` from
  `@ontrails/warden/trails/wrap-rule`.
- `packages/warden/package.json:13-16` exports only `.`, `./ast`, and
  `./package.json`.
- `packages/warden/src/index.ts:119` exports `wrapRule` from root.

Classification: docs/export-map drift.

Recommended follow-up: either change the README to a root import or publish an
explicit `./trails` or `./trails/wrap-rule` subpath if that is the intended
extension surface.

### M1-7: Public-export governance should cover connector/app workspaces and docs specifiers

Evidence:

- The workspace map includes `packages/*`, `connectors/*`, and `apps/*`.
- `@ontrails/hono`, `@ontrails/vite`, and `@ontrails/drizzle` are shipped under
  `connectors/*`, not `packages/*`.
- `@ontrails/trails` is a non-private published app package under `apps/trails`
  with a public `trails` binary and no library export map.
- Existing Warden import-boundary work can reason about package exports, but
  this audit found docs/specifier drift and a bin-only package surface that are
  not currently guarded together.

Classification: regression-coverage gap.

Recommended follow-up: add project-aware export-map governance that reads all
workspace package manifests, including `connectors/*` and `apps/*`; checks
docs/code specifiers against each package's exported subpaths; and records
bin-only package surfaces such as `@ontrails/trails`.

## Follow-up Issue Set

The M1 follow-up set should be small and finishing-oriented:

1. (TRL-643) Split or bless root `@ontrails/core` internal escape hatches.
2. (TRL-644) Clarify `@ontrails/store` connector-support helper imports.
3. (TRL-644) Clarify `@ontrails/topographer` direct store/admin helper imports.
4. (TRL-645) Decide the v1 boundary between `@ontrails/tracing` and
   `@ontrails/observe`.
5. (TRL-646) Canonicalize JWT connector imports from `@ontrails/permits`.
6. (TRL-647) Fix Warden README export-map drift.
7. (TRL-648) Add export-map/bin governance for root internal leaks, docs-only subpaths,
   connector workspaces, and app package binaries.

## Audit Conclusion

The public package set is real and concrete, including the connector workspaces.
The remaining v1 risk is not missing shipped packages; it is that several root
barrels expose internals or compatibility helpers without a durable v1 boundary,
and the repo lacks a guardrail that keeps docs, package export maps, and public
barrels in sync.
