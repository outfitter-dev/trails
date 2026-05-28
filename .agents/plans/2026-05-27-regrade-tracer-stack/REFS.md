---
created: "2026-05-27T20:12:09Z"
updated: "2026-05-27T20:12:09Z"
description: Source map for the Regrade tracer stack. Lists tracked portable sources (doctrine, code anchors), untracked local-only sources with a self-sufficiency note, tracker records for the Regrade project and all related Linear issues (TRL-819, TRL-823, TRL-825–TRL-836) with URLs, existing PR context, planned branch names, prior plan references, and validation commands.
linear:
  - TRL-819
  - TRL-823
  - TRL-825
  - TRL-826
  - TRL-827
  - TRL-828
  - TRL-829
  - TRL-830
  - TRL-831
  - TRL-832
  - TRL-833
  - TRL-834
  - TRL-835
  - TRL-836
impl_status: implemented
references:
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - docs/adr/0000-core-premise.md
  - docs/tenets.md
  - docs/adr/0001-naming-conventions.md
  - docs/lexicon.md
  - docs/architecture.md
  - docs/adr/0047-stable-release-line-discipline.md
  - docs/releases/stable-cutover.md
  - scripts/publish.ts
  - packages/core/src/types.ts
  - packages/core/src/type-utils.ts
  - packages/core/src/trail.ts
  - packages/core/src/type-checks.test-d.ts
  - packages/testing/src/examples.ts
  - packages/testing/src/__tests__/contracts.test.ts
  - packages/topographer/src/derive.ts
  - packages/wayfinder/package.json
  - apps/trails/package.json
  - .agents/plans/2026-05-26-fieldwork-compounding-stack/
  - .agents/plans/2026-05-26-compose-cutover-stack/
---

# References: Regrade Tracer Stack

## Tracked / Portable Sources

- `AGENTS.md` - repo commands, vocabulary, Warden guide, Graphite workflow,
  subagent source-control rules, release policy, and Linear team details.
- `.agents/plans/PLANNING.md` - goal packet conventions, review protocol,
  Graphite preferences, validation commands, and stop rules.
- `docs/adr/0000-core-premise.md` - "author what's new, derive what's known,
  override what's wrong."
- `docs/tenets.md` - Trails doctrine for contract-first derivation and drift
  reduction.
- `docs/adr/0001-naming-conventions.md` - naming hierarchy and vocabulary
  discipline.
- `docs/lexicon.md` - canonical terms: trail, blaze, topo, compose, surface,
  resource, layer.
- `docs/architecture.md` - current framework architecture.
- `docs/adr/0047-stable-release-line-discipline.md` - release/package
  coherence doctrine for TRL-823.
- `docs/releases/stable-cutover.md` - publish-check and registry workflow
  context.
- `scripts/publish.ts` - TRL-823 implementation target; currently packs and
  rejects unresolved `workspace:` / `catalog:` ranges.
- `packages/core/src/types.ts` - `ComposeFn` overloads and `TrailContext`.
- `packages/core/src/type-utils.ts` - `TrailInput`, `TrailOutput`,
  `ComposeInput`, and suspected TRL-819 seam.
- `packages/core/src/trail.ts` - `Trail`, `TrailSpec`, trail visibility,
  compose ref normalization, and `AnyTrail`.
- `packages/core/src/type-checks.test-d.ts` - compile-time type assertions for
  compose and resource inference.
- `packages/testing/src/examples.ts` - example execution for trails with
  `composes`; useful for TRL-825 code-string fixture examples.
- `packages/testing/src/__tests__/contracts.test.ts` - composition contract
  test precedent.
- `packages/topographer/src/derive.ts` - topo projection source for tracer
  pollution evidence.
- `packages/wayfinder/package.json` and `packages/wayfinder/src/` - minimal
  package-shell reference for a new experimental package.
- `apps/trails/package.json` - local app dependency surface if the tracer needs
  integrated CLI consumption.

## Untracked / Local-Only Sources

- `/Users/mg/Developer/outfitter/trailblazing/plans/regrade/README.md` -
  source planning spine for Regrade. Load-bearing decisions are summarized in
  `PLAN.md`; execution should not depend on this file existing.
- `/Users/mg/Developer/outfitter/trailblazing/inbox/2026-05-27-regrade-migration-as-composite-trails.md` -
  pre-ADR narrative source. This packet carries the relevant execution
  decisions.
- `.agents/plans/2026-05-26-radio-compose-proof/README.md` - unrelated
  untracked local state in the main checkout; do not touch.

## Copied Or Summarized Sources

- `PLAN.md` summarizes the Regrade Linear setup, doctrine, and first-stack
  scope from the trailblazing plan.
- `RETRO.md` records the Linear project/issue IDs created before this packet.

## Tracker Records

- Regrade project - <https://linear.app/outfitter/project/regrade-f8b27fadc302>
- TRL-819 - <https://linear.app/outfitter/issue/TRL-819/fix-ctxcomposetrail-input-inference-for-trails-without-composeinput>
  - Role: hard blocker for TRL-825; fixes trail-object compose inference.
- TRL-823 - <https://linear.app/outfitter/issue/TRL-823/fail-publish-checks-when-packed-manifests-rewrite-first-party-deps-to>
  - Role: release/package guardrail; first branch in this stack.
- TRL-825 - <https://linear.app/outfitter/issue/TRL-825/scaffold-packagesregrade-and-prove-literal-transform-trails>
  - Role: architecture tracer; stack tip.
- TRL-826 - <https://linear.app/outfitter/issue/TRL-826/prove-regrade-package-source-modes>
  - Role: next-stack package-source modes; out of scope here.
- TRL-827 - <https://linear.app/outfitter/issue/TRL-827/support-downstream-roots-rule-selection-and-coverage-reporting>
  - Role: next-stack downstream reach; out of scope here.
- TRL-828 - <https://linear.app/outfitter/issue/TRL-828/implement-trails-regrade-and-needsreview-routing>
  - Role: later CLI/NeedsReview work; blocked by TRL-825.
- TRL-829 - <https://linear.app/outfitter/issue/TRL-829/draft-regrade-adr-from-tracer-evidence>
  - Role: later ADR; blocked by TRL-825.
- TRL-830 - <https://linear.app/outfitter/issue/TRL-830/define-warden-fix-metadata-and-safe-fix-execution>
  - Role: Warden fix metadata; blocks rename-class integration only.
- TRL-831 - <https://linear.app/outfitter/issue/TRL-831/define-the-warden-fix-metadata-contract>
- TRL-832 - <https://linear.app/outfitter/issue/TRL-832/add-term-rewrite-fix-metadata-for-retired-vocabulary>
- TRL-833 - <https://linear.app/outfitter/issue/TRL-833/implement-warden-fix-for-safe-source-edits>
- TRL-834 - <https://linear.app/outfitter/issue/TRL-834/draft-warden-fix-metadata-adr>
- TRL-835 - <https://linear.app/outfitter/issue/TRL-835/triage-trails-warden-help-and-hook-integrity-package-mode>
- TRL-836 - <https://linear.app/outfitter/issue/TRL-836/integrate-warden-backed-term-rewrite-regrades>
  - Role: later Warden-backed Regrade integration; blocked by TRL-825/827/830.

## PRs / Branches

- PR #602 - existing unrelated draft docs stack; do not touch unless Graphite
  reports a real base conflict.
- PR #607 - existing unrelated draft TRL-824 stack; do not touch unless
  Graphite reports a real base conflict.
- Planned branch:
  `trl-823-fail-publish-checks-when-packed-manifests-rewrite-first`
- Planned branch:
  `trl-819-fix-ctxcomposetrail-input-inference-for-trails-without`
- Planned branch:
  `trl-825-scaffold-packagesregrade-and-prove-literal-transform-trails`

## Prior Plans

- `.agents/plans/2026-05-26-fieldwork-compounding-stack/` - useful precedent
  for stacked execution, subagent use, review logging, and retro discipline.
- `.agents/plans/2026-05-26-compose-cutover-stack/` - useful precedent for
  compose vocabulary doctrine and branch/review handling.

## Validation Commands

- `/Users/mg/.agents/skills/goal-planning/scripts/context-prime.sh` - planning
  snapshot for git, Graphite, PRs, and packet conventions.
- `gt sync` - bring main/stack state current before branching.
- `gt ls` - inspect stack state and merged/stale branches.
- `git status --short --untracked-files=all` - detect unrelated dirty state.
- `bun run publish:check -- --only @ontrails/trails` - TRL-823 artifact check.
- `bun run --cwd packages/core typecheck` - TRL-819 compile-time type proof.
- `bun run --cwd packages/regrade typecheck` - TRL-825 package typecheck.
- `bun test packages/regrade` - TRL-825 package tests.
- `bun run typecheck` - repo type gate.
- `bun run test` - repo test gate.
- `bun run lint` - repo lint gate.
- `bun run lint:ast-grep` - repo ast-grep gate.
- `bun run format:check` - formatting gate.
- `git diff --check` - whitespace/conflict-marker gate.
- `bun run check` - aggregate repo gate.
