---
id: 54
slug: project-substrate-names-its-truth
title: Project Substrate Names Its Truth
status: accepted
created: 2026-06-22
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [10, 11, 14, 15, 17, 41, 42, 46]
---

# ADR-0054: Project Substrate Names Its Truth

## Context

Trails' pre-1.0 project substrate grew from several locally correct decisions that no longer compose cleanly.

The first serialized graph contract put a manifest and graph artifact under `.trails/`. The current Topography implementation instead writes one root `trails.lock` envelope and keeps the queryable topo store in per-user state. Config became schema-driven deployment state, while project identity still leaked through package-manager workspaces, module paths, command working directories, and Warden's separate app list. A standalone app can usually infer what it owns. A monorepo with several runnable apps cannot make the same claim without choosing which of those signals is authoritative.

The original version of this draft settled the substrate's path roles but left the central workspace question open: should a monorepo commit one aggregate lock or let each runnable app own a lock? Adopters reasonably organize monorepos both ways. Independently owned applications want branch-local lock diffs. A unified repository may eventually want one workspace review artifact. Treating either preference as the only honest model would overfit one style of monorepo. Treating both artifacts as simultaneous authorities would be worse: every operation would first need to decide which truth won.

The core premise supplies the boundary:

> Author what's new, derive what's known, override what's wrong.

Authored project identity belongs in static config. Each runnable app's resolved graph belongs to Topography. Workspace-wide facts derive from those two owners. Runtime still loads exactly one selected app implementation. The artifact layout must make those ownership boundaries legible without creating a new Core workspace primitive or asking operators to keep parallel lists in sync.

This ADR supersedes ADR-0046's artifact-family container and workspace-layout decision while retaining its durable-graph, Topography-ownership, and migration principles.

## Decision

**Project substrate is named by role, and a runnable Trails app is the v1 lock-owning unit.** A configured workspace statically names a set of those apps. Topography derives a canonical app-partitioned workspace view without merging their runtime topos or creating a second current truth.

### Paths name lifecycle

Bare `trails` as a path segment belongs to authored trail definitions. `src/trails/` is the recommended source-layout home and `trails/` is the flat layout peer. The framework does not reserve a root `trails/` control directory. Source layout is guidance, not graph identity; the authored contracts and topo assembly remain the owners.

Root `trails.*` files hold hoisted project control and resolved truth:

```text
trails.config.ts        # authored config; supported data formats are peers
trails.config.local.ts  # authored local override; ignored
trails.lock             # committed resolved graph for one lock-owning scope
```

TypeScript, JSON, JSONC, YAML, and TOML config files are peers when they satisfy the same schema and static-project rules. TypeScript provides typed authoring and imports for resolved deployment sections; it does not gain semantic privilege or weaken static app-declaration proof. Local config overrides remain deployment input. They are private, ignored, and never alter project identity.

`.trails/` is committed project control, not disposable state. Project-local Warden rules and Regrade plans or history belong there because their placement expresses project ownership. Cache entries, SQLite databases, generated lock fragments, temporary mirrors, and machine-local observations do not. A bare `.trails/` directory is not itself a project-root marker.

Rederivable acceleration and observed runtime state live outside the working tree. The per-user Trails state store owns `trails.db` and its topo snapshots, pins, traces, and subsystem state. A future cache may use the per-user cache tier. Losing either store may remove acceleration or history; it must not alter committed project truth. This ADR does not define cache keys or incremental compilation.

### One app owns one app lock

A **Trails app** is one lock-owning project scope that assembles one canonical runnable topo. In a configured workspace, the static `workspace.apps` declaration is the authored ownership decision. Each key is a canonical app ID; each value names one project-relative app root and, when convention cannot resolve it, an app entry. That entry must resolve one topo whose authored name equals the key. The app root owns one root `trails.lock`; when the lock is present or required, its app scope must equal the same ID. The declaration establishes workspace app identity. Root, entry, topo name, and lock evidence verify binding and readiness rather than creating another app list.

Surface choice neither grants nor removes app status. A shared trail library or reusable topo is not a workspace app merely because it is packaged or can assemble graph facts; it contributes through the declared app that owns the resulting graph. It becomes a separate app only when it is explicitly declared as its own lock-owning app root. Conversely, a declared app may expose only the library surface. Its declaration and bindings, not its surface mix, establish its workspace identity; a generated package artifact is not a second app.

A standalone app needs no workspace declaration. Its app root, config when present, and `trails.lock` form one project scope.

A configured workspace is an explicit root-owned map from canonical app IDs to project-relative app roots. An app entry may be overridden only when the shared convention cannot resolve it. This is the semantic shape, not a ruling on the final TypeScript helper syntax:

```ts
workspace: {
  apps: {
    trails: { root: 'apps/trails' },
    demo: { root: 'apps/trails-demo' },
    junction: { root: 'examples/junction' },
  },
}
```

Configured apps are lock-owning Trails apps, not every package or topo in the repository. App IDs are unique. App roots are normalized, project-relative, path-safe, and unique within the workspace. Wildcard app discovery is not allowed in v1: adding a directory must not silently change project identity without a config diff. Package-manager workspaces may offer migration coaching or discovery hints when no Trails workspace is configured, but they never establish the authoritative or complete app set.

The topo's authored name is the canonical app ID. The workspace key references that identity rather than introducing a second alias. An app lock must have a scope app ID equal to its configured ID. Duplicate IDs, missing roots, multiple runnable app entries under one lock-owning root, binding mismatches, and paths that escape the workspace trust boundary fail closed.

Renaming a topo therefore changes a governed contract. The same change updates `workspace.apps` and regenerates the app lock. A binding failure after a half-completed rename is the designed catch, not a usability defect. Regrade is the vehicle for moving the governed identity and proving its derived references.

### Workspace apps are static project identity

The root config contains two kinds of information with different lifecycles:

- a static project section that establishes workspace identity; and
- resolved deployment config governed by ADR-0011's base, profile, local, and
  environment behavior.

The `workspace.apps` declaration belongs to the first kind. It is canonical, JSON-compatible literal data and does not pass through `defineConfig.resolve()`. Data-format configs satisfy the source shape directly. A TypeScript config must express the workspace section as an inline literal or a recognized config-owned literal helper whose value can be proven without executing arbitrary user code.

Environment or global reads, arbitrary calls or imports, spreads, computed keys, and conditional app declarations are invalid. An unprovable section returns a typed config `ValidationError` before a workspace operation loads apps. One source-static predicate owns this proof; config loading and Warden consume the same canonical result instead of maintaining separate syntax rules.

This specializes ADR-0011 rather than replacing it. Deployment values retain the flexibility that ADR permits. Project identity does not vary by profile, machine, local override, or process environment.

Warden derives its default runnable-app targets from `workspace.apps`. During migration, the current heterogeneous `warden.apps` values are normalized once and retired in the same change. A Warden app selector may remain an invocation filter, but a second persistent app list may not survive the cutover.

### A workspace derives one app-partitioned view

Topography derives a canonical workspace view from static app declarations and the app graphs. It preserves app ownership rather than concatenating every trail into one unqualified `entries` collection. The same trail ID may exist in several apps; that is a collision fact, not corrupted graph data.

The view has two conceptual layers, even when an API returns one envelope.

The **canonical graph-content layer** contains:

- deterministically sorted app IDs;
- normalized, project-relative app roots;
- each app's full graph envelope and graph hash;
- collision facts that preserve every owner; and
- the workspace-view schema version.

Its one canonical hash is named `workspaceViewHash`. The hash material is exactly the schema version, sorted app IDs, project-relative roots, app graph hashes, and collision facts. App roots are material because moving an app is a structural change in workspace binding. Full app graphs contribute through their graph hashes. No second “semantic hash” ships without a distinct consumer.

The **observation-evidence layer** contains the posture and provenance of the current read: configured and selected scopes, app-lock locations, binding verdicts, completeness, freshness, and typed collection skips. Observation evidence is never `workspaceViewHash` material. Two observations may carry different provenance while resolving to the same canonical view.

V1 configured workspaces use app locks. There is no public lock strategy, aggregate encoder, or hybrid posture. A future aggregate lock is reserved as a lossless canonical serialization of the graph-content layer. If an aggregate posture is later justified, a workspace selects it **instead of** app locks; the two never become coequal authorities. Its bytes and public configuration remain undecided, but its meaning is already constrained to the same canonical view and `workspaceViewHash`.

### Freshness is proved, not inferred from the graph hash

An app graph hash proves the integrity of the graph stored in its lock. It does not prove that the graph matches the current checkout's authored source. Machine-local source fingerprints may accelerate invalidation, but they do not become committed authority. In particular, v1 does not copy a broad source fingerprint into app locks: implementation-only edits would churn a contract artifact, while imports outside an app root could still escape that scan.

The required posture depends on the claim:

- Saved Wayfinder navigation may present a lock-derived view with freshness
  `unknown`.
- Workspace validation and Warden live-derive every required app and compare
  graph hashes before claiming current completeness.
- Unqualified workspace execution proves every ownership-contributing app
  fresh or derives the ownership index live before selecting an app.
- A stale, missing, or invalid unrelated app blocks a workspace-wide claim,
  but does not block explicitly selected execution of a healthy app.
- A partial Wayfinder view may be useful, but it must identify itself as
  partial and carry typed missing or skipped evidence.

This preserves ADR-0042's lifecycle boundary. Topography derives, saves, compares, and explains graph facts. Runtime execution still loads the selected app's implementation; a saved workspace view is not a merged runtime topo.

### Project, working tree, and collection root remain distinct

Project identity is durable config and lock binding. Working-tree identity is one checkout, index, branch, and uncommitted state. A collection root is the one working tree observed by an invocation.

Upward project discovery stops at the current working-tree boundary. A linked worktree belongs to the same project but is a different observation. Nested repositories, submodules, nested worktrees, and other collection boundaries are not silently absorbed into the configured app set; Source reports them as typed collection edges or skips. Direct invocation inside one remains a first-class collection root.

Nested or overlapping Trails workspace declarations fail closed in v1. A configured app may not declare another workspace section. CWD inside that app reports a typed error naming both roots rather than choosing one by proximity. Internal and external federation both require a future typed model; machine-specific worktree locations never enter committed project identity or the canonical workspace view.

### Commands share one selection contract

Every operator command derives the same project context: collection boundary, workspace and app roots, selected extent, selection provenance, configured app identity, and binding or completeness status.

The Trails operator owns the shared project-context resolver because it interprets Trails-specific flags and command cardinality. It composes static project identity and root discovery from `@ontrails/config`, collection-boundary evidence from `@ontrails/source`, and lock, graph, freshness, and completeness facts from `@ontrails/topography`. Those packages keep ownership of their facts; the operator derives command selection and renders its provenance.

Selection precedence is:

1. `--root-dir` fixes the discovery boundary exactly.
2. `--app` selects one configured app inside that boundary.
3. Otherwise, CWD inside an app root selects that app; CWD at a configured
   workspace root selects the workspace; a standalone project selects its app.
4. `--module` is an app-local or custom-layout escape hatch. It may refine
   the selected app entry, but it never changes the lock root, bypasses
   configured binding, or downgrades a workspace-wide assertion.

The v1 command cardinality is deliberately small:

| Command | App root or standalone CWD | Configured workspace root | Explicit `--app` |
| --- | --- | --- | --- |
| `compile` | Compile one app lock. | Require `--app`; do not fan out. | Compile the selected app lock. |
| `validate` | Validate one app. | Validate the configured app set, binding, locks, and live graphs for the complete workspace. | Validate one app. |
| `run` | Resolve only in the current app. | Resolve against a complete fresh or live ownership view; coach collisions toward `--app`. | Run that app even when unrelated apps are unavailable. |
| Wayfinder | Navigate one saved app graph. | Navigate the app-partitioned workspace view; label partial views. | Navigate one app. |
| semantic diff | Compare one app scope. | Compare complete app-partitioned views. | Compare one app. |
| Warden | Evaluate project facts from the collection root and default topo-aware rules to the current app. | Evaluate project facts, every configured topo, and workspace rules. | Preserve project facts and narrow app or topo-aware rules to the selected app. |

Workspace-root `compile` does not fan out in v1. Multi-lock writes would require transaction planning, partial-failure behavior, force semantics, and recovery that current adopter evidence does not justify. The typed error names the configured apps and the corrective `--app` command. If repeated use proves an all-apps operation valuable, it can be designed explicitly later.

App selection and source-collection scope are separate axes. Selecting one app does not make shared project source disappear, and a project-wide source scan does not claim complete workspace topo evidence when only one app was selected. Structured command results carry selected extent and provenance. Human success output may stay concise; errors explain the selection and the exact corrective action.

## Consequences

### Positive

- Path shape tells adopters whether a file is authored source, project control,
  committed resolved truth, local override, or per-user state.
- Standalone apps keep the obvious one-app, one-lock model.
- Independently owned monorepo apps get branch-local lock diffs without losing
  a complete workspace view.
- A unified monorepo can later adopt one aggregate serialization without
  changing workspace meaning or supporting two competing truths.
- Workspace identity becomes an authored contract instead of a guess from
  package-manager layout, CWD, or duplicated configuration.
- Topography, Source, Warden, Regrade, and runtime keep their existing lifecycle
  responsibilities; no new Core workspace primitive is required.
- Collision, partial-checkout, freshness, and binding failures become typed
  facts rather than accidental command behavior.

### Tradeoffs

- A configured workspace must list its apps explicitly. That is more deliberate
  than a glob and intentionally makes app-set changes reviewable.
- Workspace-wide validation and unqualified routing can require loading several
  apps even though execution ultimately runs one.
- V1 has no one-command compile for every app. Repeated compile orchestration
  remains outside the primitive until adoption evidence justifies a transaction.
- A topo rename now requires coordinated config and lock changes. The stronger
  coupling is the cost of having one canonical app identity.
- Current commands and tests that infer scope independently must converge on one
  selector before the UX is trustworthy.

### Risks

- **A second authority survives migration.** Keeping `warden.apps`, package
  workspace discovery, or a root workspace index as a coequal app authority would
  restore the drift this ADR removes. Mitigation: derive every default consumer
  from `workspace.apps` and retire duplicate persistent lists in the cutover.
- **Hash meaning gets widened casually.** Adding freshness or machine-local
  evidence to `workspaceViewHash` would make equivalent views compare unequal.
  Mitigation: hash only the enumerated canonical graph-content fields and
  version that schema.
- **A partial observation is presented as complete.** A missing app could
  produce unsafe unqualified routing. Mitigation: fail closed for workspace-wide
  claims and expose typed completeness evidence everywhere else.
- **Aggregate becomes a speculative second product.** Encoding it before a real
  consumer would add compatibility surface without changing v1 capability.
  Mitigation: reserve its semantics now and defer its bytes, configuration, and
  implementation.

## Migration and acceptance proof

The implementation cutover must move owners together rather than teaching an intermediate dual model:

1. Keep compatibility readers for the previous `.trails/trails.lock` plus
   `.trails/topo.lock` family long enough to produce a specific regeneration
   path. New writes remain root `trails.lock` only.
2. Add the static workspace predicate and shared project-context derivation
   before routing commands through them.
3. Normalize the current `warden.apps` values into configured apps,
   derive Warden targets from that owner, and remove the old list in the same
   change.
4. Use Regrade for topo-ID renames or other governed identity moves; do not
   repair bindings with ad hoc replacement.
5. Update the accepted ADRs, docs, scaffolds, skills, and generated guidance
   that still teach the superseded artifact family or repo-local mutable state.

The Trails repository is the distribution proof. Its root config declares all seven runnable apps by canonical topo ID: `trails`, `demo`, `junction`, `lookout`, `packlist`, `stash`, and `switchback`. Every app satisfies the static binding and owns a deterministic lock. The flagship `apps/trails/trails.lock` becomes committed evidence rather than a temporary artifact, and `apps/trails-demo/trails.lock` is added after deterministic lock generation lands. The stable-cutover runbook stops deleting the flagship lock.

Acceptance requires scope invariance: the same command with the same declared app scope produces the same selection and verdict from the repository root and from that app root. It also requires complete workspace validation, collision coaching, copied or relocated lock-binding failures, stale and partial-app failure evidence, Warden and Wayfinder provenance, cold byte-identical lock round-trips, and a fresh standalone scaffold proving compile, validate, then run. Lock commits follow determinism work; they are proof of the contract, not hand-authored fixtures.

## Non-goals

- Requiring one source layout beyond the existing `src/trails/` and flat
  `trails/` guidance.
- Adding a Core workspace primitive or merging app runtime topos.
- Shipping an aggregate lock, public strategy flag, or app-lock-plus-aggregate
  hybrid in v1.
- Adding workspace-root compile fan-out or a multi-lock transaction.
- Making package-manager workspaces, filesystem order, or CWD the authority for
  project identity.
- Supporting nested, overlapping, or cross-working-tree workspace federation
  in v1.
- Adding wildcard app declarations, app kinds, `noLock` classifications, workspace
  add/remove commands, generated CI matrices, or an incremental workspace
  compiler.
- Committing a broad source fingerprint as contract truth.

## Non-decisions

- The exact public TypeScript helper spelling for the static `workspace.apps`
  declaration.
- The existing-compatible owner and spelling of a custom app-entry override.
- The JSON schema, byte encoding, and compatibility window of a future aggregate
  lock.
- Cache key layout, cache sharing, and incremental compilation strategy.
- A future federation model for nested or separately checked-out projects.
- Public qualification grammar beyond the v1 `--app` selector.
- Whether repeated adoption justifies explicit all-apps compile or workspace
  lifecycle commands after v1.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — defines authored,
  derived, enforced, observed, and overridden information.
- [ADR-0001: Naming Conventions](0001-naming-conventions.md) — establishes
  names as architectural signals; current vocabulary is governed by the live
  lexicon.
- [ADR-0010: Native Infrastructure](0010-native-infrastructure.md) — contains
  the older repo-local infrastructure layout this ADR replaces.
- [ADR-0011: Schema-Driven Config](0011-schema-driven-config.md) — remains the
  deployment-config contract and is specialized here for static project
  identity.
- [ADR-0014: Core Database Primitive](0014-core-database-primitive.md) and
  [ADR-0015: Topo Store](0015-topo-store.md) — establish the shared database
  and queryable graph-history primitives; their current-law annotations retire
  the old project-local path examples.
- [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md) — its
  durable graph promise continues; a workspace catalog becomes the canonical
  app-partitioned view rather than one merged graph.
- [ADR-0041: Unified Observability](0041-unified-observability.md) — keeps
  observed runtime evidence distinct from committed project truth.
- [ADR-0042: Core/Topography Boundary Doctrine](0042-core-topography-boundary-doctrine.md)
  — keeps durable graph facts and comparison in Topography while runtime loads
  one selected app.
- [ADR-0046: Lock v3 Artifact Family](0046-lock-v3-artifact-family.md) — the
  artifact container and workspace layout this ADR supersedes.
- [ADR-0053: Regrade Moves Governed Contract Change](0053-regrade-moves-governed-contract-change.md)
  — governs topo-ID renames and their evidence.
- [Topography package guide](../../packages/topography/README.md) — documents
  the current root lock envelope, legacy readers, topo store, and Wayfinder
  ownership.
- [Codebase navigation](../contributing/codebase-navigation.md) — defines
  working-tree identity, collection boundaries, typed skips, and Wayfinder's
  saved-artifact posture.
