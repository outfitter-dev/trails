# Trail Versioning M1 + M2 Stack

Date: 2026-05-19
Status: Ready for goal kickoff

This packet turns the first Trail Versioning implementation sprint into one
end-to-end Graphite stack. It is self-contained: the ignored doctrine note is
summarized here and in `REFS.md`, so the executor does not need chat history or
local-only notes to understand the plan.

Do not use the Trails skill for this work. The active versioning doctrine is
newer than the published skill guidance and the skill has confused earlier goal
runs.

## Objective

Build the M1 + M2 Trail Versioning stack locally, promote the v3 doctrine into
ADR-0048, settle the CLI namespace, add the core `version` / `versions`
authoring model, add pure `transpose:` revisions, compute projected markers,
wire runtime version resolution, and run examples/`testAll` across live version
entries.

The stack is the first implementation slice only:

- `TRL-728` - ADR-0048 and ADR-0044 supersession.
- `TRL-729` - top-level CLI namespace settle.
- `TRL-113` - trail `version` / `versions` authoring shape.
- `TRL-114` - pure `transpose:` transforms for revision entries.
- `TRL-739` - projected content-addressed version markers.
- `TRL-115` - runtime trail-version resolution.
- `TRL-116` - examples and `testAll` across live version entries.

## Completion Condition

The goal is complete only when:

- All seven planned branches exist locally in the stack order below, contain
  their issue-scoped work, and have been submitted as Graphite PRs with
  high-quality bodies.
- ADR-0048 exists, ADR-0044 is clearly superseded, and the ADR map/check gates
  pass.
- The first implementation stack builds against the v3 doctrine: source uses
  top-level `version: N` plus sibling `versions`, revision entries use
  `transpose:`, fork entries use `blaze:`, projected `marker:` identities are
  computed, runtime resolution handles current/revision/fork/status/error cases,
  and examples/`testAll` cover live entries.
- At least three local review passes have run from the stack tip and the latest
  pass is P3-only or clean.
- Draft PRs are marked ready only after CI and local review are clean.
- Remote P2 and above feedback is resolved from the bottom of the stack upward,
  or explicitly reported after the remote-review turn limit.
- Linear issue statuses, comments, and any implementation divergences are
  current.
- The final transcript reports branch/PR status, verification commands/results,
  local review reports, remote review status, remaining P3s/risks, and confirms
  that no forbidden merge, publish, registry mutation, merge-queue action, or
  subagent source-control write occurred.
- `RETRO.md` has been updated as the durable execution record and final state
  ledger.

## Non-Goals

- Do not implement M3 lifecycle/surface/gate work in this stack: `TRL-117`,
  `TRL-118`, `TRL-119`, `TRL-120`, `TRL-730`, `TRL-731`, or `TRL-732`.
- Do not implement M4 consumer migrations/codemods (`TRL-508`).
- Do not introduce `trails version`, `trails sunset`, `trails mark`,
  `trails fork`, or `trails archive`.
- Do not implement `.v*.ts` discovery.
- Do not use `adapt:` as the version-entry transform field; the settled field
  is `transpose:`.
- Do not author `marker:` values in source. Markers are projected.
- Do not add `kind:` to source entries. The graph may project
  `kind: 'revision' | 'fork'`.
- Do not add source-level force entries or `kind: 'forced'`.
- Do not publish packages, mutate the npm registry, merge PRs, or add merge
  queue labels.

## Source Of Truth

Read first, in order:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `.agents/plans/2026-05-19-trail-versioning-m1-m2/PLAN.md`
4. `.agents/plans/2026-05-19-trail-versioning-m1-m2/REFS.md`
5. Linear project: Trail Versioning
6. Linear issues `TRL-728`, `TRL-729`, `TRL-113`, `TRL-114`, `TRL-739`,
   `TRL-115`, and `TRL-116`

Background only:

- `.agents/notes/2026-05-19-versioning-reset-v3.md` is the local-only doctrine
  note that drove Linear cleanup. Its load-bearing decisions are summarized in
  this packet and should be promoted into ADR-0048. Read it if present, but do
  not make the goal depend on it remaining available.
- ADR-0044 is historical source material to supersede, not the implementation
  truth for this stack.

Current state at packet creation:

- Current branch: `main`
- Current `HEAD`: `5d88104c6` (`docs: align Trails blaze language (#530)`)
- `main` is aligned with `origin/main`.
- `gt sync` completed. Graphite warned that merged branch
  `trl-735-blaze-language-styleguide` cannot be cleaned up because it is checked
  out in another worktree; that is not a blocker for this stack.
- PR #530 added `docs/contributing/language-styleguide.md` and updated ADR and
  lexicon wording around `blaze`. Preserve that language in versioning docs.
- PR #531 (`trl-738-add-codex-clark-agent-wiring`) is draft and out of scope.

## Doctrine Snapshot

Use these decisions unless ADR-0048 deliberately refines wording without
changing behavior:

- Trail versioning is trail-only for 1.0.
- Authoring uses top-level `version: N` and sibling `versions: { N: {...} }`.
- Current contract stays top-level: `input`, `output`, and `blaze` always mean
  current.
- Historical entries require explicit `input` and `output`; there is no
  inheritance from current.
- Revision entries use pure `transpose: { input, output }` transforms.
- Transpose functions receive no `ctx`, resources, crosses, permit state, or
  surface state. If runtime context is needed, use a fork.
- Fork entries use `blaze:` and may own `crosses`, `resources`, and `detours`.
- Source has no `kind:` field. The resolved graph projects
  `kind: 'revision' | 'fork'` from entry shape.
- `status: { state: 'deprecated' | 'archived', ... }` is mutable lifecycle
  metadata, but M3 owns lifecycle implementation.
- Active is represented by the absence of `status`, not `status: active`.
- `marker:` is a projected content-addressed contract identifier. Authors do
  not write markers.
- The stored marker is a 16-character SHA-256 prefix; displayed marker prefixes
  may be shorter when unambiguous, with a minimum display prefix of 4 chars.
- `forces:` is graph-only audit debt for `--force`, not source and not a
  version entry. M3 owns force-event implementation.
- Top-level CLI surface is `create`, `compile`, `validate`, `diff`, `doctor`,
  `revise`, and `deprecate`.
- Preserve PR #530 language: a `blaze` is authored behavior that establishes how
  a trail runs; the runtime runs blazed trails; surfaces do not call blazes.

## Preflight

Before creating branches:

1. Run `gt sync`.
2. Check out current `main`.
3. Verify `git status --short --branch`.
4. Confirm this packet is the only new active plan packet, and decide whether
   to move the completed HTTP/Bun observability packet to `.agents/plans/archive/`
   on the lowest branch if it is still tracked.
5. Confirm Linear issues and dependency links match the stack order below.
6. Confirm PR #531 remains unrelated to the versioning stack.
7. Commit this tracked plan packet on the lowest execution branch.

If `main`, Linear, or the doctrine note has moved materially, stop and refresh
the packet before implementation.

## Stack Order

Build this as one Graphite stack. It is fine to create the complete local branch
chain up front, including empty local branches, but do not submit or push empty
branches. Build 100% of the stack locally before remote submission.

| Order | Issue | Branch | Role |
| --- | --- | --- | --- |
| 1 | `TRL-728` | `trl-728-docsadr-supersede-adr-0044-with-trail-versioning-v3-doctrine` | Promote ADR-0048 and supersede ADR-0044. |
| 2 | `TRL-729` | `trl-729-feattrails-settle-top-level-cli-namespace-before-versioning` | Settle top-level CLI namespace before code work. |
| 3 | `TRL-113` | `trl-113-define-trail-version-versions-authoring-shape` | Add `version` / `versions` authoring and graph projection shape. |
| 4 | `TRL-114` | `trl-114-add-pure-transpose-transforms-for-revision-entries` | Add pure `transpose:` revision transforms. |
| 5 | `TRL-739` | `trl-739-featcore-compute-content-addressed-version-markers` | Compute projected content-addressed markers. |
| 6 | `TRL-115` | `trl-115-resolve-trail-versions-during-execution` | Resolve current/revision/fork versions at runtime. |
| 7 | `TRL-116` | `trl-116-run-examples-and-testall-across-live-version-entries` | Extend examples and `testAll` across live entries. |

## Issue Work Plan

### PR 1: TRL-728 ADR-0048

Intent:

- Establish the durable doctrine before core implementation begins.

Actions:

- Author `docs/adr/0048-*.md` from this packet and the v3 doctrine note.
- Mark ADR-0044 as superseded by ADR-0048.
- Update ADR index/map/decision metadata.
- Add a forward pointer from ADR-0016 noting that `mark()` is not the versioning
  grammar.
- Update `docs/lexicon.md` and `docs/contributing/language-styleguide.md` where
  durable guidance is needed for `version`, `versions`, `revision`, `fork`,
  `transpose`, `status`, `marker`, `forces`, `@N`, and `(trail, version)`.
- Preserve post-PR #530 `blaze` grammar.
- Confirm ADR-0046 does not need a `trails.lock` manifest-schema amendment;
  TopoGraph content evolves additively.

Verification:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun run format:check
git diff --check
```

Changeset:

- None expected for docs-only ADR work.

### PR 2: TRL-729 CLI Namespace

Intent:

- Remove stale command grammar before code and docs start relying on versioning
  commands.

Actions:

- Promote `trails topo compile` to `trails compile`.
- Add `trails validate` as the read-only sibling for validation without writes.
- Retire `trails topo verify` from current-facing docs/tests/scripts.
- Establish top-level command slots for `create`, `compile`, `validate`,
  `diff`, `doctor`, `revise`, and `deprecate`.
- Drop or never-add `trails mark`, `trails fork`, `trails archive`,
  `trails version`, and `trails sunset` from current-facing docs/proposals.
- Update dispatch, docs, tests, scaffold boilerplate, CI scripts, and command
  suggestion strings.

Verification:

```bash
bun run --cwd apps/trails test
bun run typecheck
bun run lint
bun run format:check
git diff --check
```

Changeset:

- Add branch-local changesets for publishable package/app surfaces touched by
  the CLI change, unless the diff is truthfully release-neutral.

### PR 3: TRL-113 Authoring Shape

Intent:

- Add the core source and TopoGraph shape for versioned trails.

Actions:

- Add typed `version: number` and
  `versions?: Record<number, TrailVersionEntry>` trail-spec support.
- Add shared `VersionEntry<TContract>` base and trail-specific entry variants.
- Enforce revision/fork discrimination by field presence, not source
  discriminator.
- Reserve `version?: never` on non-trail specs without committing their future
  shape.
- Keep unversioned trails zero-cost and current-only.
- Project `version`, `versions`, `supports`, and graph `kind`.
- Reject `.v*.ts` filesystem discovery. Historical helpers may be ordinary
  imports only.

Verification:

```bash
bun run --cwd packages/core test
bun run --cwd packages/core typecheck
bun run --cwd packages/topographer test
bun run typecheck
git diff --check
```

Changeset:

- Expected for `@ontrails/core` and any package whose public types or projected
  graph shape changes.

### PR 4: TRL-114 Pure `transpose:` Revisions

Intent:

- Implement schema-only historical compatibility without smuggling runtime
  context into transforms.

Actions:

- Add `transpose: { input, output }` support on revision entries.
- Ensure transpose functions are pure and do not receive `ctx`, resources,
  crosses, permit state, or surface state.
- Apply input transpose before current blaze execution and output transpose
  after current output validation.
- Keep revision entries from declaring `crosses`, `resources`, or `detours`.
- Use fork entries when runtime context is required.
- Remove or avoid all `adapt:` vocabulary in current-facing versioning docs.

Verification:

```bash
bun run --cwd packages/core test
bun run --cwd packages/core typecheck
bun run test
git diff --check
```

Changeset:

- Expected for affected publishable packages.

### PR 5: TRL-739 Projected Markers

Intent:

- Add framework-projected content-addressed identities for resolved trail
  contracts.

Actions:

- Compute marker identity from canonicalized resolved contract content.
- Store the marker as a 16-character SHA-256 prefix.
- Display the shortest unambiguous prefix, minimum length 4.
- Support `@<marker-prefix>` references where unambiguous.
- Define canonicalization for current and historical entries.
- Decide and test collision handling.
- Ensure authors do not write marker values in source.
- Keep force events out of this PR except where canonicalization needs to know
  they are graph audit records, not version entries.

Verification:

```bash
bun run --cwd packages/core test
bun run --cwd packages/topographer test
bun run typecheck
git diff --check
```

Changeset:

- Expected for affected publishable packages.

### PR 6: TRL-115 Runtime Version Resolution

Intent:

- Make execution resolve current, revision, fork, deprecated, archived, missing,
  and marker-referenced versions through one runtime model.

Actions:

- Add version parameter handling to execution internals and surface entrypoints
  touched by M2.
- Current runs current top-level contract/blaze.
- Revision validates historical input, applies `transpose.input`, runs current
  blazed trail, applies `transpose.output`, and validates historical output.
- Fork runs its preserved contract/blaze world.
- Deprecated entries remain live and project status metadata where available.
- Archived entries return `VersionNotSupportedError`, but M3 owns full archive
  lifecycle implementation.
- Missing versions return `VersionNotSupportedError` with requested and
  supported versions.
- `forces:` entries are inert graph audit records and never resolve at runtime.
- `ctx.cross()` runs current by default; explicit `{ version }` pinning is
  allowed as migration debt.

Verification:

```bash
bun run --cwd packages/core test
bun run --cwd packages/http test
bun run --cwd packages/mcp test
bun run typecheck
bun run test
git diff --check
```

Changeset:

- Expected for affected publishable packages.

### PR 7: TRL-116 Examples and `testAll`

Intent:

- Make examples and test helpers prove the version-entry model instead of only
  current behavior.

Actions:

- Make examples per version entry and typed against that entry's resolved
  contract.
- Extend `testAll(app)` to run current plus live historical entries.
- Exclude archived entries from default runtime examples while preserving audit
  visibility where relevant.
- Add helper APIs or fixtures needed for version-aware tests.
- Keep examples as the happy-path contract tests for each live version.

Verification:

```bash
bun run --cwd packages/testing test
bun run --cwd packages/core test
bun run test
bun run typecheck
git diff --check
```

Changeset:

- Expected for `@ontrails/testing` and any package whose public test helpers or
  examples behavior changes.

## Local Review Loop

Before submitting remote PRs, run at least three local review rounds from the
stack tip. Suggested lanes:

1. ADR/doctrine/lexicon/blaze-language review.
2. CLI namespace and stale-command sweep.
3. Core type/TopoGraph authoring-shape review.
4. Transpose/runtime/marker correctness review.
5. Testing/examples and public API/change-set review.

Write reports under:

```text
.agents/plans/2026-05-19-trail-versioning-m1-m2/reports/
```

If the latest pass finds any P0/P1/P2, fix it on the lowest owning branch and
run another pass. Stop local review only when the latest pass is P3-only or
clean.

Subagents may edit files, run checks, and write reports, but must not run
`git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt submit`,
`gt restack`, merge commands, or PR mutation commands. The main agent owns all
source-control writes.

## Owning-Branch Fix Loop

1. Triage findings by lowest owning branch.
2. `gt checkout <owning-branch>`.
3. Run `git branch --show-current` before any `gt modify`.
4. Apply the minimal branch-owned fix.
5. Run focused validation.
6. Commit with `gt modify` using a Conventional Commit message.
7. `gt restack`.
8. Walk upward through affected descendants with targeted checks.

Do not use `gt absorb` as the normal review-fix workflow. Do not use
`gt modify --into` from another branch.

## Tip Verification

Run from the stack tip after implementation and after local review fixes:

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

If Warden or generated agent guidance changes, also run:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

## Ready and Remote Review

- Keep PRs draft until CI and local review are clean.
- Submit high-quality PR bodies with context, changes, verification,
  risk/rollout notes, and Linear links.
- Mark ready only when CI and local review are clean.
- Wait about 15 minutes after marking ready, then check unresolved review
  threads and bot comments.
- Resolve all P2 and above feedback from the bottom of the stack upward.
- Treat review-bot errors as blockers until rerun or explicitly explained.
- After at most four post-ready remote-review turns, stop and report current
  status.

## Linear

- Move issues to In Progress when starting their branches.
- Move issues to In Review when PRs are marked ready.
- Do not mark issues Done until after merge.
- If implementation diverges from an issue or plan, leave a Linear comment
  explaining what changed and why.
- Record out-of-goal discoveries in `RETRO.md` and create focused Linear
  follow-up issues when the discovery is real.

## Stop Rules

Stop and ask before continuing if:

- ADR-0048 needs to change a doctrine choice in this packet rather than just
  refine wording.
- Runtime resolution requires implementing M3 lifecycle/surface/gate work early.
- Marker canonicalization requires unsupported Zod semantics that should be
  deferred to M3's bounded-Zod rule.
- The CLI namespace work would require aliases or a compatibility period.
- PR #531 or another open branch becomes a required base.
- Verification fails for unrelated reasons after a focused retry.
- A public API, artifact layout, or doctrine decision needs Matt's judgment
  beyond the issue/ADR scope.
- A real package publish, package ownership change, token/secret use, registry
  mutation, merge, or merge queue label would be required.
- Four post-ready remote-review turns have elapsed and P2+ feedback remains.
