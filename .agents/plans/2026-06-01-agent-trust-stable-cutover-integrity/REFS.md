---
created: "2026-06-01T17:30:00-04:00"
updated: "2026-06-01T17:47:00-04:00"
status: staged-outside-worktree
---

# References

## Packet Locations

- Staged packet:
  `/Users/mg/.agents/plans/trails/2026-06-01-agent-trust-stable-cutover-integrity`
- Eventual in-repo destination:
  `.agents/plans/2026-06-01-agent-trust-stable-cutover-integrity/`

## Repo Guidance

- `AGENTS.md`
- `.agents/plans/PLANNING.md`
- `docs/tenets.md`
- `docs/lexicon.md`
- `docs/architecture.md`
- `docs/adr/0048-trail-versioning-v3.md`
- `docs/releases/stable-cutover.md`

## Linear Issues

- `TRL-772`: Make version markers account for or reject Zod validation checks.
- `TRL-773`: Align marker-schema-unsupported Warden coverage with runtime
  marker failures.
- `TRL-770`: Make trails doctor pending-force output complete and actionable.
- `TRL-769`: Document pending-force stable cutover gate.
- `TRL-771`: Define accepted-exception semantics for pending force events.
- `TRL-878`: Apply Warden scan-target filtering to Regrade.
- `TRL-877`: Resolve wildcard export keys in catalog derivation.
- `TRL-872`: Migrate remaining first-party adapters into adapter.check model.

## Marker and Versioning

- `packages/core/src/version-marker.ts`
- `packages/core/src/__tests__/version-marker.test.ts`
- `packages/core/src/version-resolution.ts`
- `packages/core/src/__tests__/version-execution.test.ts`
- `packages/topographer/src/versioning.ts`
- `packages/topographer/src/derive.ts`
- `packages/topographer/src/__tests__/derive.test.ts`
- `packages/topographer/src/__tests__/diff.test.ts`
- `docs/adr/0048-trail-versioning-v3.md`

Notable evidence:

- ADR-0048 says marker canonicalization is intentionally bounded to the
  supported Zod subset and unsupported schema features must fail loudly.
- `deriveTrailVersionMarker()` hashes canonicalized marker content from the
  projected contract.
- Current Warden source rule coverage is narrower than runtime marker failures.

## Warden Marker Diagnostics

- `packages/warden/src/rules/trail-versioning-source.ts`
- `packages/warden/src/__tests__/trail-versioning-rules.test.ts`
- `packages/warden/src/rules/ast.ts`
- `packages/warden/src/rules/metadata.ts`

Notable evidence:

- `unsupportedSchemaCalls` currently includes `any`, `custom`, `preprocess`,
  `transform`, and `unknown`.
- `markerSchemaUnsupported` already scopes analysis to versioned trail
  `input`/`output` and historical version entries.
- The existing test suite pins a callback-scope guard.

## Doctor and Pending Force Events

- `apps/trails/src/trails/doctor.ts`
- `apps/trails/src/trails/version-lifecycle-support.ts`
- `apps/trails/src/__tests__/version-lifecycle.test.ts`
- `apps/trails/src/__tests__/survey.test.ts`
- `packages/topographer/src/forces.ts`
- `packages/topographer/src/types.ts`
- `packages/topographer/src/__tests__/forces.test.ts`

Notable evidence:

- `deriveDoctorSummary()` currently increments `forceEvents` from
  `entry.forces?.length`.
- Graph-level removed-entity force events are stored on `graph.forces`.
- `survey.test.ts` already covers graph-level removed-trail force events.

## Regrade and Warden Scan Targets

- `packages/warden/src/cli.ts`
- `packages/warden/src/rules/scan.ts`
- `packages/warden/src/trails/run.ts`
- `packages/warden/src/rules/no-legacy-layer-imports.ts`
- `packages/regrade/src/downstream/collect.ts`
- `packages/regrade/src/downstream/report.ts`
- `packages/regrade/src/downstream/__tests__/report.test.ts`
- `packages/regrade/src/downstream/__tests__/radio-fixture.test.ts`

Notable evidence:

- Warden CLI excludes `.d.ts`, `__tests__/`, `__test__/`, `*.test.ts`, and
  `*.spec.ts` from most committed-source diagnostics.
- Regrade collects `.ts` and `.tsx` sources and projects Warden
  `term-rewrite` metadata into Regrade classes.
- `no-legacy-layer-imports` comments rely on test files being filtered before
  that rule is applied.

## Adapter Catalog and Checks

- `packages/adapter-kit/src/catalog.ts`
- `packages/adapter-kit/src/check.ts`
- `packages/adapter-kit/src/__tests__/catalog.test.ts`
- `packages/adapter-kit/src/__tests__/check.test.ts`
- `packages/adapter-kit/src/__tests__/dogfood.test.ts`
- `packages/warden/src/__tests__/adapter-check.test.ts`
- `apps/trails/src/__tests__/adapter-check.test.ts`
- `docs/adr/drafts/20260528-adapter-authoring-as-a-paved-path.md`
- `.agents/plans/2026-05-30-v1-convergence-loop/PLAN.md`
- `.agents/plans/2026-05-30-v1-convergence-loop/RETRO.md`

Notable evidence:

- `exportSpecifierFromKey()` currently returns `undefined` for export keys that
  contain `*`.
- `TRL-877` was filed from review feedback showing valid pattern exports can
  make declared owner imports look invalid.
- `TRL-872` is intentionally conditional until remaining first-party adapter
  owner targets/conformance surfaces are explicit.

## Review and Planning References

- `/Users/mg/.agents/skills/goal-planning/references/code-review.md`
- `/Users/mg/.agents/skills/goal-planning/references/source-control.md`
- `/Users/mg/.agents/skills/goal-planning/references/trackers.md`
- `/Users/mg/.agents/skills/goal-planning/references/goal-runtimes.md`
- `/Users/mg/.agents/skills/graphite/SKILL.md`
- `/Users/mg/.agents/skills/graphite/references/STACK_SURGERY.md`

Graphite worktree notes:

- A Codex execution worktree must have a real branch checked out; detached
  worktrees cannot create Graphite child branches.
- Prefer creating the first real Linear branch with Graphite, returning the
  primary worktree to `main`, then launching or adding the dedicated worktree
  on that branch.
- If the Codex thread tool owns the worktree location, use `pwd -P` inside the
  delegated thread as the authoritative path.
- Use zero-diff Graphite-tracked base lanes only for worker-farm setups where a
  worker needs a real branch under `main`; do not submit those base lanes as PRs.
- `gt sync` is not part of default worktree setup for this packet.

## Current Live Commands

Useful refresh commands before execution:

```bash
pwd
git status --short --branch
git diff --stat
git worktree list --porcelain
gt log --no-interactive
gh pr list --repo outfitter-dev/trails --state open --limit 20 --json number,title,headRefName,isDraft,url,mergeStateStatus,statusCheckRollup
```

If `gt` resolves through `/Users/mg/.codex/rtk-shims/gt`, use
`RTK_SHIM_BYPASS=1` for Graphite commands until the environment is clean.
