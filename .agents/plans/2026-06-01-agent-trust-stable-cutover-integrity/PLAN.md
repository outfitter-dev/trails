---
created: "2026-06-01T17:30:00-04:00"
updated: "2026-06-01T17:47:00-04:00"
status: staged-outside-worktree
owner: Lewis
eventual_repo_packet: ".agents/plans/2026-06-01-agent-trust-stable-cutover-integrity"
linear:
  - TRL-772
  - TRL-773
  - TRL-770
  - TRL-769
  - TRL-771
  - TRL-878
  - TRL-877
  - TRL-872
---

# Agent Trust / Stable Cutover Integrity

## Packet Status

This packet is intentionally staged outside the Trails worktree at:

`/Users/mg/.agents/plans/trails/2026-06-01-agent-trust-stable-cutover-integrity`

The eventual in-repo packet destination is:

`.agents/plans/2026-06-01-agent-trust-stable-cutover-integrity/`

Do not treat this home-level packet as source already committed to Trails. When
execution starts in a dedicated worktree, copy the packet wholesale into the
execution worktree, then commit it on the lowest branch in the implementation
stack or on the first branch that makes the packet load-bearing.

## Objective

Build one ambitious but coherent Graphite stack that makes Trails' trust loop
reliable enough for agents and release reviewers:

1. Version markers must not silently collide for semantically different
   contracts.
2. Warden must catch unsupported version-marker schemas before graph derivation
   fails.
3. `trails doctor` must provide actionable stable-cutover evidence, especially
   pending force events.
4. Regrade must consume Warden truth without bypassing Warden's target filter.
5. Adapter catalog derivation must stay trustworthy before more adapters opt
   into `adapter.check`.
6. The capstone should be a first read-only checkpoint verdict over existing
   evidence, not an autofix or source-control mutation platform.

The result should feel like a single product lane: "Can an agent trust this
repo state?" The answer should be grounded in Warden, doctor, Regrade, adapter
checks, CI, review state, and the durable `RETRO.md`.

## Live Starting State

Verified on 2026-06-01:

- Primary cwd: `/Users/mg/Developer/outfitter/trails`.
- Git: clean `main`, tracking `origin/main`.
- Current commit: `ed5926bdd docs: converge Trails documentation surfaces (#645)`.
- Graphite: `main` only.
- Open GitHub PRs: none.
- Remaining worktree besides primary: Clark at
  `/Users/mg/Developer/outfitter/trails/.claude/worktrees/clark` on
  `worktree-clark`.

## Stack Order

| Order | Issue | Branch | Purpose |
| --- | --- | --- | --- |
| 1 | TRL-772 | `trl-772-make-version-markers-account-for-or-reject-zod-validation` | Decide and implement bounded marker behavior for validation checks that currently collide. |
| 2 | TRL-773 | `trl-773-align-marker-schema-unsupported-warden-coverage-with-runtime` | Bring Warden's `marker-schema-unsupported` coverage up to the runtime marker subset. |
| 3 | TRL-770 | `trl-770-make-trails-doctor-pending-force-output-complete-and` | Make `trails doctor` count and report entry-level and graph-level force events. |
| 4 | TRL-769 | `trl-769-document-pending-force-stable-cutover-gate` | Update release docs once doctor has actionable pending-force output. |
| 5 | TRL-771 | `trl-771-define-accepted-exception-semantics-for-pending-force-events` | Conditional: only if implementation needs structured accepted-exception semantics before the checkpoint verdict. |
| 6 | TRL-878 | `trl-878-apply-warden-scan-target-filtering-to-regrade` | Keep Regrade's Warden-backed route aligned with Warden's own scan-target exclusions. |
| 7 | TRL-877 | `trl-877-resolve-wildcard-export-keys-in-catalog-derivation` | Fix adapter catalog export-pattern support before more adapter subjects opt in. |
| 8 | TRL-872 | `trl-872-migrate-remaining-first-party-adapters-into-adaptercheck` | Conditional: migrate Commander/Vite/Drizzle only after catalog truth is solid and owner targets are explicit. |
| 9 | New or explicit non-Linear branch | TBD | Read-only checkpoint verdict over existing Warden/doctor/Regrade/adapter evidence. Create a focused Linear issue first unless Matt chooses a non-issue branch. |

## Recommended Direction

For `TRL-772`, bias toward rejecting schema features the marker projector cannot
canonically represent with confidence for v1. This is a contract line, not a
convenience API. A clear unsupported diagnostic is better than two different
runtime contracts sharing the same marker.

For the capstone checkpoint, keep the first slice narrow:

- read-only;
- existing evidence only;
- no git or Graphite mutation;
- no autofix;
- no typecheck/build shell-out orchestration as part of the checkpoint itself;
- verdict vocabulary distinct from rule severity: `pass`, `caution`, `block`,
  and maybe `reroute`.

The checkpoint can call or compose existing Trails/Warden/doctor surfaces if the
repo shape supports that cleanly. It should not become a generic task runner.

## Branch Slice Details

### TRL-772: Marker Semantics

Problem: version-marker content currently runs through JSON-schema projection
and canonicalization. The issue audit says several Zod validation semantics are
accepted but do not change marker content.

Primary source anchors:

- `packages/core/src/version-marker.ts`
- `packages/core/src/__tests__/version-marker.test.ts`
- `packages/topographer/src/versioning.ts`
- `packages/topographer/src/__tests__/derive.test.ts`
- `docs/adr/0048-trail-versioning-v3.md`

Completion contract:

- Decide per construct whether it is supported marker content or unsupported
  bounded-Zod input for v1.
- Cover string checks, number checks, array checks, object
  strict/passthrough/catchall policy, `refine`, and `superRefine`.
- If supported, marker hashes must change when semantics change.
- If unsupported, marker derivation must fail loudly with pathful diagnostics.
- Update ADR/docs if the bounded marker subset changes.

### TRL-773: Warden Early Diagnostics

Problem: Warden currently flags only `any`, `custom`, `preprocess`,
`transform`, and `unknown` in versioned schemas. Runtime marker derivation also
rejects additional constructs such as `lazy`, `intersection`, and `record`.

Primary source anchors:

- `packages/warden/src/rules/trail-versioning-source.ts`
- `packages/warden/src/__tests__/trail-versioning-rules.test.ts`
- `packages/warden/src/rules/ast.ts`

Completion contract:

- Expand `marker-schema-unsupported` to match the bounded marker subset from
  `TRL-772`.
- Preserve the callback-scope guard. A helper named `transform` or a method
  call inside a callback must not become a false positive.
- Keep the rule scoped to versioned trail `input`/`output` schemas and
  historical version entries.

### TRL-770, TRL-769, TRL-771: Doctor and Release Gate

Problem: `deriveDoctorSummary()` counts `entry.forces`, but graph-level
`graph.forces` records removed-entity force events. Current doctor output is
aggregate-only and not actionable enough for a release reviewer.

Primary source anchors:

- `apps/trails/src/trails/doctor.ts`
- `apps/trails/src/trails/version-lifecycle-support.ts`
- `apps/trails/src/__tests__/version-lifecycle.test.ts`
- `apps/trails/src/__tests__/survey.test.ts`
- `packages/topographer/src/forces.ts`
- `packages/topographer/src/types.ts`
- `docs/releases/stable-cutover.md`

Completion contract:

- Doctor counts both entry-attached and graph-level force events.
- Doctor reports enough structured detail to identify forced
  trail/resource/signal/contour, change type, detail, severity, and source.
- Release docs name pending force events as a stable cutover gate after the
  doctor output can support that review.
- Accepted-exception semantics are implemented only if necessary for the
  checkpoint verdict or stable cutover gate. Do not invent a broad policy model
  prematurely.

### TRL-878: Regrade Scan-Target Parity

Problem: Regrade invokes Warden-backed term-rewrite logic on collected
`.ts`/`.tsx` files, but Warden's CLI excludes `.d.ts`, `__tests__/`,
`*.test.ts`, and `*.spec.ts` before most rule dispatch. Regrade must not route
files to review that Warden itself would skip.

Primary source anchors:

- `packages/warden/src/cli.ts`
- `packages/warden/src/rules/scan.ts`
- `packages/warden/src/trails/run.ts`
- `packages/regrade/src/downstream/collect.ts`
- `packages/regrade/src/downstream/report.ts`
- `packages/regrade/src/downstream/__tests__/report.test.ts`
- `packages/warden/src/rules/no-legacy-layer-imports.ts`

Completion contract:

- Regrade applies the same Warden target filtering before Warden-backed rule
  checks, or routes through a shared Warden dispatcher/helper.
- `.tsx` source support remains intact.
- Regression covers test fixtures, declaration files, and normal source files.

### TRL-877 and TRL-872: Adapter Catalog Trust

Problem: catalog derivation drops wildcard export keys because
`exportSpecifierFromKey()` ignores keys containing `*`. That makes valid package
exports like `"./*": "./src/*.ts"` fail owner-import validation.

Primary source anchors:

- `packages/adapter-kit/src/catalog.ts`
- `packages/adapter-kit/src/__tests__/catalog.test.ts`
- `packages/adapter-kit/src/__tests__/check.test.ts`
- `apps/trails/src/__tests__/adapter-check.test.ts`
- `packages/warden/src/__tests__/adapter-check.test.ts`
- `docs/adr/drafts/20260528-adapter-authoring-as-a-paved-path.md`

Completion contract:

- Resolve declared owner imports against wildcard export keys before reporting
  `invalid-import`.
- Add focused regression coverage for pattern export keys and existing explicit
  exports.
- Migrate remaining first-party adapters only after owner target/conformance
  decisions are explicit. Do not infer targets from package names.

### Capstone: Read-Only Checkpoint Verdict

This slice needs a tracker decision before implementation. Either create a new
Linear issue or use an explicit non-issue branch if Matt chooses that path.

Completion contract:

- Produces a read-only verdict over the evidence now made reliable:
  marker/Warden state, doctor pending-force state, Regrade scan-target parity,
  adapter-check state, and possibly open PR/review state if done outside the
  package API.
- Machine-readable output includes verdict, blockers, cautions, reroutes, and
  source evidence references.
- Does not mutate git, Graphite, GitHub, Linear, source files, lockfiles, or
  generated artifacts.
- Does not shell out to broad build/typecheck/test gates in the first slice.

## Source-Control Plan

Planning phase:

- Do not create branches.
- Do not edit the primary worktree.
- Do not commit this home-level packet.

Execution phase:

1. Run the Graphite first-pass state check before any source-control write:

   ```bash
   git status --short
   git diff --stat
   git worktree list --porcelain
   gt log --no-interactive
   gh pr list --repo outfitter-dev/trails --state open --limit 100 --json number,title,headRefName,isDraft,url
   ```

2. Create or choose a dedicated execution worktree. The worktree must have a
   real Graphite-tracked branch checked out. Do not execute this stack from a
   detached Codex worktree. If Codex creates the delegated worktree, treat
   `pwd -P` inside that delegated thread as the authoritative worktree path.
3. Prefer the first-real-branch worktree pattern for this stack. Either the
   coordinator creates the branch before launching the delegated worktree, or
   the delegated thread is launched directly from this already-created branch:

   ```bash
   # from the primary clean worktree
   gt checkout main --no-interactive
   gt create trl-772-make-version-markers-account-for-or-reject-zod-validation --no-interactive
   gt checkout main --no-interactive

   # from the execution worktree
   pwd -P
   ./scripts/bootstrap.sh codex
   ```

   Do not run `gt sync` as setup unless the current turn explicitly authorizes
   it after inspecting live state. In active multi-worktree repos, `gt sync` is
   not harmless cleanup.
4. Copy this packet into that worktree at
   `.agents/plans/2026-06-01-agent-trust-stable-cutover-integrity/`.
5. Commit the packet on the lowest branch where it becomes load-bearing by
   staging the specific packet files:

   ```bash
   git add .agents/plans/2026-06-01-agent-trust-stable-cutover-integrity/PLAN.md \
     .agents/plans/2026-06-01-agent-trust-stable-cutover-integrity/GOAL.md \
     .agents/plans/2026-06-01-agent-trust-stable-cutover-integrity/RETRO.md \
     .agents/plans/2026-06-01-agent-trust-stable-cutover-integrity/REFS.md
   gt modify -c -m "chore(agent-trust): add execution packet" --no-interactive
   ```

6. Continue building the stack from the execution worktree with Graphite using
   exact Linear branch names. The first branch is already `TRL-772`; create
   each child branch with `gt create <branch> --no-interactive` from the current
   stack tip.
7. Keep the primary worktree free for coordination.

Use Graphite for source-control writes. Do not use `gt absorb`. Do not submit
empty branches. Do not merge, queue, or publish without Matt explicitly asking.
Subagents may inspect, edit files, run checks, and write reports only when
briefed; they must not run git/gt write commands or mutate PRs/Linear.

If a worker worktree farm is needed instead of this single stack-owner worktree,
use the Graphite-tracked base-lane pattern from the Graphite skill: create a
real zero-diff base branch under `main`, track it with Graphite, and let worker
lanes edit/test/report from child branches. Workers still must not submit,
sync, delete, untrack, merge, broadly restack, or perform source-control writes
unless Matt explicitly changes the repo rule for that delegation.

## Review Loop

Run local review from the stack tip before submission and repeat until the
latest pass is clean or P3-only.

Minimum local review lanes:

- marker semantics and ADR fit;
- Warden source-rule correctness and false-positive risk;
- doctor/release-gate product shape;
- Regrade/Warden parity;
- adapter catalog export-pattern correctness;
- checkpoint first-slice boundary.

Review output must use:

```markdown
Overall score: n/5

Summary:
<one short prose judgment>

Findings:
- P0/P1/P2/P3 - <file:line> - <finding>
  Prompt To Fix With AI:
  <concise fix prompt>

No-findings statement:
<what was inspected and what residual risk remains>
```

Fix all P0/P1/P2. P3 findings may be fixed if cheap or recorded in `RETRO.md`
with a reason.

## Validation Ladder

Use narrow checks per branch, then broaden at the stack tip.

Focused checks likely needed:

- `bun test packages/core/src/__tests__/version-marker.test.ts`
- `bun test packages/topographer/src/__tests__/derive.test.ts`
- `bun test packages/warden/src/__tests__/trail-versioning-rules.test.ts`
- `bun test apps/trails/src/__tests__/version-lifecycle.test.ts`
- `bun test apps/trails/src/__tests__/survey.test.ts`
- `bun test packages/regrade/src/downstream/__tests__/report.test.ts`
- `bun test packages/adapter-kit/src/__tests__/catalog.test.ts`
- `bun test packages/adapter-kit/src/__tests__/check.test.ts`
- `bun test packages/warden/src/__tests__/adapter-check.test.ts`
- `bun test apps/trails/src/__tests__/adapter-check.test.ts`

Broader checks before submission:

- `bun run lint`
- `bun run lint:ast-grep`
- `bun run format:check`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `bun run check`
- `bun run publish:check`
- `git diff --check`

Before submission:

```bash
gt submit --stack --draft --restack --no-edit --no-interactive --dry-run
gt submit --stack --draft --restack --no-edit --no-interactive
```

After submit, inspect each PR title/body and rewrite stale or placeholder
bodies with `gh pr edit --body-file` using real temp files. Keep PRs draft until
CI and local review are clean. Do not mark ready or merge unless the current
turn authorizes it.

When ADRs, generated guides, or agent-facing Warden docs change:

- `bun scripts/adr.ts map`
- `bun scripts/adr.ts check`
- `bun run warden:agents:sync`
- `bun run warden:skills:sync`
- `bun run warden:agents:check`
- `bun run warden:skills:check`

## Stop Rules

Stop and report before continuing if:

- `main`, Linear, or open PR state has drifted enough to invalidate the stack
  order.
- `TRL-772` requires supporting broad Zod semantics instead of rejecting
  unsupported constructs.
- The checkpoint capstone wants to mutate git, Graphite, GitHub, Linear, source
  files, or generated artifacts.
- `TRL-771` grows into a broad exception-governance system instead of the
  minimum shape needed for stable cutover.
- Review feedback finds P0/P1/P2 issues after four post-ready turns.
- Any command requires secrets, production access, publishing, merge, or merge
  queue actions.

## Handoff Requirements

The executor must update `RETRO.md` before every meaningful handoff:

- local completion;
- draft PR submission;
- ready-for-review request;
- remote review closeout;
- explicit user handoff;
- merge-readiness report;
- archive.

The final transcript must summarize branch/PR state, verification results,
review status, skipped checks, remaining risks, and confirmation that forbidden
actions did not occur.
