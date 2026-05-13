# Execution Retro: V1 Readiness Closure Stack

Date started: 2026-05-13
Plan: `.agents/plans/2026-05-13-v1-readiness-closure-stack/PLAN.md`

Maintain this retro during execution. Commit it at the last meaningful point
before handoff or merge readiness.

## Planning Discoveries

- The prior completed packet
  `.agents/plans/2026-05-12-topograph-query-docs-stack/` was moved to
  `.agents/plans/archive/2026-05-12-topograph-query-docs-stack/` when this
  packet was created. Its load-bearing M3/M5/M6 audit reports were copied into
  this packet under `reports/source-*.md`.
- `main` was clean and equal to `origin/main` at packet creation, with PR #500
  (`docs: audit release cutover process`) at HEAD.
- `gt log --stack --no-interactive` still showed old draft PR #479 on
  `chore/docs-freshness-taxonomy-vocab`; it is dirty against current `main` and
  out of scope for this stack.
- GitHub still showed draft PR #447 (`feat(adapters): add @ontrails/bun
  adapter`); it is an independent adapter/product decision and out of scope.
- Linear natural-language research still failed with `Tool research not found`,
  so live issue state was checked through direct issue queries and targeted
  updates.
- Linear showed `TRL-704` through `TRL-714` in `Backlog`, parented to
  `TRL-634`, `TRL-636`, or `TRL-637`, and assigned to the expected v1 Release
  Prep milestones.
- Dependency edges added during planning:
  - `TRL-705` is blocked by `TRL-704` and `TRL-706`.
  - `TRL-711` is blocked by `TRL-712`, `TRL-713`, and `TRL-714`.
  - `TRL-707` is related to `TRL-714`.
- `TRL-707` may require a real package publish to fully prove fresh-start
  installability. This packet explicitly forbids real publish/registry mutation
  without Matt's confirmation and requires the executor to stop if no code-side
  fix exists.

## Stack

| Order | Issue | Branch | PR | Status |
| --- | --- | --- | --- | --- |
| 1 | `TRL-713` | `trl-713-repair-stale-changesets-references-before-stable-cutover` | TBD | Focused checks passed |
| 2 | `TRL-714` | `trl-714-add-registry-availability-and-dist-tag-release-preflights` | TBD | Focused checks passed |
| 3 | `TRL-707` | `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | TBD | Not started |
| 4 | `TRL-712` | `trl-712-author-stable-release-doctrine-adr-for-the-1x-line` | TBD | Not started |
| 5 | `TRL-711` | `trl-711-codify-the-beta-to-10-release-runbook` | TBD | Not started |
| 6 | `TRL-709` | `trl-709-add-markdown-link-integrity-check-for-docs-and-readmes` | TBD | Not started |
| 7 | `TRL-708` | `trl-708-expand-readme-typescript-snippet-verification-beyond-tracing` | TBD | Not started |
| 8 | `TRL-710` | `trl-710-create-public-api-example-coverage-inventory-and-gate` | TBD | Not started |
| 9 | `TRL-704` | `trl-704-add-http-surface-harness-and-include-it-in` | TBD | Not started |
| 10 | `TRL-706` | `trl-706-expose-complete-shipped-surface-projection-inventory-for` | TBD | Not started |
| 11 | `TRL-705` | `trl-705-add-example-driven-climcphttp-parity-runner-and-ci-gate` | TBD | Not started |

## Tracker Mutations

Record issues, milestones, dependency links, comments, labels, and follow-up
issues created or updated during execution.

| Item | Mutation | Link / Notes |
| --- | --- | --- |
| `TRL-705` | Added blockers `TRL-704` and `TRL-706`. | Planning alignment |
| `TRL-711` | Added blockers `TRL-712`, `TRL-713`, and `TRL-714`. | Planning alignment |
| `TRL-707` | Related to `TRL-714`. | Planning alignment |
| `TRL-713` | Changed status to `In Progress`. | Branch execution started. |
| `TRL-714` | Changed status to `In Progress`. | Branch execution started. |

## Local Review Reports

Reports should live under:

```text
.agents/plans/2026-05-13-v1-readiness-closure-stack/reports/
```

| Round | Lane | Report | Result |
| --- | --- | --- | --- |
| 1 | Release | TBD | Not started |
| 1 | Fresh-start/docs | TBD | Not started |
| 1 | Parity/testing | TBD | Not started |
| 1 | Source-control/changeset | TBD | Not started |
| 2 | Release | TBD | Not started |
| 2 | Fresh-start/docs | TBD | Not started |
| 2 | Parity/testing | TBD | Not started |
| 2 | Source-control/changeset | TBD | Not started |
| 3 | Release | TBD | Not started |
| 3 | Fresh-start/docs | TBD | Not started |
| 3 | Parity/testing | TBD | Not started |
| 3 | Source-control/changeset | TBD | Not started |

Continue with round 4+ if the latest pass finds any P0/P1/P2 issue.

## Deferred / Follow-Up Discoveries

Record out-of-goal discoveries here. File focused follow-up issues when the
discovery is real and outside this goal.

| Issue | Discovery | Why Out Of Goal | Link |
| --- | --- | --- | --- |
| TBD | TBD | TBD | TBD |

## Execution Log

Record branch creation, implementation checkpoints, restacks, PR submission,
ready waves, and remote review turns here.

- 2026-05-13T13:03:19Z: Started execution from `main` at
  `2a754ecd16831fd63f409e33af57d67ad43f9cfd`, equal to `origin/main`.
  `gt sync` completed successfully. GitHub confirmed PRs #488 through #500 are
  merged. Open PR preflight showed only draft PR #479
  (`chore/docs-freshness-taxonomy-vocab`) and draft PR #447
  (`feat/adapters-bun`), both out of scope. Linear connector confirmed
  `TRL-704` through `TRL-714` remain Backlog in `v1 Release Prep` with the
  expected milestones and dependency/related links. No `.trails` or
  `.trails-tmp` generated artifacts were staged. Created lowest execution
  branch `trl-713-repair-stale-changesets-references-before-stable-cutover`.
- 2026-05-13T13:08Z: Completed the initial `TRL-713` fix by removing the
  retired `@ontrails/logging` package from
  `.changeset/logtape-observe-target.md` while preserving the
  `@ontrails/logtape` release note.
- 2026-05-13T13:15Z: Added `TRL-714` registry preflight script and package
  scripts. `bun run publish:registry-check` performs read-only npm probes and
  reports missing packages as first-time package candidates; the stricter
  `bun run publish:registry-check:published` mode requires every package to be
  present after publication.

## Verification Log

Record focused branch checks and full tip gate results here.

| Branch | Command | Result |
| --- | --- | --- |
| `trl-713-repair-stale-changesets-references-before-stable-cutover` | `bunx changeset status --verbose` | Passed; release plan computes and includes `@ontrails/logtape` via `.changeset/logtape-observe-target.md`. |
| `trl-713-repair-stale-changesets-references-before-stable-cutover` | `bun run changeset:check` | Passed. |
| `trl-713-repair-stale-changesets-references-before-stable-cutover` | `bun run format:check` | Passed. |
| `trl-713-repair-stale-changesets-references-before-stable-cutover` | `git diff --check` | Passed. |
| `trl-714-add-registry-availability-and-dist-tag-release-preflights` | `bun test scripts` | Passed, 35 tests. |
| `trl-714-add-registry-availability-and-dist-tag-release-preflights` | `bun run publish:registry-check` | Passed; reported first-time package candidates `@ontrails/commander`, `@ontrails/observe`, `@ontrails/topographer`, and `@ontrails/wayfinder`; all other packages had `beta=1.0.0-beta.15`. |
| `trl-714-add-registry-availability-and-dist-tag-release-preflights` | `bun run publish:check` | Passed. |
| `trl-714-add-registry-availability-and-dist-tag-release-preflights` | `bun run format:check` | Passed. |
| `trl-714-add-registry-availability-and-dist-tag-release-preflights` | `git diff --check` | Passed. |

## Review Feedback

Record P0/P1/P2 feedback, owning branches, fixes, replies, and unresolved P3s.

| Source | Branch | Severity | Finding | Resolution |
| --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD |

## Publish / Registry Safety

Record any registry probes, credentials/access limits, or stopped publish
actions here. No real publish should happen without Matt's explicit
confirmation.

| Check | Result | Notes |
| --- | --- | --- |
| `bun run publish:registry-check` | Read-only probe only; no publish. | First-time candidates: `@ontrails/commander`, `@ontrails/observe`, `@ontrails/topographer`, `@ontrails/wayfinder`. |

## Final State

Do not mark complete until PRs are ready, remote P2+ feedback is resolved or
reported, Linear status is current, no forbidden publish/merge action occurred,
and no merge was performed.
