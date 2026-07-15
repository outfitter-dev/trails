# Beta 15 to Beta 19 Downstream Migration Guide

This guide is for downstream Trails apps moving from the `1.0.0-beta.15` package line to `1.0.0-beta.19`. It is operator-facing: install, change, verify.

> This guide preserves the beta.19 migration path. Current v1 prerelease builds
> write one root `trails.lock` instead of the beta.19 `.trails/trails.lock` plus
> `.trails/topo.lock` artifact family. Use this page for beta.15-beta.19
> archaeology, then use the current Topo Store and migration docs for the v1
> target substrate.

Beta 15 to beta 19 is not one breaking rename. It is a modernization bundle that touches package shape, CLI/MCP/HTTP surfaces, observability, contract testing, drift detection, trail composition vocabulary, trail versioning, adapter authoring, and a few layer and error-taxonomy decisions. The focused migration guides under [`docs/migration/`](../migration/) cover each concern in depth. This guide ties them together, lists install commands, and gives downstream apps a CI-grade checklist.

The two beta.19 changes a downstream app must act on are the `cross` → `compose` composition rename and, if it pinned them, the retired `trails topo compile` / `trails topo verify` / `trails topo check` command shapes. The rest of beta.19 (trail-versioning runtime, adapter authoring, scaffold provenance, Warden safe-fix) is additive — adopt it when the app needs it. The [Beta 18 → Beta 19](#beta-18-to-beta-19) section below covers the specifics.

Read [Beta 15](./beta15.md) first if you are still on a pre-beta.15 line — that guide owns the `trailhead`/`provision`/`gate`/`loadout` and `tracker`/`logging` cutovers. This document picks up after beta.15 is in place.

## What Changed In One Paragraph

Beta 16 split `@ontrails/commander` out of `@ontrails/cli/commander`, moved the topo-store API into `@ontrails/topographer`, added typed layers as a real primitive with attachment scopes, renamed surface-map artifacts to `TopoGraph` / `.trails/topo.lock`, added the `unmockable` resource marker, and absorbed pagination and date shortcuts into CLI surface derivation. Beta 17 added the example-driven surface-parity helper and the HTTP surface harness, and projected `inputSchema` v1 minimums for shipped surface entrypoints. Beta 18 added `@ontrails/http/fetch` and `@ontrails/http/bun` as a Web Fetch kernel plus a Bun-native HTTP binding. Beta 19 renamed the `cross` composition family to `compose`, promoted the topo artifact commands to top-level `trails compile` / `trails validate`, made trail versioning resolve at runtime across all surfaces, introduced the `@ontrails/adapter-kit` authoring toolchain, and added `warden --fix` for safe source fixes. Together those changes mean a downstream app upgrading from beta.15 should rethink CLI imports, MCP exposure, public output schemas, resource mocks, error taxonomy, observability, Topographer adoption, and trail-composition vocabulary, not just bump versions.

## Install

`@ontrails/*` packages are versioned in lockstep. Pin every active package to the same beta number.

```bash
bun add @ontrails/core@1.0.0-beta.19 \
        @ontrails/cli@1.0.0-beta.19 \
        @ontrails/commander@1.0.0-beta.19 \
        @ontrails/mcp@1.0.0-beta.19 \
        @ontrails/http@1.0.0-beta.19 \
        @ontrails/hono@1.0.0-beta.19 \
        zod@^4
bun add -d @ontrails/trails@1.0.0-beta.19 \
           @ontrails/testing@1.0.0-beta.19 \
           @ontrails/topographer@1.0.0-beta.19 \
           @ontrails/warden@1.0.0-beta.19
```

`@ontrails/trails` provides the `trails` CLI bin that the framework command scripts (`compile`, `validate`, `diff`, `warden`, `survey`) invoke, so a consumer repo needs it installed for `bun run compile` / `bun run validate` (or `bunx trails …`) to resolve. Pin `zod` to a `^4` major; Trails packages in the beta.19 line target Zod v4 and will fail to typecheck against Zod v3.

If the app authors its own HTTP adapter, add `@ontrails/adapter-kit@1.0.0-beta.19` (new in beta.19) as a dev dependency. See [Beta 18 → Beta 19](#beta-18-to-beta-19).

If the app uses observability or LogTape/Pino forwarding, add `@ontrails/observe`, `@ontrails/tracing`, and one of `@ontrails/logtape` or `@ontrails/pino` from the same beta line. These standalone forwarding packages are the beta.19 shape; current prereleases use subpaths of `@ontrails/observe` instead.

During the beta line, `latest` may intentionally lag behind `beta`. The [Beta Channel Policy](./beta-channel-policy.md) explains the dist-tag posture, install pins versus `@beta`, and read-only registry checks. Do not mix `beta.15`, `beta.18`, `beta.19`, and `@beta` ranges in one app.

For a read-only downstream spot check of the active beta channel, use `npm view` directly — `bun run publish:registry-check` is a Trails-monorepo script and is not available from a downstream consumer repo:

```bash
for pkg in @ontrails/core @ontrails/commander @ontrails/testing @ontrails/topographer; do
  npm view "$pkg" dist-tags --json
done
```

The output makes `latest` lag visible alongside the current `beta` tag without touching the registry.

Do not invoke `npm publish` or `changeset publish` directly for Trails packages. The repo publish command uses Bun to resolve workspace ranges and validate the tarball before handing that tarball to npm for the registry mutation.

## Beta 18 to Beta 19

If you are already on beta.18, these are the only beta.19 deltas that need action. The per-surface sections below still describe the correct end state.

### `cross` → `compose` (breaking)

Beta 19 renames the first-class trail composition family from `cross` to `compose` across core contracts, testing helpers, topo projections, Warden rules, and CLI scaffolds. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary. Topo persistence migrates legacy composition rows and graph keys forward on the next `trails compile`, so committed artifacts re-key themselves.

```diff
- export const report = trail('report', {
-   crosses: ['fetch.data'],
-   blaze: async (ctx) => ctx.cross('fetch.data', input),
+ export const report = trail('report', {
+   composes: ['fetch.data'],
+   blaze: async (ctx) => ctx.compose('fetch.data', input),
  });
```

Rename every `crosses:` declaration to `composes:`, every `ctx.cross(...)` call to `ctx.compose(...)`, and any imported `Cross*` / `crossInput` symbols to their `Compose*` / `composeInput` equivalents. After renaming, run `bun run compile` to re-key the committed `.trails/topo.lock`, then `bun run validate` to confirm no drift remains. (Scaffolded projects expose the framework commands as package scripts — `bun run compile`, `bun run validate`, `bun run diff` — so prefer those over `bun trails …`, which only works where a `trails` script exists; otherwise use `bunx trails …`.)

### Topo artifact commands are top-level

`trails compile` and `trails validate` are the canonical top-level artifact commands. The retired `trails topo compile`, `trails topo verify`, and `trails topo check` shapes now exit non-zero with a diagnostic pointing at the top-level commands. If CI or scripts pinned the `trails topo …` forms, update them. See [Topographer Artifact Workflow](#topographer-artifact-workflow) for the full command set.

### Trail versioning now resolves at runtime (additive)

Trail versioning is no longer authoring-only. Beta 19 resolves trail versions during execution — live revisions, forks, marker references, and unsupported-version errors — and projects live version metadata on CLI, HTTP, and MCP surfaces with explicit surface version selection threaded through shared execution. A version lifecycle CLI — `trails revise`, `trails deprecate` (with `--archive` to archive instead of deprecate), and `trails doctor` for diagnostics — and a top-level `trails diff` that surfaces version, marker, lifecycle-status, and force-event detail ship alongside it. This is additive: apps with no `version: { … }` entries are unaffected. See [Trail Versioning](#trail-versioning) for when to adopt it.

### Adapter authoring with `@ontrails/adapter-kit` (additive)

`@ontrails/adapter-kit` is a new package for authoring and reviewing extracted surface adapters. `trails create adapter` scaffolds an extracted HTTP adapter against adapter target conformance metadata, `trails adapter check` runs the shared readiness engine locally, and Warden exposes the same engine through opt-in `--adapter-check` diagnostics. Only relevant if you maintain or extract a custom adapter; consuming `@ontrails/hono` or `@ontrails/http/bun` needs nothing here.

### Warden safe-fix and scaffold provenance (additive)

`warden --fix` (exposed as `bun run warden -- --fix` in scaffolded projects) applies only `safety: 'safe'` source edits, last-to-first, and reports applied, changed-file, and skipped counts; review-required and topo diagnostics stay reported but unapplied. Newly scaffolded projects also pin `@ontrails/*` to the exact scaffolded version (no caret prerelease ranges), record a `.trails/scaffold.json` provenance breadcrumb, and reconcile existing files on `trails create` reruns instead of overwriting and failing. Existing apps inherit safe-fix on upgrade; scaffold changes only affect projects generated after upgrading.

## CLI Surface

The CLI contract model still lives in `@ontrails/cli`. The Commander runtime now ships in the dedicated `@ontrails/commander` adapter package. The `@ontrails/cli/commander` subpath is removed.

```diff
- import { surface } from '@ontrails/cli/commander';
+ import { surface } from '@ontrails/commander';
```

After moving the import, an app only needs a direct `commander` dependency if it imports Commander APIs itself. `@ontrails/commander` owns the runtime. See [Connector to Adapter](../migration/connector-to-adapter.md) for the broader adapter-package rationale.

CLI surface derivation absorbed two beta.15 layers. Remove these imports — the behavior is automatic now:

- `autoIterateLayer` is gone. Trails whose output schema matches `{ items, hasMore, nextCursor }` automatically get a `--all` flag and the CLI iterates pages for the caller. Opt out per trail with `surface: { cli: { autoIterate: false } }`.
- `dateShortcutsLayer` is gone. Trails with date input fields automatically accept `today`, `yesterday`, `Nd`, `this-week`, and `this-month`. Opt out per trail with `surface: { cli: { dateShortcuts: false } }`.

The `Warden` rule `no-legacy-layer-imports` flags stale references to either layer or to `authLayer`. See [Layer Evolution](../migration/layer-evolution.md).

`trails run` gained `--watch`, `--trace`, `--dry-run`, `--quiet`, `--input`, `--input-json`, `--permit '<json>'`, and `--token <token>` as global meta flags. `--dev-permit` is a local-only synthetic permit; the Warden rule `no-dev-permit-in-source` blocks it from committed source. None of these are required for the migration; they are tools that become available once the upgrade is in place.

## MCP Surface

MCP exposure changed in posture, not in API. The framework can derive everything everywhere, but a real downstream app — especially one with live-control trails — should keep an explicit include list.

The PatchOS modernization treated this as a product decision: read-oriented and recall trails go on MCP; live-control or maintenance trails stay CLI-only. Trails projects layer `input` schemas onto MCP tool `inputSchema` automatically and forwards topo-scope and surface-scope layers through MCP handlers, so the runtime composition is the same as on CLI.

For downstream apps:

1. Decide which trails belong on MCP. Default to recall/read, not control.
2. Express that decision in the app, not in Trails. Build a deliberate list of trail IDs (or a topo-level predicate) and feed it to `surface(app, { mcp: { include: [...] } })`.
3. Add a contract test that asserts the MCP-exposed set matches the intended list, so the boundary is visible in CI rather than relying on review vigilance.

Public MCP and HTTP trails require an `output` schema. The Warden rule `public-output-schema` enforces this. If an MCP-exposed trail does not have one yet, add one before the upgrade lands — see [Public Output Schemas](#public-output-schemas-and-contract-testing) below.

## HTTP Surface

Beta 18 split the HTTP surface around a shared Web Fetch kernel and a Bun-native HTTP binding:

- `@ontrails/http` keeps the framework-agnostic route model and the derived OpenAPI helper (`deriveOpenApiSpec`, moved from `@ontrails/schema` in beta.16).
- `@ontrails/http/fetch` is the shared request/response kernel that HTTP bindings use.
- `@ontrails/http/bun` is the native Bun HTTP binding that uses the fetch kernel.
- `@ontrails/hono` remains the Hono adapter binding.

Pick the binding that matches the deployment target. Hono apps stay on `@ontrails/hono`; Bun-native apps can use `@ontrails/http/bun`. Layer `input` schemas project onto request query (reads) or body (writes), and topo-scope and surface-scope layers compose through HTTP handlers the same way they do on CLI and MCP.

HTTP also gained webhook activation: declared webhook routes participate in topo and Warden coverage. The Warden rule `webhook-route-collision` keeps webhook routes from colliding with each other or with direct HTTP trail routes.

## Public Output Schemas And Contract Testing

Every public MCP and HTTP trail must declare an `output` schema. The Warden rule `public-output-schema` enforces this. Use the most specific schema you can — output schemas feed surface projections, examples-as-tests, and `Topographer` diff sensitivity.

Once outputs are declared and the topo has examples, `testAll(app)` validates the topo, schemas, examples, and resource-backed execution in one call:

```typescript
import { testAll } from '@ontrails/testing';
import { app } from './app.js';

await testAll(app);
```

In beta 17, `@ontrails/testing` gained:

- An HTTP surface harness, with HTTP projection validation in `testAllEstablished`.
- An example-driven CLI/MCP/HTTP surface parity helper (`testSurfaceParity`).

In beta 18 (TRL-757 in this stack), `@ontrails/testing` was split behind explicit subpaths so the root import does not pull `@ontrails/cli`, `@ontrails/mcp`, or `@ontrails/http` into downstream `tsc` for apps that only need contract helpers:

```typescript
// Root: contract helpers only — no surface peers required at install time.
import { testAll } from '@ontrails/testing';

// Surface-aware subpaths — each requires the matching surface peer because the
// subpath module statically imports its surface package.
import { testAllEstablished } from '@ontrails/testing/established';  // needs @ontrails/cli + @ontrails/mcp + @ontrails/http
import { createCliHarness } from '@ontrails/testing/cli';             // needs @ontrails/cli
import { createMcpHarness } from '@ontrails/testing/mcp';             // needs @ontrails/mcp
import { createHttpHarness } from '@ontrails/testing/http';           // needs @ontrails/http
import { testSurfaceParity } from '@ontrails/testing/surface-parity'; // needs @ontrails/cli + @ontrails/mcp + @ontrails/http
```

Surface peers (`@ontrails/cli`, `@ontrails/mcp`, `@ontrails/http`) are now declared optional via `peerDependenciesMeta`. Apps that only use the root `@ontrails/testing` entrypoint can skip them; apps that import any surface-aware subpath must install the peers that subpath reaches for. `testAllEstablished` and `testSurfaceParity` exercise all three surfaces and therefore require all three peers — installing only some will fail at runtime with an unresolved import.

## Resource Mocks And `unmockable`

Live integrations (database adapters, third-party HTTP, hardware bridges) should be `resource()` definitions with `mock` factories. Beta 16 added an explicit `unmockable: { reason }` marker for resources that must not be mocked, and the testing harness skips them in auto-mock resolution. Use `unmockable` deliberately — it is the contract for "this integration must be exercised live or excluded by the test plan."

```typescript
import { resource } from '@ontrails/core';

export const homeAssistant = resource('patch.hass', {
  config: HassConfigSchema,
  unmockable: { reason: 'Drives live home automation; cannot be safely mocked.' },
  // … real factory
});
```

For mockable resources, keep the `mock` factory next to the real factory so `testAll(app)` works without per-test wiring. The PatchOS modernization showed this is what made tests confident without writing a parallel framework around the framework.

## Error Taxonomy

Replace generic `new Error(...)` paths inside blazes with the Trails taxonomy classes (`ValidationError`, `NotFoundError`, `AuthError`, `PermitError`, `ResourceError`, `InternalError`, …). Surfaces project the taxonomy automatically:

- CLI surface maps categories to exit codes.
- HTTP surface maps categories to status codes.
- MCP/JSON-RPC surface maps categories to error codes and `isError` payloads.

The Warden rules `no-throw-in-implementation`, `no-native-error-result`, and `error-mapping-completeness` enforce this. Beta 18 also tightens public error projection: `enforcePermitRequirement` runs intrinsically in `executeTrail` before the blaze, and a shared safe-error projection policy normalizes diagnostics across surfaces.

The migration question is not "should I adopt the taxonomy?" — public trails already need it. The question is whether your CLI/MCP/HTTP exit/status/error-code expectations match what surfaces now project. Adjust integration tests where they assert on the old error shape.

## Observability

`@ontrails/logging` retired before v1. On beta.19, use `@ontrails/observe` for sink contracts and built-in sinks, `@ontrails/tracing` for trace registry and SQLite dev store, `@ontrails/tracing/otel` for OpenTelemetry export, `@ontrails/logtape` for LogTape forwarding, and `@ontrails/pino` for Pino forwarding. Do not substitute the current `@ontrails/observe/logtape` or `@ontrails/observe/pino` subpaths while the app remains pinned to beta.19; those subpaths landed later.

For CLI and MCP apps that care about clean stdout, prefer file-backed sinks for logs and traces. The PatchOS modernization confirmed this is the right shape: opt-in file sinks, no polluted stdout, no MCP payload weirdness. `@ontrails/observe` ships `createConsoleSink`, `createFileSink`, and `createMemorySink` (useful for tests); compose sinks with the observe helpers rather than juggling multiple loggers in app code.

## Topographer Artifact Workflow

Beta 16 renamed `SurfaceMap` to `TopoGraph` and moved the topo-store API from `@ontrails/core` to `@ontrails/topographer`. Beta 16 also introduced the lock v3 manifest plus serialized `TopoGraph` artifact:

- `.trails/trails.lock` — compact lock v3 manifest; verifies adjacent content artifacts by hash.
- `.trails/topo.lock` — serialized `TopoGraph` content artifact; the inspectable resolved graph.
- `.trails/state/trails.db` — ignored mutable SQLite state for snapshots, pins, tracing.
- `.trails/cache/` — ignored rebuildable cache.

The consumer-facing CLI is top-level on the Trails app, not on `@ontrails/topographer`:

```bash
trails compile   # regenerate .trails/trails.lock and .trails/topo.lock
trails validate  # verify committed artifacts against current source
trails diff      # show semantic diff vs. committed artifacts
```

`@ontrails/topographer` ships library APIs, not a separate bin. Retired `trails topo compile` / `trails topo verify` / `trails topo check` shapes now exit `1` with a diagnostic pointing at the top-level commands. See [TopoGraph Artifact Family](../migration/topograph-artifact-family.md) for rename and consumer-API details.

Wire Topographer into CI as a drift tripwire:

```yaml
steps:
  - run: bun install
  - run: bun run validate
```

`bun run validate` exits non-zero on drift. Pair with `bun run diff` in a verbose mode locally if a downstream contributor wants to inspect what changed before regenerating the artifacts.

Consumers that previously parsed `_surface.json` should read `.trails/topo.lock` through `readTopoGraph()` or the typed `createTopoStore()` views — see the [TopoGraph migration](../migration/topograph-artifact-family.md) for examples.

If the app previously depended on `topoStore` / `createTopoStore` exports from `@ontrails/core`, move those imports to `@ontrails/topographer`. Backend-tier helpers live at `@ontrails/topographer/backend-support`.

## Layer Evolution

Beta 16 added typed `Layer` as a real primitive with attachment at four scopes: topo, surface, trail, and per-call. Composition order is `topo → surface → trail → execution-supplied → blaze`. Layers can declare an `input` Zod schema that projects onto CLI flags, MCP `inputSchema`, and HTTP query/body. Layers without `input` remain surface-invisible wrappers (tenant guards, rate limiting, custom audit logging).

[Layer Evolution](../migration/layer-evolution.md) has the full removed-exports list, attachment examples, surface-projection rules, and the collision-rename behavior.

Three legacy layer exports are removed:

- `authLayer` from `@ontrails/permits` — permit enforcement is intrinsic to `executeTrail`. Use `trail({ permit: { scopes: [...] } })`.
- `autoIterateLayer` from `@ontrails/cli` — see CLI surface above.
- `dateShortcutsLayer` from `@ontrails/cli` — see CLI surface above.

## Trail Versioning

As of beta.19, trail versioning is a working runtime, not just authoring primitives. Trails resolves versions during execution (live revisions, forks, marker references, unsupported-version errors), CLI/HTTP/MCP surfaces project live version metadata and accept explicit surface version selection, and a lifecycle CLI (`trails revise`, `trails deprecate` with `--archive`, and `trails doctor`) plus `trails diff` cover revision, deprecation, archival, diagnostics, and version-aware drift. The Warden pressure layer (`version-gap`, `version-without-examples`, `marker-schema-unsupported`, `fork-without-preserved-blaze`, `pending-force`, and the marker-schema bounds checks) backs it.

This does not mean every app should adopt it now. The runtime existing changes what is possible, not what is required. An app with no `version: { ... }` entries is unaffected: the versioning runtime has nothing to resolve and the Warden rules stay quiet because they have no input to chew on.

The PatchOS modernization used Topographer as the drift tripwire and deferred per-trail runtime versioning. That remains the right default until you need it. Adopt trail versioning when:

- An external consumer is pinned to a specific contract.
- A breaking schema change needs an explicit successor entry.
- You want pending-force gating to enforce explicit acceptance of removed entries.
- You want surfaces to negotiate and report a specific contract version to callers.

Until one of those is true, ship trails without `version: { ... }` entries. When one becomes true, the beta.19 runtime, lifecycle CLI, and surface negotiation are in place to support it — you no longer have to wait for the pipeline to land.

## Validation Checklist

Run these from a clean working tree on the upgraded branch. They are the same gates Trails uses internally:

```bash
# Install lockfile aligned to beta.19
bun install

# Read-only registry spot check (downstream-safe; `bun run publish:registry-check`
# is a Trails-monorepo script and is not available from a consumer repo)
for pkg in @ontrails/core @ontrails/commander @ontrails/testing @ontrails/topographer; do
  npm view "$pkg" dist-tags --json
done

# Repo gate
bun run check
bun run test
bun run build

# Drift detection
bun run validate

# Whitespace/conflict guard
git diff --check
```

For a downstream app, the typical CI shape is `bun install` → `bun run test` → `bun run validate`. Add `bun run typecheck` if the app's test runner does not already typecheck.

If `bun run validate` flags drift, regenerate locally with `bun run compile`, review the diff with `bun run diff`, and commit `.trails/trails.lock` plus `.trails/topo.lock`. Do not commit `.trails/state/` or `.trails/cache/` artifacts; the workspace `.trails/.gitignore` keeps them local.

## References

- [Beta 15](./beta15.md) — the prior beta line, including the surface API cutover, the lexicon cutover, and the retired `@ontrails/tracker` / `@ontrails/logging` package names.
- [Beta Channel Policy](./beta-channel-policy.md) — install pins, `@beta` versus exact, `latest` lag, version-bump cadence, and no direct `npm publish` / `changeset publish`.
- [Trailhead to Surface](../migration/trailhead-to-surface.md) — the surface-vocabulary cutover and trace/OTel/dev-store updates.
- [Connector to Adapter](../migration/connector-to-adapter.md) — adapter package taxonomy and the `@ontrails/commander` cutover.
- [Observability](#observability) — the historical beta.19 package graph, sink imports, and OTel export.
- [Layer Evolution](../migration/layer-evolution.md) — typed `Layer` primitive, attachment scopes, surface projection, removed exports.
- [TopoGraph Artifact Family](../migration/topograph-artifact-family.md) — current artifact layout, rename map, consumer-API updates.
- [Stable Cutover Runbook](./stable-cutover.md) — the eventual beta-to-1.0 sequence.
