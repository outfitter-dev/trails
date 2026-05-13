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
| 3 | `TRL-707` | `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | TBD | Fresh-start gate passed after beta.16 unblock |
| 4 | `TRL-712` | `trl-712-author-stable-release-doctrine-adr-for-the-1x-line` | TBD | Focused checks passed |
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
| `TRL-707` | Changed status to `In Progress`. | Branch investigation started; stopped by publish boundary. |
| `TRL-707` | Added Linear blocker comment. | Comment `58a5e8c5-74b9-4378-963b-c404368b9696` records the npm 404 evidence and smallest publish action. |
| `TRL-707` | Rechecked after packages were published. | Registry presence gate now passes, but fresh-start typecheck fails because published `@ontrails/commander@1.0.0-beta.15` imports public symbols absent from the published `@ontrails/core` and `@ontrails/cli` artifacts at the same version. Added Linear comment `f2c45844-1fe4-45e1-ba1b-eb2fd7d223ea`. |
| `TRL-707` | Rechecked after PR #501 beta.16 unblock. | Fresh-start gate passed from clean Bun cache: generated app requested `@ontrails/*@^1.0.0-beta.16`, install selected `@ontrails/cli`, `@ontrails/commander`, `@ontrails/core`, `@ontrails/hono`, `@ontrails/http`, `@ontrails/mcp`, `@ontrails/testing`, and `@ontrails/warden` at `1.0.0-beta.16`, then `bun run typecheck` and `bun test` passed. Added Linear comment `b0c10985-12d8-4a24-adc6-7d2c9140833a`. |
| `TRL-712` | Changed status to `In Progress`. | Branch execution started. |

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
- 2026-05-13T13:22Z: Started `TRL-707` and confirmed the blocker has no
  acceptable code-side fix under the current adapter-package doctrine. The
  generated CLI surface correctly depends on `@ontrails/commander`; reverting
  generated apps to the old `@ontrails/cli/commander` subpath would undercut
  the connector-to-adapter cutover. Stopped per the packet rule because the
  fresh-start install acceptance criterion requires registry publication.
- 2026-05-13T13:10Z: Rechecked registry state before resuming work. Direct
  `npm view @ontrails/commander version dist-tags --json` still returns npm
  E404, and `bun run publish:registry-check` still reports
  `@ontrails/commander`, `@ontrails/observe`, `@ontrails/topographer`, and
  `@ontrails/wayfinder` as first-time package candidates. Added a Linear
  comment to `TRL-707` with the blocked evidence.
- 2026-05-13T13:19:18Z: Rechecked live branch and registry state after resume.
  `git status --short --branch` is clean on
  `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects`,
  `gt log --stack --no-interactive` still shows only the completed
  `TRL-713`, `TRL-714`, and stopped `TRL-707` branches, and direct
  `npm view @ontrails/commander version dist-tags --json` still returns npm
  E404. The packet stop condition remains active.
- 2026-05-13T14:06:34Z: Rechecked after Matt reported packages were
  published. `npm view @ontrails/commander version dist-tags --json` now
  returns `1.0.0-beta.15` with `beta` and `latest` dist-tags, and
  `bun run publish:registry-check:published` passes for all non-private
  `@ontrails/*` workspaces. The fresh-start smoke now installs successfully
  but fails `bun run typecheck`: the published `@ontrails/commander` source
  imports `BaseSurfaceOptions` and `projectPublicSurfaceError` from
  `@ontrails/core` and `ResolveCliPermitFromToken`,
  `applyCliFlagValueAliases`, and `valueAliases`-bearing CLI types from
  `@ontrails/cli`; the published same-version `@ontrails/core` and
  `@ontrails/cli` artifacts do not expose those symbols. Local source does
  expose them, so this is a published-package skew, not a generated-project
  scaffold bug.
- 2026-05-13T16:11:08Z: Rechecked after PR #501
  (`chore: version packages to 1.0.0-beta.16`) merged at
  `662bf1a05cca1bd5220bea938f5bcaf4a55ff54e`. `main` and `origin/main` both
  resolve to that merge commit, and the active stack is clean at `TRL-707`
  atop `TRL-714` and `TRL-713`. A local macOS loader hang in the installed
  `@oxc-resolver` native binding blocked CLI startup before scaffolding; the
  copied binding loaded after ad-hoc signing, so the local `node_modules` copy
  was re-signed. No source files or registry state were changed by that repair.
  The beta.16 fresh-start smoke then passed from
  `/tmp/trails-docs-smoke-beta16.DtBa2o/docs-smoke` with clean Bun cache
  `/tmp/bun-cache-beta16.cuxqcC`.
- 2026-05-13T16:14Z: Started `TRL-712` on
  `trl-712-author-stable-release-doctrine-adr-for-the-1x-line` and added
  accepted ADR-0047, "Stable Release Line Discipline." The ADR keeps public
  `@ontrails/*` packages lockstep for the 1.x line, separates package semver
  from trail versioning, sets stable/prerelease dist-tag posture, makes
  generated-app installability a release gate, keeps Changesets as
  version/changelog authority and Bun as publish authority, and documents
  explicit partial-publish recovery and release PR evidence expectations.

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
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `bun run scaffold-versions:check` | Passed. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `bun run publish:check` | Passed; local packability is not enough to satisfy installability. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `bun apps/trails/bin/trails.ts create docs-smoke --dir "$tmp" --surfaces cli mcp http --verify --output json` | Passed; generated `package.json`, CLI/MCP/HTTP entries, tests, and `lefthook.yml`. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `(cd "$tmp/docs-smoke" && bun install)` | Failed with npm 404 for `@ontrails/commander@^1.0.0-beta.15`. Temporary project removed. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `npm view @ontrails/commander version dist-tags --json` | Still fails with npm E404 as of 2026-05-13T13:19:18Z. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `npm view @ontrails/commander version dist-tags --json` | Passed after publish; `version` is `1.0.0-beta.15` and both `beta` and `latest` dist-tags point at `1.0.0-beta.15`. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `bun run publish:registry-check:published` | Passed; every non-private `@ontrails/*` workspace is present at `1.0.0-beta.15` with `beta=1.0.0-beta.15`. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `tmp=$(mktemp -d /tmp/trails-docs-smoke.XXXXXX); bun apps/trails/bin/trails.ts create docs-smoke --dir "$tmp" --surfaces cli mcp http --verify --output json; (cd "$tmp/docs-smoke" && bun install && bun run typecheck && bun test); rm -rf "$tmp"` | Still failed at `bun run typecheck` after `bun install` succeeded. Published `@ontrails/commander@1.0.0-beta.15` imports symbols missing from published `@ontrails/core@1.0.0-beta.15` and `@ontrails/cli@1.0.0-beta.15`, including `BaseSurfaceOptions`, `projectPublicSurfaceError`, `ResolveCliPermitFromToken`, `applyCliFlagValueAliases`, and `CliFlag.valueAliases`. Tests passed only because the shell command continued after the typecheck failure; typecheck remains the blocking result. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `git rev-parse main origin/main HEAD` | Passed after external unblock; `main` and `origin/main` are `662bf1a05cca1bd5220bea938f5bcaf4a55ff54e`, with `HEAD` on `TRL-707` at `9522927e8475491700394f2524b1468899af086a`. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `tmp=$(mktemp -d /tmp/trails-docs-smoke-beta16.XXXXXX); bun apps/trails/bin/trails.ts create docs-smoke --dir "$tmp" --surfaces cli mcp http --verify --output json` | Passed; generated project at `/tmp/trails-docs-smoke-beta16.DtBa2o/docs-smoke` requested `@ontrails/cli`, `@ontrails/commander`, `@ontrails/core`, `@ontrails/hono`, `@ontrails/http`, `@ontrails/mcp`, `@ontrails/testing`, and `@ontrails/warden` as `^1.0.0-beta.16`. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `BUN_INSTALL_CACHE_DIR=/tmp/bun-cache-beta16.cuxqcC bun install` | Passed from a clean Bun cache; install selected `@ontrails/cli@1.0.0-beta.16`, `@ontrails/commander@1.0.0-beta.16`, `@ontrails/core@1.0.0-beta.16`, `@ontrails/hono@1.0.0-beta.16`, `@ontrails/http@1.0.0-beta.16`, `@ontrails/mcp@1.0.0-beta.16`, `@ontrails/testing@1.0.0-beta.16`, and `@ontrails/warden@1.0.0-beta.16`. The lock also resolved transitive `@ontrails/observe`, `@ontrails/permits`, `@ontrails/store`, and `@ontrails/topographer` at `1.0.0-beta.16`. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `bun run typecheck` | Passed in the generated app. |
| `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` | `bun test` | Passed in the generated app: 7 tests, 11 assertions. |
| `trl-712-author-stable-release-doctrine-adr-for-the-1x-line` | `bun scripts/adr.ts map` | Passed; regenerated `docs/adr/decision-map.json` and draft ADR indexes. |
| `trl-712-author-stable-release-doctrine-adr-for-the-1x-line` | `bun scripts/adr.ts check` | Passed; 0 errors, 0 warnings. |
| `trl-712-author-stable-release-doctrine-adr-for-the-1x-line` | `bun run format:check` | Passed. |
| `trl-712-author-stable-release-doctrine-adr-for-the-1x-line` | `git diff --check` | Passed. |

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
| `TRL-707` fresh-start smoke | Stopped before publish. | Exact failing dependency: `@ontrails/commander@^1.0.0-beta.15`. Smallest human action for this blocker: publish `@ontrails/commander@1.0.0-beta.15` with `bun run publish:packages -- --only @ontrails/commander`, then rerun `bun run publish:registry-check:published` or a targeted registry check and the fresh-start smoke. Do not use `npm publish` or `changeset publish`. |
| `bun run publish:registry-check:published` | Read-only probe only; no publish. | Passed after external publication; registry presence is no longer the blocker. |
| `TRL-707` fresh-start smoke after beta.15 publish | Historical failed probe; superseded by PR #501 beta.16 unblock. | Install passed; typecheck failed because the generated project consumed published source `.ts`, and the published `@ontrails/commander` artifact was ahead of the published `@ontrails/core` / `@ontrails/cli` public exports despite sharing version `1.0.0-beta.15`. |
| `TRL-707` fresh-start smoke after PR #501 beta.16 unblock | Passed; no publish and no registry mutation. | Clean-cache install selected the generated-project `@ontrails/*` dependency set at `1.0.0-beta.16`; generated app typecheck and tests passed. |

## Final State

Do not mark complete until PRs are ready, remote P2+ feedback is resolved or
reported, Linear status is current, no forbidden publish/merge action occurred,
and no merge was performed.
