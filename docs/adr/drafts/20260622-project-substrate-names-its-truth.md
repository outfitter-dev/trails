---
slug: project-substrate-names-its-truth
title: Project Substrate Names Its Truth
status: draft
created: 2026-06-22
updated: 2026-06-22
owners: ['[galligan](https://github.com/galligan)']
depends_on: [17, 42, 46, 50]
---

# ADR: Project Substrate Names Its Truth

## Context

The pre-1.0 project substrate grew from several correct local choices that no longer compose cleanly.

Topographer wrote a `.trails/trails.lock` manifest beside `.trails/topo.lock`. The store moved toward XDG state, but older docs and tests still taught `.trails` as a mixed home for committed lock files, disposable cache, local state, and project-local rules. Config existed as a schema-backed primitive, while Trails itself still privileged direct module imports. Warden rules briefly looked like a reason to reserve a root `trails/` control directory, even though Trails also allows `trails/` or `src/trails/` to be the user's authored trail definitions.

That makes agents pause in the wrong place. When a path is named `.trails/X`, the path should tell the reader whether it is authored, derived, safe to delete, or the resolved truth. If the answer requires a table of exceptions, the substrate is asking agents and developers to memorize lifecycle instead of reading it from shape.

The contract-first model gives us the rule. Authored intent belongs in the repo. The one diffable resolved truth belongs in the repo. Pure derivation and observed runtime state do not.

## Decision

Project substrate is named by role.

### `trails` Is The Primitive

Bare `trails` as a path segment belongs to user-authored trail definitions.

This means `src/trails/` is the recommended source-layout home, and `trails/` is the equivalent flat-layout home. The framework does not reserve bare `trails/` for control files at the repo root, in packages, or in apps. A workspace member such as `packages/foo/trails/` should never have to compete with a framework control directory of the same name.

The framework recommends `src/trails/` for new scaffolds, but correctness comes from the authored contracts and app assembly, not from directory naming. The directory is guidance, not a graph source.

### `trails.*` Files Are Hoisted Control And Truth

Every project root may carry the same small root family:

```text
trails.config.ts        # authored config; other formats are peers
trails.config.local.ts  # authored local override; gitignored
trails.lock             # committed resolved truth
```

`trails.config.ts` is the natural primary in a TypeScript framework. JSON, JSONC, YAML, and TOML configs are peers when they resolve to the same static, schema-valid object. TypeScript buys typed authoring and imports; it does not buy semantic privilege. Likewise, data formats are not more canonical than TypeScript. The contract is the schema-valid object after loading.

Local overrides stay near the config they override. They are authored and private, so they live in the repo tree and stay gitignored.

### `.trails/` Is Committed Control

The dot-prefixed directory is a committed control directory, like `.github/` or `.changeset/`. It holds Trails control surfaces that do not have an obvious root filename.

The first committed control surface is project-local Warden rules:

```text
.trails/
  rules.ts
  rules/*.ts
```

Rules are discovered by presence for local project rules. Shareable or external rule packs are referenced explicitly by config. A bare `.trails/` directory is not a project-root marker by itself; a member can contribute `.trails/rules.ts` or `.trails/rules/*.ts` without becoming a separate Trails project root.

`.trails/` is not disposable. Do not put cache, generated lock fragments, local SQLite databases, or temporary mirrors there.

### `trails.lock` Is The One Committed Lock

`trails.lock` is the one committed resolved truth. It absorbs the old lock manifest role and the old `topo.lock` graph role into one root envelope.

The lock is derived, but it is still committed because its diff is governance. It lets humans, agents, Warden, Wayfinder, release checks, and review automation inspect the resolved graph without loading the app. That is the exception that proves the lifecycle rule: keep the derived artifact only when its diff is the review surface.

Compatibility readers may understand the previous `.trails/trails.lock` plus `.trails/topo.lock` artifact family during the migration window. New writes should converge on root `trails.lock`.

### Derived And Observed State Leave The Repo

Pure derivation and observed runtime state move out of the working tree:

```text
$XDG_CACHE_HOME/trails/<content-key>/  # rederivable cache
$XDG_STATE_HOME/trails/<project-key>/  # observed tracing and runtime history
```

Absence of these stores must be tolerable. Cache absence means a cold rebuild. Observed-state absence means empty history that re-accumulates. Neither can make the project wrong.

The existing database split follows the information architecture:

- topo snapshots are projected, rederivable facts and belong in the cache tier;
- tracing is observed runtime telemetry and belongs in the state tier.

Content-addressed cache keys make worktrees and agents safe to share the same global cache. A hit happens only for byte-identical inputs, and cache entries are immutable by key. Git diff can decide what to inspect; the content hash decides what to trust.

## Consequences

### Positive

- A path's shape carries lifecycle. Agents can tell whether a file is primitive source, project control, resolved truth, local override, cache, or observed state without memorizing exceptions.
- Root `trails/` remains available for user-authored trail definitions in flat layouts and nested workspace packages.
- `trails.lock` becomes the single queryable resolved graph artifact instead of a manifest that points at a second committed file.
- `.trails/` can grow as a control directory without mixing committed files and disposable state.
- Worktree farming gets a safe warm path through content-addressed global cache entries rather than copied working-tree artifacts.

### Tradeoffs

- `rm -rf .trails` stops being a cache-clearing reflex. It is a control directory and should be treated like `.github/`.
- The migration touches Topographer, Wayfinder, Warden drift checks, CLI compile/validate flows, scaffolds, docs, and agent guidance.
- Tools need explicit cache and state management commands because the easy answer is no longer "look inside `.trails/cache`."
- The lock envelope needs a compatibility bridge for older beta artifact families so existing consumers get a clear migration error instead of a generic parse failure.

### Risks

The biggest risk is pretending the new substrate is mostly documentation. It is not. If docs claim root `trails.lock` while compile still writes `.trails/topo.lock`, the project teaches drift. The code, docs, skills, scaffold output, and release guidance must move together.

Incremental compilation remains deferred. The cache key shape should not foreclose it: v1 can ship coarse reuse while keying at a granularity that can support per-file parse and graph assembly later.

## Non-goals

- This ADR does not require one source layout. It recommends `src/trails/` and keeps flat `trails/` valid.
- This ADR does not define a general config framework. It defines how Trails consumes static, schema-valid project config and how adopters can use the same primitive.
- This ADR does not build incremental compilation.
- This ADR does not decide whether a workspace should use one centralized lock or per-project locks for every member. It requires each lock to be a root `trails.lock` for the scope that owns it.

## References

- [ADR-0017: The Serialized Topo Graph](../0017-serialized-topo-graph.md) — established the resolved graph as a serialized artifact.
- [ADR-0042: Core/Topographer Boundary Doctrine](../0042-core-topographer-boundary-doctrine.md) — keeps durable graph derivation owned outside core runtime contracts.
- [ADR-0046: Lock v3 Artifact Family](../0046-lock-v3-artifact-family.md) — the artifact family this ADR collapses into one root lock.
- [ADR-0050: Surface Accommodations Preserve Trail Identity](../0050-surface-accommodations-preserve-trail-identity.md) — preserve authored contract identity.
- [Trails Substrate converged note](../../../.agents/notes/2026-06-22-trails-substrate-converged.md) — local decision capture used to draft this ADR.
