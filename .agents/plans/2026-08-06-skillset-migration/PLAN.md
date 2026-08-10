---
created: "2026-08-06T21:00:00Z"
updated: "2026-08-08T12:02:41Z"
description: Execution plan for the dependency-honest standalone Skillset migration stack.
linear:
  - TRL-1271
  - TRL-1272
  - TRL-1273
  - TRL-1274
  - TRL-1275
impl_status: in_progress
references:
  - GOAL.md
  - RETRO.md
  - REFS.md
---

# Plan

## Authority and scope fences

This assigned worker worktree may read repository, registry, GitHub, Graphite, and Linear state; edit and test the migration; create dependency-honest Graphite branches; make focused Conventional Commits; submit draft PRs; update the owning Linear issues; and mark migration PRs ready only after every readiness gate is current. The coordinator may also work in the Skillset repository on SET-396 and SET-394 through reviewed draft PRs.

It may rerun only the existing cancelled CI workflows for #990/#991. It may not change their branches, commits, metadata, draft state, or topology; run `gt sync` from worker worktrees; perform repository-wide trunk restacking; merge; queue; publish; release; deploy; activate Skillset globally; mutate HOME-installed skills or provider configuration; destructively clean branches/worktrees; hand-edit generated output; or hide a Skillset gap behind a Trails-local compiler seam.

The 2026-08-08 coordinator handoff supersedes the worker-only landing boundary: Matt authorized fixing, submitting, readying, and merging the existing Trails stack, reconciling Linear, and syncing the main workspace. It does not authorize Skillset publication or beginning TRL-1272 and later implementation.

## Phase 0 — ground and reconcile

- [x] Read `AGENTS.md`, `.agents/plans/PLANNING.md`, the full Linear bootstrap document, TRL-1271 through TRL-1275, SET-394, SET-395, their relations, and their comments.
- [x] Reverify worktree dirt, Graphite topology, PR #990/#991 heads/bases/draft/check/mergeability state, npm latest, and the old TRL-1271 ref.
- [x] Confirm the old TRL-1271 ref had zero unique commits and reconcile it through Graphite onto live #991 without mutating either ancestor.
- [x] Materialize this tracked four-file packet.

## Phase 1 — TRL-1271 parity proof

- [x] Pin exact released `skillset@0.22.0` as repo-local development tooling.
- [x] Add a hermetic parity harness that uses temporary source/output plus temporary HOME/XDG config/cache/state roots.
- [x] Reproduce the legacy oracle and standalone selective Claude import plus Claude/Codex builds without writing live provider trees.
- [x] Compare complete inventory, content or reviewed semantic equivalence, modes, frontmatter, companions, replacements, provenance, and Clark/Lewis project-agent semantics.
- [x] Classify every difference as equivalent, intentional, or blocking.
- [x] Record branch-local `release:none`: TRL-1271 changes private root tooling/tests/plans only and ships no publishable `@ontrails/*` package content or public trail/surface contract.
- [x] Run focused tests, `skillset:check`, formatting, typecheck, `git diff --check`, and applicable gates; record the inherited Regrade aggregate-gate blocker separately.
- [x] Run three local-review passes, fix findings, commit, and submit draft [#992](https://github.com/outfitter-dev/trails/pull/992).
- [x] Restore #992 to draft after it was readied without Actions CI and rerun the outage-cancelled #990/#991 workflows under the narrow 2026-08-07 authority amendment.
- [x] Commit and push the authority packet to retrigger #992's PR CI, then reconcile its exact-head run.
- [x] Reconcile fresh hosted CI and review evidence for #990/#991/#992; keep #992 draft while bottom-up restacking, current-head review and CI, and final landing gates remain unresolved. Skillset publication gates Phase 2 adoption, not the TRL-1271 parity proof.

## Phase 1.5 — upstream Skillset capabilities

### SET-396 project-agent native references

- [x] Ground the live Skillset repository, guidance, issue, package version, branch topology, tests, and release process.
- [x] Implement the smallest source-contract change that preserves explicit target-scoped unmanaged skill references and provider-native fields without weakening managed-reference validation.
- [x] Add lock/provenance and drift-check evidence plus tests and documentation required by SET-396.
- [x] Run Skillset review and gates; create draft [#393](https://github.com/outfitter-dev/skillset/pull/393) and stop before merge/publication.
- [x] Restack #393 onto live Skillset `main`, resolve the documented overlap, rerun affected reviews and gates, obtain fresh hosted merge-ref CI, and merge it. SET-396 is Done.

### SET-394 executable modes

- [x] Implement portable executable intent through source/rendering/output/lock/check ownership, with explicit Windows behavior.
- [x] Cover standalone resources and plugin hooks in tests and documentation.
- [x] Run three Skillset review passes and focused gates; create draft [#395](https://github.com/outfitter-dev/skillset/pull/395) and stop before merge/publication.
- [x] Restack #395 onto live Skillset `main`, resolve the documented SET-389/SET-394 conflicts, rerun affected reviews and gates, obtain fresh hosted merge-ref CI, and merge it. SET-394 is Done.

### Publication gate

- [x] Obtain separate approval and merge the reviewed Skillset fixes plus release PR #396.
- [ ] Approve the waiting trusted-publication deployment. Release run `31232148006` selected `Publish to npm manually`; automatic publication was skipped.
- [ ] Reverify npm latest and the published package behavior before updating Trails.

## Phase 2 — TRL-1272 canonical source and lock

- [ ] Reverify SET-396 and npm latest. Do not begin source adoption until a published release preserves Clark's provider-native external skill reference and model alias.
- [ ] Create the exact Linear-named child branch on TRL-1271.
- [ ] Use reviewed selective Claude import; never use `init --adopt all` on 0.22.0.
- [ ] Establish `.skillset/` as the sole canonical authored source for managed skills.
- [ ] Author Clark/Lewis project agents deliberately and preserve provider-native fields only where parity evidence requires them.
- [ ] Preserve deliberate handling for Claude-only `context: fork` and `agent: clark` on `clark-decision` and `clark-survey`.
- [ ] Preserve dynamic `!` pre-resolution and provider-relative companion references visibly.
- [ ] Commit deterministic managed output and `skillset.lock`; keep the legacy generator only as an oracle.
- [ ] Record branch-local `release:none`, verify, review, commit, and submit a draft PR.

## Phase 3 — TRL-1273 standalone CLI cutover

- [ ] Create the exact Linear-named child branch on TRL-1272.
- [ ] Rewire `skillset:sync`, `skillset:check`, root checks, and relevant hooks to the pinned CLI.
- [ ] Delete the bespoke generator, TOML config, tests, and stale guidance after accepted parity.
- [ ] Keep plugin and Warden projection consolidation out of this branch.
- [ ] Document clean-checkout invocation, migration boundary, and branch-local `release:none`.
- [ ] Verify, review, commit, and submit a draft PR.

## Phase 4 — sibling consolidation

### TRL-1274 plugin projection

- [ ] Reverify npm latest and SET-394 state after TRL-1273.
- [ ] Treat the published executable-mode fix as a hard gate.
- [ ] If fixed in a published release, update the exact pin and Linear/packet, then prove plugin inventory, bytes, modes, hook command/timeout, relative references, metadata, marketplace versions, and native-only files.
- [ ] If not fixed, do not create a workaround or falsely complete the branch; record the exact blocker in RETRO and Linear.

### TRL-1275 Warden projection

- [ ] Create TRL-1275 from TRL-1273, never from TRL-1274.
- [ ] Keep rule-manifest interpretation and guidance derivation in Trails.
- [ ] Add an explicit deterministic Skillset source seam for derived guidance.
- [ ] Prove exactly one command owner for every artifact, especially root `AGENTS.md` and generated skill blocks.
- [ ] Verify drift propagation, record `release:none`, review, commit, and submit a draft PR.

## Phase 5 — full readiness

- [ ] Run at least three `trails-local-review` passes from relevant tips.
- [ ] Fix findings on the lowest owning branch and reverify affected descendants.
- [ ] Run all applicable repository, Warden, changeset, publication, Wayfinder, and lock-roundtrip gates.
- [ ] Keep PRs draft until local gates and fresh hosted CI are green.
- [ ] Resolve every human and review-bot thread; review-bot errors are blockers.
- [ ] Mark only proven PRs ready, update Linear and RETRO, and report any dependency-gated remainder precisely.

## Review topology

The coordinator owns integration and source-control mutation. Read-only subagents may audit bounded surfaces with exact anchors; they may not edit or mutate Git, Graphite, GitHub, or Linear. Review reports live under `reports/` and are committed only when they are durable goal evidence.
