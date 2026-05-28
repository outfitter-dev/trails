---
created: 2026-05-17T15:32:43Z
updated: 2026-05-20T03:58:14Z
description: Reference index for the HTTP Bun + Observability Closeout stack. Lists tracked portable sources (AGENTS.md, PLAN.md, key source files), untracked local-only scratch notes, tracker records for all 14 execution issues and 2 umbrella issues, PR/branch order, prior archived plan packets, and full validation command inventory including forbidden publish commands.
impl_status: implemented
linear:
  - TRL-715
  - TRL-716
  - TRL-717
  - TRL-718
  - TRL-719
  - TRL-720
  - TRL-721
  - TRL-722
  - TRL-723
  - TRL-724
  - TRL-725
  - TRL-726
  - TRL-727
  - TRL-365
  - TRL-424
  - TRL-426
references:
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - .agents/plans/2026-05-16-http-bun-observability-closeout/PLAN.md
  - .agents/plans/2026-05-16-http-bun-observability-closeout/GOAL.md
  - .agents/plans/2026-05-16-http-bun-observability-closeout/RETRO.md
  - adapters/hono/src/surface.ts
  - adapters/hono/src/__tests__/surface.test.ts
  - packages/http/src/build.ts
  - packages/http/package.json
  - packages/core/src/transport-error-map.ts
  - packages/logtape/src/index.ts
  - packages/logtape/package.json
  - packages/observe/src/index.ts
  - packages/tracing/src/adapters/otel.ts
  - packages/tracing/package.json
  - docs/adr/0005-framework-agnostic-http-route-model.md
  - docs/adr/0029-connector-extraction-and-the-with-packaging-model.md
  - docs/adr/0035-surface-apis-render-the-graph.md
  - .agents/plans/archive/2026-05-13-v1-readiness-closure-stack/
  - .agents/plans/archive/2026-05-12-topograph-query-docs-stack/
---

# References: HTTP Bun + Observability Closeout Stack

## Tracked / Portable Sources

- `AGENTS.md` - repo guidance for Trails commands, Graphite workflow, release process, Linear usage, and Warden rule posture.
- `.agents/plans/PLANNING.md` - repo-local goal-planning preferences, including local review loops, no merge queue label, no merge, and Bun-based publish guidance.
- `.agents/plans/2026-05-16-http-bun-observability-closeout/PLAN.md` - primary execution contract.
- `.agents/plans/2026-05-16-http-bun-observability-closeout/GOAL.md` - pasteable goal prompt.
- `.agents/plans/2026-05-16-http-bun-observability-closeout/RETRO.md` - running execution log.
- `adapters/hono/src/surface.ts` - current Hono implementation and extraction source for HTTP kernel behavior.
- `adapters/hono/src/__tests__/surface.test.ts` - current Hono behavior tests to preserve and mirror.
- `packages/http/src/build.ts` - HTTP route derivation owner.
- `packages/http/package.json` - export-map owner for `./fetch` and `./bun`.
- `packages/core/src/transport-error-map.ts` - `projectPublicSurfaceError` vs `projectSurfaceError` behavior.
- `packages/logtape/src/index.ts` - structural logger adapter pattern to mirror for `@ontrails/pino`.
- `packages/logtape/package.json` - package metadata pattern for the Pino package.
- `packages/observe/src/index.ts` - log/observe sink contracts.
- `packages/tracing/src/adapters/otel.ts` - OTel adapter implementation target.
- `packages/tracing/package.json` - `@ontrails/tracing/otel` export-map owner.
- `docs/adr/0005-framework-agnostic-http-route-model.md` - HTTP projection doctrine.
- `docs/adr/0029-connector-extraction-and-the-with-packaging-model.md` - package boundary doctrine to amend or cite.
- `docs/adr/0035-surface-apis-render-the-graph.md` - `derive*` / `create*` / `surface()` storyline.

## Untracked / Local-Only Sources

- `.scratch/2026-05-14-http-bun-observability-closeout/clark-review.md` - original local planning review. Its load-bearing content has been summarized into this packet and the related Linear issues. Executors do not need it.
- `.scratch/2026-05-14-http-bun-observability-closeout/clark-brief.md` - earlier brief that preceded Clark/Codex revisions. Superseded by this packet and current Linear issue bodies.

## Copied Or Summarized Sources

- `PLAN.md` summarizes the revised stack, exact branch order, issue scopes, PR #447 lift/do-not-lift guidance, Pino package decision, OTel subpath decision, review loops, validation gates, and stop rules from the scratch note.
- `RETRO.md` records tracker mutations that were completed before packet creation.
- `GOAL.md` carries the compact `/goal` contract and exact stack order.

## Tracker Records

Execution issues:

- `TRL-715` - `@ontrails/http/fetch` Web Fetch kernel.
- `TRL-727` - ADR/amendment for Web Fetch kernel extraction principle.
- `TRL-719` - Hono consumes `@ontrails/http/fetch`.
- `TRL-716` - Bun-native surface at `@ontrails/http/bun`.
- `TRL-717` - Hono/Bun HTTP parity harness.
- `TRL-720` - scaffold publishable `@ontrails/pino`.
- `TRL-721` - implement structural Pino sink.
- `TRL-722` - document and gate `@ontrails/pino` publishing.
- `TRL-723` - complete OTel attribute mapping.
- `TRL-724` - harden OTel lineage/status semantics.
- `TRL-725` - harden OTel buffering, flush, and exporter failures.
- `TRL-726` - document `@ontrails/tracing/otel` v1 boundary.
- `TRL-365` - continue deeper CI optimization after workflow fan-out.
- `TRL-718` - docs closeout before versioning.

Umbrella / parent issues:

- `TRL-424` - parent for `@ontrails/pino` work.
- `TRL-426` - parent for `@ontrails/tracing/otel` hardening.

Dependency summary:

- `TRL-715` blocks `TRL-719`, `TRL-716`, `TRL-717`.
- `TRL-716` blocks `TRL-717`.
- `TRL-720` blocks `TRL-721`; `TRL-721` blocks `TRL-722`.
- `TRL-723` blocks `TRL-724` and `TRL-725`; `TRL-724` and `TRL-725` block `TRL-726`.
- `TRL-718` waits on `TRL-715`, `TRL-719`, `TRL-716`, `TRL-717`, `TRL-722`, `TRL-726`, and `TRL-727`.

## PRs / Branches

- PR #447 `feat(adapters): add @ontrails/bun adapter` - closed, not merged. Use as seed material only. Do not revive as the stack base.
- PR #479 `docs: refresh taxonomy and vocab audit metadata` - open stale draft, unrelated to this stack. Do not build on it.
- PR #513 `chore: version packages to 1.0.0-beta.17` - merged and present on current `main`.

Branch order:

1. `trl-715-refactorhttp-extract-web-fetch-kernel-at-ontrailshttpfetch`
2. `trl-727-docsadr-codify-web-fetch-kernel-extraction-principle`
3. `trl-719-refactorhono-consume-ontrailshttpfetch-kernel`
4. `trl-716-feathttp-add-bun-native-surface-at-ontrailshttpbun`
5. `trl-717-testhttp-lock-hono-and-bun-http-surface-parity`
6. `trl-720-chorepino-scaffold-publishable-ontrailspino-package`
7. `trl-721-featpino-implement-structural-pino-log-sink`
8. `trl-722-docspino-document-and-gate-ontrailspino-publishing`
9. `trl-723-feattracing-complete-otel-attribute-mapping`
10. `trl-724-testtracing-harden-otel-trace-lineage-and-status-semantics`
11. `trl-725-fixtracing-harden-otel-buffering-flush-and-exporter-failures`
12. `trl-726-docstracing-document-ontrailstracingotel-v1-boundary`
13. `trl-365-continue-deeper-ci-optimization-after-workflow-fan-out-lands`
14. `trl-718-docs-close-http-and-observability-wording-before-versioning`

## Prior Plans

- `.agents/plans/archive/2026-05-13-v1-readiness-closure-stack/` - completed V1 readiness closure packet. The active tracked packet was moved to the ignored archive during this planning pass; the tracked deletion should be committed with this new packet.
- `.agents/plans/archive/2026-05-12-topograph-query-docs-stack/` - earlier archived packet and local review report pattern.

## Validation Commands

- `gt sync` - refresh Graphite stack metadata before branch creation.
- `gt log --stack --no-interactive` - confirm current stack/base state.
- `gh pr view 447 --json state,closed,mergedAt` - verify PR #447 remains closed and unmerged.
- `gh pr list --state open --limit 50 --json number,title,headRefName,isDraft,mergeStateStatus,url` - identify stale unrelated PRs.
- `bun scripts/adr.ts map` - regenerate/check ADR map when ADR changes.
- `bun scripts/adr.ts check` - validate ADR structure.
- `bun run --cwd packages/http test` - kernel/Bun package tests.
- `bun run --cwd adapters/hono test` - Hono and parity tests.
- `bun run --cwd packages/pino test` - Pino package tests after scaffold.
- `bun run --cwd packages/tracing test` - OTel adapter tests.
- `bun run typecheck` - repo typecheck.
- `bun run test` - repo tests.
- `bun run lint` - repo lint.
- `bun run lint:ast-grep` - structural lint.
- `bun run build` - repo build.
- `bun run format:check` - formatting check.
- `bun run check` - repo aggregate gate.
- `bun run publish:check` - package packability and unresolved range check.
- `bun run publish:registry-check` - optional read-only registry posture check.
- `git diff --check` - whitespace and patch hygiene.

Do not run:

- `bun run publish:packages`
- `bun publish`
- `npm publish`
- `changeset publish`
