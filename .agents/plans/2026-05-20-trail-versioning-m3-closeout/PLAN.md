# Goal Plan: trail-versioning-m3-closeout

Date: 2026-05-20
Status: Draft planning packet

## Objective

Build, locally review, submit, mark ready, and remote-review the Trail
Versioning M3 closeout stack from current `main`, closing lifecycle status,
surface negotiation, version-aware diffing, break/force gates, and Warden
versioning rules. Include the small TRL-740 cleanup branch at the bottom so the
M1/M2 public/internal API polish lands before the larger M3 work.

## Completion Condition

The goal is complete only when:

- The eight-branch Graphite stack exists locally and remotely in the exact order
  below, with each branch carrying its intended issue scope and no unrelated
  work.
- All PRs have high-quality descriptions, correct Linear issue links, and are
  marked ready only after local review and CI are clean.
- Local review has run at least three substantive passes from the stack tip, all
  P0/P1/P2 findings have been fixed bottom-up, and only P3s or clean results
  remain.
- Post-ready remote review has been checked for up to four turns, all P0/P1/P2
  bot or human feedback has been resolved bottom-up, bot errors are rerun or
  explained, and unresolved P3s are recorded.
- Tip verification has passed with transcript-visible command summaries:
  `bun scripts/adr.ts check`, `bun run check`, `bun run build`,
  `bun run test`, `bun run lint:ast-grep`, `bun run publish:check`, and
  `git diff --check`.
- Warden/agent guide sync checks have passed if Warden manifests or generated
  guide output changed.
- Any publishable package-content PR includes a branch-local changeset unless
  the PR is truly `release:none`; publishing itself is not performed.
- Linear remains current for TRL-740, TRL-117, TRL-731, TRL-732, TRL-730,
  TRL-118, TRL-119, and TRL-120.
- No package publish, registry mutation, merge, merge queue label, or `gt absorb`
  has happened.
- `RETRO.md` has been updated as the durable execution record and final state
  ledger, including local review, remote review, verification, skipped checks,
  tracker state, forbidden-action audit, and archive readiness.

## Non-Goals

- Do not implement M4 codemods or TRL-508 in this goal.
- Do not cut a version, publish packages, mutate npm, or run release automation.
- Do not redesign ADR-0048 doctrine. If the stack reveals doctrine is wrong,
  stop and ask instead of improvising new semantics.
- Do not add current-facing `trails version`, `trails sunset`, `trails mark`,
  `trails fork`, or `trails archive`.
- Do not reintroduce `.v*.ts` version discovery, source-authored `marker`,
  source-authored timestamps, `version.markers`, source `kind`, or
  `kind: 'forced'`.
- Do not use the local Trails skill. It is out of date for current versioning
  doctrine and has confused earlier runs.
- Do not push or submit empty branches.
- Do not merge the stack or add a merge queue label unless Matt explicitly asks.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `.agents/plans/2026-05-20-trail-versioning-m3-closeout/PLAN.md`
4. `.agents/plans/2026-05-20-trail-versioning-m3-closeout/REFS.md`
5. `.agents/plans/2026-05-20-trail-versioning-m3-closeout/RETRO.md`
6. `docs/adr/0048-trail-versioning-v3.md`
7. `docs/adr/0044-trail-versioning.md`
8. Linear project `Trail Versioning`
9. Linear issues: TRL-740, TRL-117, TRL-731, TRL-732, TRL-730, TRL-118,
   TRL-119, TRL-120
10. Current source areas listed in `REFS.md`

The local-only reset note
`/Users/mg/Developer/outfitter/trails/.agents/notes/2026-05-19-versioning-reset-v3.md`
is useful historical context, but the tracked packet and ADR-0048 are the
portable sources. Do not make a PR depend on reading the ignored note.

## Stack Order

Recommended branch order, bottom to top:

| Order | Issue | Branch | Primary role |
| --- | --- | --- | --- |
| 1 | TRL-740 | `trl-740-chorecore-tighten-trail-versioning-publicinternal-api` | Cleanup-first API polish from M1/M2 review |
| 2 | TRL-117 | `trl-117-add-status-deprecation-metadata-and-surface-signals` | Deprecation `status` metadata and surface signal substrate |
| 3 | TRL-731 | `trl-731-featcore-add-archive-status-lifecycle-for-version-entries` | Archive `status` lifecycle semantics |
| 4 | TRL-732 | `trl-732-feattrails-add-compilevalidate-break-detection-and-force` | Shared break classifier and graph-only `forces:` events |
| 5 | TRL-730 | `trl-730-feattrails-add-version-and-marker-aware-trails-diff` | Version-aware `trails diff` over classifier/force substrate |
| 6 | TRL-118 | `trl-118-project-version-negotiation-across-http-mcp-cli-and` | Surface version negotiation and projection |
| 7 | TRL-119 | `trl-119-add-cli-lifecycle-commands-revise-deprecate-and-doctor` | CLI lifecycle commands: `revise`, `deprecate`, `doctor` |
| 8 | TRL-120 | `trl-120-add-warden-rules-for-trail-version-entries-and-markers` | Warden rule capstone over the completed model |

This order intentionally places TRL-740 first so public/internal API cleanup is
settled before more M3 API surface is layered on top. TRL-120 is last because it
should verify the final shape rather than guess at intermediate contracts.

## Work Plan

### Phase 0: Preflight And Packet Commit

Intent:

- Confirm the executor is starting from current `main`, not the unrelated
  TRL-738 branch or another local worktree state.

Actions:

- Run `gt sync`.
- Confirm current branch and stack with `git branch --show-current`,
  `git status --short`, and `gt log --stack --reverse`.
- Verify Linear issue states, branch names, and milestones are unchanged from
  this packet.
- Commit this packet on the lowest execution branch after creating the stack
  skeleton.

Verification:

- `git status --short`
- `gt log --stack --reverse`

Done when:

- The executor can prove the starting point is current `main`, the active packet
  is on the bottom branch, and any stale tracker drift has been corrected or
  called out.

### Phase 1: TRL-740 Cleanup Branch

Intent:

- Remove small M1/M2 public/internal API rough edges before expanding M3.

Actions:

- Improve absent-marker diagnostics in
  `packages/core/src/version-marker.ts`.
- Clean the unreachable defensive branch in
  `packages/core/src/version-resolution.ts`.
- Hide or split internal-only `crossValidation` and `validationSchema` from the
  exported public execution options surface in `packages/core/src/execute.ts`.
- Add or adjust focused tests and public API assertions.
- Add a changeset for affected publishable packages unless a verified
  `release:none` exception is appropriate.

Verification:

- Targeted core tests for version marker/resolution/execution options.
- `bun run typecheck`
- `bun run publish:check`

Done when:

- TRL-740 is independently correct and does not leak internal-only execution
  options into the intended public API.

### Phase 2: TRL-117 And TRL-731 Lifecycle Status

Intent:

- Establish lifecycle metadata before surfaces and CLI consume it.

Actions:

- Implement deprecation status on historical version entries:
  `status: { state: 'deprecated', successor?, migration?, note? }`.
- Keep active as absence of `status`.
- Enforce at least one deprecation guidance field.
- Project deprecation signals to HTTP, MCP, CLI, and WebSocket affordances where
  the issue requires it.
- Implement archived status:
  `status: { state: 'archived', reason? }`.
- Ensure archived entries remain graph-visible but are excluded from runtime
  route/tool/command projection.
- Keep archive as status lifecycle, not as marker kind, source kind, or a
  separate command primitive.

Verification:

- Focused core lifecycle tests.
- Surface projection tests for deprecation and archive behavior.
- `bun run typecheck`
- `bun run test`

Done when:

- Deprecated entries are live with guidance and surfaced warnings/metadata.
- Archived entries are graph-visible but not runnable/projected as public
  runtime affordances.

### Phase 3: TRL-732 And TRL-730 Static Gates And Diff

Intent:

- Make breaking contract changes inspectable and auditable before Warden uses
  them.

Actions:

- Add the shared break classifier for compile, validate, diff, Warden, and
  author-time interviews.
- Block unaddressed schema/API breaks unless the operator adds a version entry,
  reverts the breaking change, or uses auditable `--force`.
- Record `--force` as graph-only `forces:` audit events in `topo.lock`; never
  source-authored version entries.
- Add version- and marker-aware `trails diff` with ranges, marker-prefix refs,
  `--forces`, `--breaks`, and `--consumers` behavior from TRL-730.
- Keep the classifier shared rather than duplicated between commands.

Verification:

- Targeted CLI tests for compile/validate force behavior.
- Targeted `trails diff` tests for versions, marker prefixes, lifecycle status,
  and force events.
- `bun scripts/adr.ts check`
- `bun run test`
- `bun run build`

Done when:

- Compile/validate/diff agree on break classification and force events are
  auditable in resolved graph/lock artifacts without source drift.

### Phase 4: TRL-118 Surface Negotiation

Intent:

- Expose historical live versions consistently across surfaces.

Actions:

- Implement shared `(trail, version)` contract resolution for HTTP, MCP, CLI,
  and WebSocket boundaries.
- Support current plus live historical projection; exclude archived entries from
  runtime routes/tools/commands/supports.
- Support `@N` and `@<marker-prefix>` lookup where the issue requires it.
- Add `VersionNotSupportedError` or the settled equivalent error shape and map
  it consistently across surfaces.
- Preserve internal composition defaulting to current unless explicitly pinned
  through `ctx.cross(..., { version })`.

Verification:

- Surface-specific tests for HTTP, MCP, CLI, and WebSocket projection.
- Error mapping tests for unsupported versions.
- Cross-version composition tests where applicable.
- `bun run typecheck`
- `bun run test`

Done when:

- Surface users can address supported live versions and get consistent errors
  for unsupported or archived versions.

### Phase 5: TRL-119 CLI Lifecycle Commands

Intent:

- Give authors the settled current-facing CLI grammar for lifecycle work.

Actions:

- Add `trails revise <trail>`.
- Add `trails revise <trail> --as fork`.
- Add `trails revise <trail>@<v> --as fork`.
- Add `trails deprecate <trail>@<v>`.
- Add `trails deprecate <trail>@<v> --archive`.
- Add `trails doctor`.
- Keep these commands aligned with TRL-729 namespace doctrine and ADR-0048.
- Do not add `trails version`, `trails sunset`, `trails mark`,
  `trails fork`, or `trails archive`.

Verification:

- CLI command parser tests.
- Scaffold/update tests for source rewrites.
- `trails doctor` fixture tests.
- `bun run test`
- `bun run lint`

Done when:

- The command set tells the intended story: create current trails, revise
  historical versions, deprecate or archive historical entries, and diagnose
  versioning state.

### Phase 6: TRL-120 Warden Capstone

Intent:

- Lock the M3 model with author-time and graph-aware Warden rules.

Actions:

- Implement the rule family scoped in TRL-120, including unaddressed breaks,
  missing deprecation guidance, fork preservation, version gaps, frozen contract
  mutation, stale revision base, version-pinned cross checks,
  version-without-examples, intent elevation, composition cascade,
  high-traffic deprecated warnings, pending force events, and unsupported marker
  schema.
- Use existing Warden helpers and AST patterns; avoid ad hoc string parsing.
- Update generated Warden guide sections if the manifest changes.

Verification:

- Focused Warden rule tests.
- `bun run lint:ast-grep`
- `bun run warden:agents:sync` and `bun run warden:skills:sync` if generated
  guides changed.
- `bun run warden:agents:check` and `bun run warden:skills:check` if available
  after sync.
- Full tip gate.

Done when:

- Warden catches the versioning violations that M3 introduced and the generated
  guidance is in sync.

### Phase 7: Local Review, Submission, Ready, Remote Review

Intent:

- Use the review loop that has been working: find P2+ issues locally first,
  submit draft PRs only when clean, then handle remote review bottom-up.

Actions:

- Run at least three local review passes from the stack tip, writing reports to:
  - `.agents/plans/2026-05-20-trail-versioning-m3-closeout/reports/local-review-round-1-lifecycle-surfaces.md`
  - `.agents/plans/2026-05-20-trail-versioning-m3-closeout/reports/local-review-round-1-diff-gates-warden.md`
  - `.agents/plans/2026-05-20-trail-versioning-m3-closeout/reports/local-review-round-1-docs-cli-changesets.md`
- Add more review rounds if any P0/P1/P2 remains.
- Fix findings on the lowest owning branch, restack, and walk upward.
- Submit draft PRs with high-quality descriptions.
- Mark PRs ready only once CI, local review, and descriptions are clean.
- Wait about 15 minutes after marking ready, then check review threads and CI.
- Resolve P0/P1/P2 remote feedback bottom-up for a maximum of four post-ready
  turns, then report current status without merging.

Verification:

- `gt log --stack --reverse`
- GitHub/Graphite PR status and unresolved-thread queries.
- Tip gate commands in the validation ladder.

Done when:

- The stack is ready for Matt to merge or inspect, with no unresolved P0/P1/P2
  local or remote findings.

## Tracker Plan

In-goal issues:

- TRL-740
- TRL-117
- TRL-731
- TRL-732
- TRL-730
- TRL-118
- TRL-119
- TRL-120

Out-of-goal issue:

- TRL-508 remains M4 and should not be implemented in this goal.

Tracker state already adjusted during planning:

- Linear project `Trail Versioning` now states M1/M2 are Done, M3 is next, and
  ADR-0048 is canonical.
- TRL-740 now belongs to milestone `M3: Lifecycle, surfaces, and gates`.

Required during execution:

- Move each issue through the appropriate Linear workflow state as work starts,
  PRs are submitted, and work merges.
- Leave a Linear comment on any issue whose implementation diverges from its
  issue body or from this packet.
- Create focused follow-up issues for real discoveries outside M3 and record
  them in `RETRO.md`.

## Source-Control Plan

- Branching model: Graphite.
- Base: current `main` after `gt sync`.
- It is fine to create the full local branch chain up front. Do not submit or
  push empty branches.
- Main executor owns all `git` and `gt` writes.
- Subagents may edit files, run checks, and write review reports, but they must
  not run `git add`, `git commit`, `git push`, `gt create`, `gt modify`,
  `gt restack`, `gt submit`, merge commands, or PR mutation commands.
- Commit the active plan packet on the lowest branch in the stack.
- Use Conventional Commit-style commits and PR titles.
- Use branch-local changesets for package-content changes unless a PR is truly
  `release:none`.
- Do not use `gt absorb`.
- Do not add merge queue labels.
- Do not merge.

Suggested branch setup:

```bash
gt checkout main
gt sync
gt create trl-740-chorecore-tighten-trail-versioning-publicinternal-api
gt create trl-117-add-status-deprecation-metadata-and-surface-signals
gt create trl-731-featcore-add-archive-status-lifecycle-for-version-entries
gt create trl-732-feattrails-add-compilevalidate-break-detection-and-force
gt create trl-730-feattrails-add-version-and-marker-aware-trails-diff
gt create trl-118-project-version-negotiation-across-http-mcp-cli-and
gt create trl-119-add-cli-lifecycle-commands-revise-deprecate-and-doctor
gt create trl-120-add-warden-rules-for-trail-version-entries-and-markers
```

Then work bottom-up, checking out each owning branch before implementation and
using `gt modify` / `gt restack` as needed.

## Retro Discipline

`RETRO.md` is part of the completion contract, not optional notes.

- Update `RETRO.md` after meaningful implementation, tracker, verification,
  local review, remote review, CI, PR-body, release, or packaging changes.
- For stacked work, touch `RETRO.md` last before local completion, draft
  submission, ready-for-review, remote review closeout, merge readiness, or
  final handoff.
- Every meaningful review-flow change must have a corresponding retro entry
  before claiming the review loop is complete.
- Before completion, fill the final state, verification log, review state,
  tracker state, forbidden-action audit, remaining risks, and archive readiness.

## Validation Ladder

Run checks from narrow to broad:

- Targeted: focused `bun test` invocations for edited packages/apps.
- ADR: `bun scripts/adr.ts map` and `bun scripts/adr.ts check`.
- Typecheck: `bun run typecheck`.
- Tests: `bun run test`.
- Lint: `bun run lint` and `bun run lint:ast-grep`.
- Build: `bun run build`.
- Formatting: `bun run format:check`.
- Publishing dry run: `bun run publish:check`.
- Full gate: `bun run check`.
- Diff hygiene: `git diff --check`.

When Warden manifests or generated guidance change, also run:

- `bun run warden:agents:sync`
- `bun run warden:skills:sync`
- `bun run warden:agents:check`
- `bun run warden:skills:check`

## Local Review

Run local review from the stack tip before remote submission. At least three
substantive passes are required:

- Lane 1: lifecycle and surface semantics: deprecation, archive, negotiation,
  archived exclusion, error mapping.
- Lane 2: diff, break classifier, force events, and Warden rule correctness.
- Lane 3: docs, CLI grammar, changesets, public API exposure, generated guide
  sync, and package publish dry-run expectations.

Use subagents if useful, but give them bounded artifacts and require cited
findings or explicit "unable to verify" outcomes. Fix all P0/P1/P2 findings
before draft submission or ready-for-review. Summarize each round and its fix
outcome in `RETRO.md`.

## Progress Reporting

After each execution turn, report:

- Current checkpoint
- What changed
- What was verified
- Command/output summary
- What remains
- Blocker status
- Next checkpoint

## Stop / Pause Rules

Stop and ask if:

- The plan appears stale against `main`, Linear, or open PR state.
- A public API, artifact layout, or doctrine decision needs to change beyond
  ADR-0048 and this packet.
- The work requires publish, registry mutation, merge, production credentials,
  secrets, or other irreversible actions.
- Verification fails for unrelated reasons after a focused retry.
- A review thread or CI result reveals P0/P1/P2 scope that cannot be fixed
  bottom-up within this stack.
- More than four post-ready remote-review turns have elapsed and P2+ feedback
  remains unresolved.

## Handoff Audit

- [x] Objective is singular and end-to-end.
- [x] Completion condition is objectively checkable.
- [x] Tracker state is current.
- [x] Branch names/order are exact where applicable.
- [x] Dependencies/blockers are represented.
- [x] Ignored/untracked source docs are copied, summarized, moved, or avoided.
- [x] Validation commands match repo conventions.
- [x] `GOAL.md` requires transcript-visible proof.
- [x] `GOAL.md` requires `RETRO.md` finalization before completion.
- [x] Stop rules are concrete.
- [x] `RETRO.md` has concrete sections for execution, tracker, review,
      verification, remote state, forbidden actions, final state, and archive
      readiness.
- [x] Packet can be executed without chat history.
