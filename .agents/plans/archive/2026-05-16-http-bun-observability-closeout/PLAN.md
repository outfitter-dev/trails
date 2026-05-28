---
created: 2026-05-17T15:32:43Z
updated: 2026-05-20T03:58:14Z
description: Primary execution contract for the 14-PR HTTP Bun + Observability Closeout stack. Covers objective, completion condition, non-goals, preflight steps, ordered stack table with branch names, detailed per-issue work plans (TRL-715 through TRL-718), tracker plan with dependency map, source-control rules, validation ladder, local/remote review discipline, and stop/pause rules.
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
  - .agents/plans/2026-05-16-http-bun-observability-closeout/REFS.md
  - adapters/hono/src/surface.ts
  - packages/http/src/build.ts
  - packages/http/package.json
  - packages/logtape/src/index.ts
  - packages/tracing/src/adapters/otel.ts
  - docs/adr/0005-framework-agnostic-http-route-model.md
  - docs/adr/0029-connector-extraction-and-the-with-packaging-model.md
  - docs/adr/0035-surface-apis-render-the-graph.md
---

# HTTP Bun + Observability Closeout Stack

Date: 2026-05-16
Status: Ready for goal kickoff

This packet turns the HTTP Bun, Pino, OTel, CI, and docs closeout work into one
end-to-end Graphite stack. It is self-contained: the ignored scratch review that
created the plan has been summarized here and in `REFS.md`, so the executor does
not need chat history or local-only scratch notes.

Do not use the Trails skill for this work. It is out of date for the current
package-boundary and release-readiness doctrine and has confused earlier runs.

## Objective

Build the full HTTP Bun + observability closeout stack locally, with package
readiness and publish checks baked into the stack, then submit high-quality PRs,
run local and remote review loops, and stop without merging or publishing.

The stack closes the immediate pre-versioning work:

- `@ontrails/http/fetch` Web Fetch kernel.
- `@ontrails/http/bun` Bun-native HTTP materializer.
- `@ontrails/hono` kernel consumption.
- Hono/Bun parity coverage.
- `@ontrails/pino` package scaffold, sink implementation, docs, and publish
  readiness.
- `@ontrails/tracing/otel` v1 hardening.
- Web Fetch kernel doctrine ADR/amendment.
- CI optimization follow-up.
- Final docs wording closeout before the next versioning pass.

## Completion Condition

The goal is complete only when:

- Every branch in the planned stack exists locally, contains its issue-scoped
  work, and has been submitted as a Graphite PR with a high-quality body.
- All package work is set up for publishing through the repo's Bun-based
  release flow: changesets exist where required, `bun install` has updated the
  lockfile as needed, `bun run publish:check` passes, and no real publish or
  registry mutation has been run.
- At least three local review passes have run from the stack tip and the latest
  pass is P3-only or clean.
- Draft PRs are marked ready only after local review and CI are clean.
- Remote P2 and above review feedback is resolved from the bottom of the stack
  upward, or explicitly reported after the remote-review turn limit.
- Linear issue state, comments, and any implementation divergences are current.
- The final transcript reports branch/PR status, verification commands/results,
  local review reports, remote review status, remaining P3s/risks, and confirms
  that no forbidden merge, publish, registry mutation, or merge-queue action
  occurred.

## Non-Goals

- Do not publish packages with `bun run publish:packages`, `bun publish`,
  `npm publish`, or `changeset publish`.
- Do not create `@ontrails/bun`.
- Do not create `@ontrails/otel`.
- Do not pull in TRL-303 or TRL-304.
- Do not broaden TRL-718 into a full markdown hard-wrap/style sweep.
- Do not merge PRs or add merge queue labels.
- Do not build on stale draft PR #479.

## Source Of Truth

Read first, in order:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `.agents/plans/2026-05-16-http-bun-observability-closeout/PLAN.md`
4. `.agents/plans/2026-05-16-http-bun-observability-closeout/REFS.md`
5. Linear issues `TRL-715`, `TRL-727`, `TRL-719`, `TRL-716`, `TRL-717`,
   `TRL-720`, `TRL-721`, `TRL-722`, `TRL-723`, `TRL-724`, `TRL-725`,
   `TRL-726`, `TRL-365`, and `TRL-718`

Background only:

- `.scratch/2026-05-14-http-bun-observability-closeout/clark-review.md` was the
  local-only planning source. Its load-bearing content has been copied into this
  packet and into Linear. Do not require it for execution.
- PR #447 is closed, not merged. It is seed material only.

Current state at packet creation:

- Current branch: `main`
- Current `HEAD`: `c7b01adb6`
- `main` is aligned with `origin/main`.
- PR #513 has merged (`chore: version packages to 1.0.0-beta.17`).
- PR #479 remains an unrelated stale draft docs-freshness PR and must not be the
  base for this stack.
- PR #447 is closed without merge after a context comment. Its useful material
  is captured in Linear.
- The prior active plan packet
  `.agents/plans/2026-05-13-v1-readiness-closure-stack/` has been moved to the
  ignored archive directory. The tracked deletion should be committed with this
  new packet on the lowest execution branch.

## Preflight

Before creating branches:

1. Run `gt sync`.
2. Check out current `main`.
3. Confirm `git status --short --branch` shows only this packet's tracked
   planning changes.
4. Confirm PR #447 is closed and not merged:

   ```bash
   gh pr view 447 --json state,closed,mergedAt
   ```

5. Confirm PR #479 is still unrelated and not part of the base:

   ```bash
   gh pr list --state open --limit 50 --json number,title,headRefName,isDraft,mergeStateStatus,url
   gt log --stack --no-interactive
   ```

6. Confirm Linear issues in the stack are still open and dependency links match
   the map in this packet.
7. Commit this tracked plan packet and the tracked removal of the completed
   `2026-05-13-v1-readiness-closure-stack` packet on the lowest execution
   branch.

If `main` has moved materially or the Linear issue graph no longer matches this
packet, stop and refresh the plan before building.

## Stack Order

Build this as one Graphite stack. It is fine to create the local branch chain up
front, including empty local branches, but do not submit or push empty branches.

| Order | Issue | Branch | Role |
| --- | --- | --- | --- |
| 1 | `TRL-715` | `trl-715-refactorhttp-extract-web-fetch-kernel-at-ontrailshttpfetch` | Extract public Web Fetch kernel at `@ontrails/http/fetch`. |
| 2 | `TRL-727` | `trl-727-docsadr-codify-web-fetch-kernel-extraction-principle` | Record the kernel/materializer doctrine in an ADR or ADR amendment. |
| 3 | `TRL-719` | `trl-719-refactorhono-consume-ontrailshttpfetch-kernel` | Refactor `@ontrails/hono` to consume the kernel. |
| 4 | `TRL-716` | `trl-716-feathttp-add-bun-native-surface-at-ontrailshttpbun` | Add Bun-native `@ontrails/http/bun` over the kernel. |
| 5 | `TRL-717` | `trl-717-testhttp-lock-hono-and-bun-http-surface-parity` | Add Hono/Bun parity harness. |
| 6 | `TRL-720` | `trl-720-chorepino-scaffold-publishable-ontrailspino-package` | Scaffold publishable `@ontrails/pino`. |
| 7 | `TRL-721` | `trl-721-featpino-implement-structural-pino-log-sink` | Implement structural Pino sink. |
| 8 | `TRL-722` | `trl-722-docspino-document-and-gate-ontrailspino-publishing` | Document and gate `@ontrails/pino` publishing. |
| 9 | `TRL-723` | `trl-723-feattracing-complete-otel-attribute-mapping` | Complete OTel attribute mapping. |
| 10 | `TRL-724` | `trl-724-testtracing-harden-otel-trace-lineage-and-status-semantics` | Harden OTel lineage/status semantics. |
| 11 | `TRL-725` | `trl-725-fixtracing-harden-otel-buffering-flush-and-exporter-failures` | Harden OTel buffering/flush/exporter failure behavior. |
| 12 | `TRL-726` | `trl-726-docstracing-document-ontrailstracingotel-v1-boundary` | Document OTel v1 boundary. |
| 13 | `TRL-365` | `trl-365-continue-deeper-ci-optimization-after-workflow-fan-out-lands` | Continue deeper CI optimization after workflow fan-out. |
| 14 | `TRL-718` | `trl-718-docs-close-http-and-observability-wording-before-versioning` | Final docs closeout before versioning. |

Umbrella issues `TRL-424` and `TRL-426` are already updated and should be
treated as parent/umbrella state, not execution branches. Leave Linear comments
on them if implementation diverges from the child chain.

## Issue Work Plan

### PR 1: TRL-715 Web Fetch Kernel

Intent:

- Make `@ontrails/http/fetch` the shared Web Standard `Request`/`Response`
  dispatcher for HTTP routes.

Actions:

- Add `./fetch` export to `@ontrails/http`.
- Export `CreateRouteHandlerOptions`, `CreateFetchHandlerOptions`,
  `createRouteHandler`, and `createFetchHandler`.
- Move protocol-level behavior out of Hono's inline implementation into the
  kernel: query parsing, JSON body reading, content-length validation,
  empty-body inference, body-size limits, request id extraction, diagnostics,
  `Request.signal`, `HttpExecutionContext.headers`, and webhook handling.
- Use `projectPublicSurfaceError`, not `projectSurfaceError`.
- Keep parser/sentinel/sanitizer helpers internal.
- Add kernel tests.

Verification:

```bash
bun run --cwd packages/http test
bun run --cwd packages/http typecheck
bun run --cwd adapters/hono test
bun run publish:check
git diff --check
```

Changeset:

- `@ontrails/http` minor bump.

### PR 2: TRL-727 Kernel Doctrine ADR

Intent:

- Prevent future contributors from re-litigating the `derive*` vs `create*`
  boundary.

Actions:

- Add a short ADR or amend ADR-0029.
- Explain why Web Standard `Request`/`Response` machinery can live under
  `@ontrails/http/fetch` without violating ADR-0005.
- Capture the dependency test: runtime built-in/no third-party dependency means
  subpath on the primitive; third-party framework dependency means standalone
  adapter package.
- Reference `@ontrails/http/fetch`, `@ontrails/http/bun`, and `@ontrails/hono`.
- Explicitly reject standalone `@ontrails/bun` for this case and avoid implying
  standalone `@ontrails/otel` for v1.

Verification:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun run format:check
git diff --check
```

### PR 3: TRL-719 Hono Kernel Consumption

Intent:

- Prove the kernel by moving the existing Hono adapter onto it before Bun lands.

Actions:

- Replace inlined body parsing, response/error projection, diagnostics, and
  webhook helper logic in `adapters/hono/src/surface.ts` with
  `createRouteHandler`.
- Preserve public Hono API, route registration order, Hono path semantics, and
  `startServer`.
- Do not introduce `hono.use(...)`.
- Remove obsolete `createHttpExecutionContext(c)` if the kernel now builds the
  execution context directly from `Request.headers`.

Verification:

```bash
bun run --cwd adapters/hono test
bun run --cwd adapters/hono typecheck
bun run --cwd packages/http test
bun run check
git diff --check
```

Changeset:

- `@ontrails/hono` patch bump.

### PR 4: TRL-716 Bun-Native HTTP Surface

Intent:

- Add Bun's built-in HTTP serving path as `@ontrails/http/bun`, not
  `@ontrails/bun`.

Actions:

- Add `./bun` export to `@ontrails/http`.
- Export `createApp`, `surface`, `CreateAppOptions`, and `SurfaceHttpResult`.
- Build Bun-compatible route records from `deriveHttpRoutes` plus
  `createRouteHandler`.
- Use Bun's native `routes` table as the primary fast path.
- Provide `fetch` as the 404 fallback.
- Provide `onError` for thrown errors.
- Require/document Bun `>=1.2.3` for native route table support.
- Lift PR #447's API shape, `routes` fast path, `onError`, and scenario ideas.
- Do not lift standalone package boundary, duplicated body parsing,
  `projectSurfaceError`, or build-time webhook rejection.

Verification:

```bash
bun run --cwd packages/http test
bun run --cwd adapters/hono test
bun run --cwd packages/http typecheck
bun run publish:check
git diff --check
```

Changeset:

- `@ontrails/http` minor bump, or amend the TRL-715 changeset if the stack keeps
  one consolidated HTTP changeset on the lower branch.

### PR 5: TRL-717 Hono/Bun Parity

Intent:

- Lock shared HTTP semantics so Hono and Bun cannot drift.

Actions:

- Add parity harness, preferably at
  `adapters/hono/src/__tests__/parity.test.ts`, to avoid a `packages/http` ->
  `@ontrails/hono` dev-dependency cycle.
- Table-drive scenarios: query scalar/array shape, JSON body, empty body,
  body cap, malformed content-length, malformed JSON, error categories,
  redacted-500 invariant, permit header forwarding, abort propagation, and
  webhook verify/parse/invalid-recording behavior.
- The harness should feed the same trail definitions and request shapes into
  both surfaces.

Verification:

```bash
bun run --cwd adapters/hono test
bun run --cwd packages/http test
bun run check
git diff --check
```

Changeset:

- Not required for test-only work unless package public content changes.

### PR 6: TRL-720 Pino Package Scaffold

Intent:

- Create a real publishable `@ontrails/pino` package before implementation and
  docs depend on it.

Actions:

- Add `packages/pino` with package metadata, README, changelog, tsconfigs,
  `src/index.ts`, and a minimal test.
- Depend on `@ontrails/observe`.
- Do not add a direct `pino` runtime dependency in the scaffold.
- Run `bun install` so workspace and lockfile state are correct.
- Add branch-local changeset.

Verification:

```bash
bun install
bun run --cwd packages/pino typecheck
bun run --cwd packages/pino test
bun run publish:check
git diff --check
```

### PR 7: TRL-721 Structural Pino Sink

Intent:

- Implement the actual Pino sink while preserving structural compatibility.

Actions:

- Export `PinoLoggerLike`, `PinoSinkOptions`, and `createPinoSink`.
- Map Trails log levels to Pino methods.
- Forward message and metadata in a Pino-friendly shape.
- Preserve redacted payloads; do not reconstruct unredacted metadata.
- Treat `silent` as a no-op if it appears.
- Avoid importing `pino` directly unless implementation proves impossible; stop
  and update Linear if this decision changes.

Verification:

```bash
bun run --cwd packages/pino test
bun run --cwd packages/pino typecheck
bun run publish:check
git diff --check
```

Changeset:

- `@ontrails/pino` patch/minor as appropriate, or amend the scaffold changeset.

### PR 8: TRL-722 Pino Docs And Publish Gate

Intent:

- Make `@ontrails/pino` discoverable and publish-ready.

Actions:

- Complete `packages/pino/README.md`.
- Update root package tables and relevant observability docs.
- Ensure metadata is complete for publish: exports, files, README, changelog,
  license, side effects if used by local convention.
- Document first-time registry check posture where relevant.

Verification:

```bash
bun run publish:check
bun run format:check
bun run check
git diff --check
```

### PR 9: TRL-723 OTel Attribute Mapping

Intent:

- Make `@ontrails/tracing/otel` emit stable `trails.*` attributes.

Actions:

- Map trail identity, span identity, surface, intent, permit, status/error,
  timing/duration, signal records, activation records, and lineage fields where
  present.
- Avoid raw payload and unredacted error-message attributes.
- Keep the adapter Trails-native; do not add OTel SDK dependency.

Verification:

```bash
bun run --cwd packages/tracing test
bun run --cwd packages/tracing typecheck
bun run publish:check
git diff --check
```

Changeset:

- `@ontrails/tracing` patch/minor as appropriate.

### PR 10: TRL-724 OTel Lineage And Status

Intent:

- Assert span lineage and status semantics across current trace record shapes.

Actions:

- Add tests/fixes for root records, child spans, crossed trails where represented,
  signal lifecycle records, activation records, and major error categories.
- If a desired lineage field does not exist in the current model, document that
  explicitly rather than inventing a field.

Verification:

```bash
bun run --cwd packages/tracing test
bun run --cwd packages/tracing typecheck
git diff --check
```

### PR 11: TRL-725 OTel Buffering And Exporter Failures

Intent:

- Make adapter lifecycle behavior predictable under batching, flushing, and
  exporter failure.

Actions:

- Define/test batch-size behavior.
- Define/test flush idempotence.
- Define/test exporter rejection behavior and queued records around failure.
- Document shutdown guidance in TSDoc or docs.
- Avoid silent record loss unless an explicit documented policy exists.

Verification:

```bash
bun run --cwd packages/tracing test
bun run --cwd packages/tracing typecheck
bun run check
git diff --check
```

### PR 12: TRL-726 OTel V1 Boundary Docs

Intent:

- Make `@ontrails/tracing/otel` the clear v1 home.

Actions:

- Document import path, exporter callback shape, stable attributes, flush/shutdown
  guidance, and relationship to `@ontrails/observe`.
- Explicitly say no standalone `@ontrails/otel` package exists in v1.
- Keep vendor-specific collector docs minimal.

Verification:

```bash
bun run format:check
bun run check
git diff --check
```

### PR 13: TRL-365 CI Optimization

Intent:

- Fold in the next CI optimization pass while the repo is already under broad
  closeout review.

Actions:

- Read TRL-365 before implementation and keep the diff strictly scoped to its
  issue body.
- Preserve correctness over speed: do not remove gates, weaken required checks,
  or hide failures.
- Keep workflow changes isolated and explain expected runtime impact in the PR
  body.

Verification:

```bash
bun run check
bun run build
git diff --check
```

If the issue body has become stale against current workflows, stop and update
Linear rather than guessing.

### PR 14: TRL-718 Docs Closeout

Intent:

- Make docs and agent guidance match the final shipped stack before versioning.

Actions:

- Update HTTP docs for the `derive*` / `create*` split and
  `@ontrails/http/fetch`.
- Document Hono vs Bun guidance: Hono for framework portability, Bun subpath for
  Bun-native serving without third-party framework dependency.
- Update root package tables for `@ontrails/pino`.
- Document `@ontrails/tracing/otel` as v1 OTel home.
- Remove/correct stale references to `@ontrails/bun`, `@ontrails/otel`, or
  rejected package shapes.
- Keep scope to touched surfaces and immediate closeout docs.

Verification:

```bash
bun run format:check
bun run check
git diff --check
```

## Tracker Plan

In-goal execution issues:

- `TRL-715`, `TRL-727`, `TRL-719`, `TRL-716`, `TRL-717`, `TRL-720`, `TRL-721`,
  `TRL-722`, `TRL-723`, `TRL-724`, `TRL-725`, `TRL-726`, `TRL-365`, `TRL-718`

Umbrella issues:

- `TRL-424`: parent for `TRL-720`, `TRL-721`, `TRL-722`.
- `TRL-426`: parent for `TRL-723`, `TRL-724`, `TRL-725`, `TRL-726`.

Dependency map:

- `TRL-715` blocks `TRL-719`, `TRL-716`, and `TRL-717`.
- `TRL-719` is sequencing-related to `TRL-716` and `TRL-717`; implement it
  before Bun and parity.
- `TRL-716` blocks `TRL-717`.
- `TRL-720` blocks `TRL-721`; `TRL-721` blocks `TRL-722`.
- `TRL-723` blocks `TRL-724` and `TRL-725`; `TRL-724` and `TRL-725` block
  `TRL-726`.
- `TRL-718` is blocked by `TRL-715`, `TRL-719`, `TRL-716`, `TRL-717`,
  `TRL-722`, `TRL-726`, and `TRL-727`.

Tracker operations during execution:

- Move an issue to In Progress when its branch starts.
- Move an issue to In Review when its PR leaves draft.
- Do not mark Done until after merge.
- Leave Linear comments if implementation diverges from issue scope.
- File follow-up issues for real out-of-goal discoveries and record them in
  `RETRO.md`.

## Source-Control Plan

Branching model:

- Graphite.

Rules:

- Use the exact Linear-recommended branch names in the stack table.
- It is okay to create the complete local branch chain up front.
- Do not submit or push empty branches.
- Main agent owns all `git` and `gt` write operations.
- Subagents may edit files, run checks, and write reports, but must not run
  `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt submit`,
  `gt restack`, merge commands, or PR mutation commands.
- Do not use `gt absorb` as the normal review-fix workflow.
- Do not add merge queue labels.
- Do not merge.

Commit policy:

- Commit this packet on the lowest execution branch.
- Use Conventional Commit messages.
- Keep each issue's branch focused on its issue.
- Use branch-local changesets for package content changes unless the branch is
  truly docs/test-only and release-neutral.
- Keep `RETRO.md` updated during execution but commit it at the last meaningful
  point before final handoff or merge readiness.

Owning-branch fix loop:

1. Triage findings by lowest owning branch.
2. `gt checkout <owning-branch>`.
3. Run `git branch --show-current` before `gt modify`.
4. Apply the smallest owning-branch fix.
5. Run focused validation.
6. Commit with `gt modify`.
7. `gt restack`.
8. Walk affected descendants with targeted checks.

## Validation Ladder

Narrow checks:

- Package-local tests and typechecks listed in each PR section.
- `bun scripts/adr.ts map`
- `bun scripts/adr.ts check`
- `bun run format:check`
- `git diff --check`

Stack-tip gate:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run build
bun run format:check
bun run check
bun run publish:check
git diff --check
```

If Warden or generated agent guidance changes:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

Registry posture:

- `bun run publish:check` is required.
- `bun run publish:registry-check` may be run as a read-only probe when useful.
- Do not run `bun run publish:packages`.
- Do not use `npm publish` or `changeset publish`.

## Local Review

Run at least three local review rounds from the stack tip before remote
submission. Write reports under:

```text
.agents/plans/2026-05-16-http-bun-observability-closeout/reports/
```

Suggested lanes:

- HTTP kernel/security: `projectPublicSurfaceError`, diagnostics, webhook,
  permits, abort propagation, Hono/Bun wrapper boundaries.
- Package/publish readiness: changesets, package metadata, lockfile, package
  table/docs, `publish:check`, no accidental `npm publish` guidance.
- Observability: Pino structural logger contract, OTel attributes, lineage,
  buffering, flush/exporter behavior, no standalone `@ontrails/otel`.
- Docs/ADR/doctrine: ADR map/check, package-boundary wording, no stale
  `@ontrails/bun` or `@ontrails/otel` instructions.
- CI/stack hygiene: TRL-365 scope, workflow correctness, branch ownership,
  PR-body quality, Linear status.

If a local pass finds any P0/P1/P2, fix on the lowest owning branch and run
another pass. Stop local review only when the latest pass is P3-only or clean.

## Remote Review

Submission:

- Submit draft PRs only after the full local stack is built.
- PR bodies must include context, changes, verification, risks/rollout notes,
  and Linear links.
- Keep PRs draft until CI and local review are clean.

Ready flow:

- Mark PRs ready when CI and local review are clean.
- Wait about 15 minutes after marking ready, then check unresolved threads and
  bot comments.
- Resolve all P2 and above feedback from the bottom of the stack upward.
- Treat review-bot errors as blockers until rerun or explicitly explained.
- After at most four post-ready remote-review turns, stop and report status.

## Progress Reporting

After each execution turn, report:

- Current checkpoint.
- What changed.
- What was verified.
- Command/output summary.
- What remains.
- Blocker status.
- Next checkpoint.

Final report must include:

- Branch/PR list and Graphite stack state.
- Linear status summary.
- Local review reports and latest severity state.
- Remote review thread state.
- Verification commands and results.
- Skipped checks and why.
- Remaining P3s or risks.
- Confirmation that no merge, publish, registry mutation, merge queue label, or
  `gt absorb` occurred.

## Stop / Pause Rules

Stop and ask if:

- The plan appears stale against `main`, Linear, PR #447/#479 state, or current
  package layout.
- Implementing an issue requires creating `@ontrails/bun` or `@ontrails/otel`.
- Implementing Pino requires a hard `pino` runtime dependency; update TRL-424
  with evidence before proceeding.
- Implementing OTel requires the OpenTelemetry SDK as a hard runtime dependency;
  update TRL-426 with evidence before proceeding.
- TRL-365 would weaken CI correctness or remove required gates.
- Any real publish, package ownership change, token/secret use, or registry
  mutation is required.
- A public API, artifact layout, or doctrine decision must change beyond this
  packet.
- Verification fails for unrelated reasons after focused retry.
- More than four post-ready remote-review turns have elapsed and P2+ feedback
  remains unresolved.

## Handoff Audit

- [x] Objective is singular and end-to-end.
- [x] Completion condition is objectively checkable.
- [x] Tracker state was updated before packet creation.
- [x] Branch names/order are exact where available.
- [x] Dependencies/blockers are represented.
- [x] Ignored scratch docs are summarized in tracked files.
- [x] Validation commands match repo conventions.
- [x] `GOAL.md` requires transcript-visible proof.
- [x] Stop rules are concrete.
- [x] Packet can be executed without chat history.
