---
created: "2026-05-30T12:28:00Z"
updated: "2026-05-30T17:45:00Z"
status: active
---

# Retro

## Running Log

### 2026-05-30 08:18 EDT - Live state refreshed

- Primary checkout `/Users/mg/Developer/outfitter/trails` was clean on `main`.
- `main`, `origin/main`, and remote `refs/heads/main` all resolved to
  `3205521d0504da226c8c6d39867405e02197a2dc`.
- `gh pr list --state open` returned no open PRs.
- Existing worktree `/Users/mg/.config/codex/worktrees/4241/trails` remained a
  stale detached checkout and was not used for execution.

### 2026-05-30 08:21 EDT - Worktree lane created

- Created zero-diff Graphite branch `lewis/v1-convergence-lane` under `main`.
- Returned primary checkout to `main`.
- Added linked worktree:
  `/Users/mg/.config/codex/worktrees/trails-v1-convergence`.
- Verified linked worktree is on `lewis/v1-convergence-lane` and Graphite sees
  it above `main`.

### 2026-05-30 08:24 EDT - Worktree bootstrapped

- Ran `./scripts/bootstrap.sh codex`.
- Result: Bun compatible, linked worktree detected, dependencies installed
  locally, optional tools present, Graphite stack printed.
- Verified `node_modules` exists in the worktree and `git status` is clean.

### 2026-05-30 08:26 EDT - Linear scope updated

- Created TRL-861: adapter target metadata and catalog derivation.
- Created TRL-862: HTTP adapter authoring support and conformance factory.
- Created TRL-863: shared adapter check engine.
- Created TRL-864: Warden and `trails adapter check` projections.
- Created TRL-865: dogfood adapter authoring path on a first-party HTTP
  adapter.
- Retargeted TRL-805 from stale `add.adapter` wording to `create.adapter`.

### 2026-05-30 08:27 EDT - First branch started

- Created `trl-834-draft-warden-fix-metadata-adr` above
  `lewis/v1-convergence-lane`.
- Marked TRL-834 In Progress.
- Added a Linear start comment with branch and worktree details.

### 2026-05-30 08:28 EDT - Subagent sidecars launched

- Dewey: Warden fix metadata ADR source map.
- Beauvoir: adapter authoring substrate and branch-slice map.
- Planck: Regrade consuming Warden-backed `term-rewrite` metadata.
- Clark: doctrine and stack-order review.

### 2026-05-30 08:31 EDT - Sidecar findings folded into route

- Dewey found a Warden doctrine gap: `WardenDiagnostic.fix` exists, but the
  Warden rule trail diagnostic schema omits `fix`, so trail-shaped outputs can
  drop metadata that raw-rule paths preserve.
- Created TRL-866 to project diagnostic fix metadata through Warden rule trail
  outputs before TRL-836 depends on the data.
- Planck found TRL-836 should keep Regrade source collection, especially `.tsx`
  coverage, and consume Warden metadata without recreating Warden's safe-edit
  applicator or a parallel term table.
- Beauvoir confirmed Hono is the strongest HTTP dogfood candidate and warned
  that conformance must stay owner-owned, not inside adapter kit.
- Clark ruled the doctrine coherent but too broad as first sketched; accepted
  route change: dogfood the adapter path before shipping `create.adapter`, and
  make TRL-850 conditional unless live map drift/check evidence remains.

### 2026-05-30 08:38 EDT - TRL-866 implementation slice

- Started `trl-866-project-warden-diagnostic-fix-metadata-through-rule-trail`
  above the TRL-834 ADR base.
- Extended the Warden trail diagnostic schema with the existing structured
  `WardenFix` shape.
- Updated the `no-legacy-layer-imports` trail example so contract tests assert
  the review-required `term-rewrite` fix metadata survives trail projection.
- Added a regression proving `runWardenTrails()` preserves
  `diagnostic.fix.class === 'term-rewrite'` and `safety === 'review'`.
- Added a Warden patch changeset for the public output-shape fix.

### 2026-05-30 08:40 EDT - TRL-853 snippet truth slice

- Started `trl-853-draft-adr-conformance-snippet-calls-runconformance-without`
  above TRL-866.
- Verified TRL-853 is still live in Linear and still valid against the current
  adapter ADR draft.
- Updated the adapter conformance snippet to import `runConformance` from the
  same future owner testing subpath as `createHttpAdapterConformanceCases`.

### 2026-05-30 08:41 EDT - TRL-866 sidecar review tightened tests

- Kant reviewed diagnostic projection paths and found no blocker after the
  schema change.
- Folded in Kant's cheap guardrails: `formatJson()` now proves diagnostic
  `fix` survives structured JSON, and the `trails warden` output schema fixture
  now includes a structured fix object.

### 2026-05-30 08:51 EDT - TRL-861 catalog substrate slice

- Started `trl-861-define-adapter-target-metadata-and-catalog-derivation`
  above the adapter conformance snippet branch.
- Added internal `@ontrails/adapter-kit` package for read-only
  `trails.adapterTargets` catalog derivation.
- Added first-party metadata to `@ontrails/http` and `@ontrails/store`; HTTP
  advertises the target and placements only, while Store also advertises its
  existing support and testing owner imports.
- Kept support/testing imports optional so owners can advertise a target before
  every authoring affordance exists. Missing means "not available yet"; the
  tooling does not guess.
- Added focused catalog tests for valid owner metadata, missing metadata,
  invalid metadata, owner-local import boundaries, missing owner exports,
  export-target derivation, and deterministic extracted/subpath placements.
- Folded in Boole's review finding that declared support/testing imports should
  fail when they cross owner package boundaries or are not exported by the
  owner package.
- Trimmed premature template/fixture/guidance fields out of the substrate; keep
  this branch to facts derivation can prove.
- Added a patch changeset for the public package metadata.

### 2026-05-30 09:00 EDT - TRL-861 sidecar review fixes

- Laplace reviewed the adapter catalog substrate and scored it 3/5 with one
  P1 and three P2 findings.
- Fixed the P1 by reporting `invalid-placement` for `placements: []` instead
  of silently omitting a declared adapter target from an otherwise clean
  catalog.
- Tightened optional `supportImport` and `testingImport` validation so they
  must point at owner package subpaths, not the owner package root.
- Fixed `packages/adapter-kit/tsconfig.tests.json` so editor/test type
  coverage includes `src/__tests__/catalog.test.ts`.
- Updated the adapter ADR draft `updated` frontmatter date for the TRL-861
  metadata changes.

### 2026-05-30 09:58 EDT - TRL-862 HTTP owner conformance slice

- Started `trl-862-add-http-adapter-authoring-support-and-conformance-factory`
  above TRL-861.
- Added `@ontrails/http/testing` with owner-owned HTTP adapter conformance
  cases plus `runConformance()`.
- Kept HTTP adapter support out of scope for now: current adapters can conform
  through the public topo/options surface, so an `adapter-support` subpath would
  be invented surface area.
- Updated `@ontrails/http` package metadata so the `http` adapter target points
  at the now-real `@ontrails/http/testing` import.
- Validated `@ontrails/http/fetch`, `@ontrails/http/bun`, and `@ontrails/hono`
  through the same owner conformance cases.
- Updated the HTTP README and README snippet harness so the public testing
  subpath example typechecks.

### 2026-05-30 09:20 EDT - TRL-863 shared adapter check engine

- Started `trl-863-build-shared-adapter-check-engine` above TRL-862.
- Added `checkAdapters()` to internal `@ontrails/adapter-kit` as the shared
  predicate engine for future Warden and local `adapter.check` projections.
- Kept adapter metadata minimal: extracted adapter packages author only
  `trails.adapter.target`; the engine derives placement from workspace path,
  export-map facts from `package.json`, dependency direction from manifests,
  and conformance coverage from owner `testingImport` imports in test files.
- Added structured diagnostics for missing/invalid adapter metadata, unknown
  targets, unsupported placements, bad package export maps, dependency-boundary
  violations, missing owner conformance facts, missing adapter conformance
  imports, and runtime imports/dependencies on `@ontrails/adapter-kit`.
- Read-only live repo check currently reports the expected pre-dogfood debt:
  `@ontrails/commander`, `@ontrails/drizzle`, `@ontrails/hono`, and
  `@ontrails/vite` are extracted adapter packages without
  `trails.adapter.target` metadata. TRL-864 must not blindly turn this on as a
  hard CI gate before TRL-865 dogfoods the shape.

### 2026-05-30 09:34 EDT - TRL-864 adapter check projections

- Added Warden's opt-in `--adapter-check` projection over the shared adapter
  engine.
- Added local `adapter.check`, projecting as `trails adapter check`, with a
  focused human report and structured output.
- Kept adapter diagnostics as Warden warnings by default, so the pre-dogfood
  first-party adapter debt is visible without breaking normal Warden CI before
  TRL-865 handles the first real adapter.
- Made `@ontrails/adapter-kit` publishable but still internal. This diverged
  from the earliest "private/unpublished" note because public `@ontrails/warden`
  and `@ontrails/trails` cannot ship a dependency on an unpublished workspace
  package. The doctrine now says "internal/not author-facing," not "private."
- Found a lower-stack Warden defect in TRL-862: the HTTP conformance fixture
  used `Result.err(new Error(...))`. Fixed it on TRL-862 with
  `InternalError`, then restacked TRL-863 and TRL-864 upward.

### 2026-05-30 09:40 EDT - TRL-865 Hono dogfood

- Started
  `trl-865-dogfood-adapter-authoring-path-on-a-first-party-http-adapter` above
  TRL-864 and marked TRL-865 In Progress.
- Chose `@ontrails/hono` as the dogfood target. This is stronger than Bun/Fetch
  for the current branch because the shared checker currently validates
  extracted workspace adapters; Hono is first-party, HTTP-owned, extracted, and
  already validates through `@ontrails/http/testing`.
- Added `trails.adapter.target: "http"` to `adapters/hono/package.json`.
- Added a live repo dogfood regression proving `checkAdapters()` sees Hono as
  an extracted HTTP adapter subject with the owner conformance test import.
- `trails adapter check --root-dir .` now reports one adapter subject and the
  expected remaining metadata debt for Commander, Drizzle, and Vite.

### 2026-05-30 13:45 EDT - TRL-876 review fix on TRL-863

- Codex review and a focused subagent sniff found that the TRL-863 adapter
  check engine accepted raw source text matches for conformance imports, so a
  comment or string literal could suppress `missing-conformance`.
- Created TRL-876 under TRL-863 to track the review bug.
- Fixed the owning branch by replacing the raw regex with a small import
  scanner that ignores comments, strings, and type-only imports while preserving
  real static and dynamic import coverage.
- Added regressions for line-comment, block-comment, string-literal, and
  type-only false positives, plus a dynamic import positive case.

### 2026-05-31 00:00 EDT - TRL-864 review fixes

- Follow-up review threads found that Warden's `advisory` tier accidentally
  enabled adapter checks without `--adapter-check`, and the Trails
  `adapter.check` output bridge did not honor the global `--jsonl` shorthand.
- Kept adapter checks opt-in for Warden by requiring `adapterCheck` explicitly.
- Treated `jsonl` like `json` and `--output jsonl` so the generic structured
  output path, not the human adapter report bridge, owns line-delimited output.
- Updated Warden and Trails adapter-check fixtures to create the source file
  their package export maps claim exists after the stricter export-target check.

## Verification Ledger

| Command | Context | Result | Notes |
| --- | --- | --- | --- |
| `git status --short --branch` | Primary checkout setup | pass | Clean on `main`. |
| `gt ls` | Primary checkout setup | pass | Graphite only saw `main` before lane creation. |
| `git ls-remote origin refs/heads/main` | Primary checkout setup | pass | Remote main matched local `HEAD`. |
| `gh pr list --state open --json ...` | Primary checkout setup | pass | No open PRs returned. |
| `./scripts/bootstrap.sh codex` | New worktree | pass | Dependencies installed locally; linked worktree diagnostics printed. |
| `git status --short --branch` | New worktree after bootstrap | pass | Clean on `lewis/v1-convergence-lane`. |
| `bun scripts/adr.ts check` | TRL-834 ADR draft | pass | 0 errors, 0 warnings. |
| `bunx markdownlint-cli2 docs/adr/drafts/20260530-fixes-are-warden-diagnostic-metadata.md .agents/plans/2026-05-30-v1-convergence-loop/*.md` | TRL-834 ADR + packet | pass | Initial bare-URL findings in `REFS.md` fixed; rerun clean. |
| `git diff --check` | TRL-834 ADR + packet | pass | No whitespace findings. |
| `bun test packages/warden/src/__tests__/trails.test.ts packages/warden/src/__tests__/no-legacy-layer-imports.test.ts` | TRL-866 Warden trail projection | pass | 175 tests passed. |
| `bun test packages/warden/src/__tests__/trails.test.ts packages/warden/src/__tests__/no-legacy-layer-imports.test.ts packages/warden/src/__tests__/formatters.test.ts apps/trails/src/__tests__/warden.test.ts` | TRL-866 sidecar review guardrails | pass | 216 tests passed. |
| `bun run --cwd packages/warden typecheck` | TRL-866 Warden package | pass | `tsc --noEmit` clean. |
| `bun run --cwd apps/trails typecheck` | TRL-866 Trails app wrapper | pass | `tsc --noEmit` clean. |
| `bun run format:check && bun run --cwd packages/warden lint` | TRL-866 formatting and Warden lint | pass | First run caught sorted-key fixture ordering; fixed and reran clean. |
| `bunx markdownlint-cli2 .changeset/trl-866-warden-trail-fix-metadata.md .agents/plans/2026-05-30-v1-convergence-loop/RETRO.md && git diff --check` | TRL-866 docs/hygiene | pass | Markdown and whitespace clean. |
| `rg -n "runConformance" docs/adr/drafts/20260528-adapter-authoring-as-a-paved-path.md` | TRL-853 snippet truth | pass | Confirmed the conformance snippet now imports and calls `runConformance`. |
| `bun scripts/adr.ts check` | TRL-853 adapter ADR snippet | pass | 0 errors, 0 warnings. |
| `bun test packages/adapter-kit/src/__tests__/catalog.test.ts` | TRL-861 adapter catalog | pass | 6 tests passed. |
| `bun run --cwd packages/adapter-kit typecheck` | TRL-861 adapter catalog | pass | `tsc --noEmit` clean. |
| `bun run --cwd packages/adapter-kit lint` | TRL-861 adapter catalog | pass | Oxlint clean. |
| `bun run --cwd packages/adapter-kit build` | TRL-861 adapter catalog | pass | `tsc -b` clean. |
| `bun run typecheck` | TRL-861 workspace package integration | pass | 24 package typechecks passed. |
| `bun run lint` | TRL-861 workspace package integration | pass | 25 lint tasks passed, including Oxlint plugin build. |
| `bun install --frozen-lockfile` | TRL-861 workspace metadata | pass | Lockfile matched new workspace package shape. |
| `bun scripts/adr.ts check` | TRL-861 adapter ADR metadata note | pass | 0 errors, 0 warnings. |
| `bun run oxlint-plugin:build` | TRL-861 formatter setup | pass | Private Oxlint plugin built before Ultracite. |
| `bunx ultracite check packages/adapter-kit/src/catalog.ts packages/adapter-kit/src/__tests__/catalog.test.ts packages/adapter-kit/src/index.ts packages/adapter-kit/package.json packages/adapter-kit/tsconfig.json packages/adapter-kit/tsconfig.tests.json packages/http/package.json packages/store/package.json docs/adr/drafts/20260528-adapter-authoring-as-a-paved-path.md .changeset/trl-861-adapter-target-catalog.md` | TRL-861 formatting | pass | Matched files clean. |
| `bunx markdownlint-cli2 docs/adr/drafts/20260528-adapter-authoring-as-a-paved-path.md .changeset/trl-861-adapter-target-catalog.md .agents/plans/2026-05-30-v1-convergence-loop/RETRO.md` | TRL-861 docs/hygiene | pass | 0 markdown errors. |
| `git diff --check` | TRL-861 whitespace | pass | No whitespace findings. |
| `bun test packages/adapter-kit/src/__tests__/catalog.test.ts` | TRL-861 sidecar review fixes | pass | 8 tests passed, including empty placements and owner-root import regressions. |
| `bunx tsc -p packages/adapter-kit/tsconfig.tests.json --showConfig \| rg -n "catalog\\.test\\.ts\|types\|exclude\|rootDir"` | TRL-861 sidecar review fixes | pass | Confirmed `catalog.test.ts` appears in the resolved config. |
| `bunx tsc -p packages/adapter-kit/tsconfig.tests.json --noEmit` | TRL-861 sidecar review fixes | pass | Test tsconfig typecheck clean. |
| `bun run --cwd packages/adapter-kit typecheck` | TRL-861 sidecar review fixes | pass | Package typecheck clean. |
| `bun run --cwd packages/adapter-kit lint` | TRL-861 sidecar review fixes | pass | Oxlint clean. |
| `bun scripts/adr.ts check` | TRL-861 sidecar review fixes | pass | 0 errors, 0 warnings. |
| `bunx ultracite check packages/adapter-kit/src/catalog.ts packages/adapter-kit/src/__tests__/catalog.test.ts packages/adapter-kit/tsconfig.tests.json docs/adr/drafts/20260528-adapter-authoring-as-a-paved-path.md` | TRL-861 sidecar review fixes | pass | First run found formatting in the new test; `ultracite fix` applied it and rerun passed. |
| `bun test packages/http/src/__tests__/testing.test.ts` | TRL-862 HTTP conformance factory | pass | 14 tests passed, including public subpath typecheck and fetch/bun conformance. |
| `bun test packages/http/src/__tests__/fetch.test.ts packages/http/src/__tests__/bun.test.ts packages/http/src/__tests__/testing.test.ts` | TRL-862 HTTP regression set | pass | 35 tests passed. |
| `bun test adapters/hono/src/__tests__/surface.test.ts adapters/hono/src/__tests__/conformance.test.ts` | TRL-862 Hono conformance dogfood | pass | 28 tests passed. |
| `bun run --cwd packages/http typecheck` | TRL-862 HTTP package | pass | `tsc --noEmit` clean. |
| `bun run --cwd packages/http lint` | TRL-862 HTTP package | pass | Oxlint clean. |
| `bun run --cwd packages/http build` | TRL-862 HTTP package | pass | `tsc -b` clean. |
| `bun run --cwd adapters/hono typecheck` | TRL-862 Hono conformance dogfood | pass | `tsc --noEmit` clean. |
| `bun run --cwd adapters/hono lint` | TRL-862 Hono conformance dogfood | pass | Oxlint clean. |
| `bun run docs:snippets` | TRL-862 HTTP README snippet | pass | 21 README files typechecked; HTTP README now has 6 snippets. |
| `bun run docs:api-examples` | TRL-862 public API examples | pass | Existing public API example inventory passed. |
| `bunx ultracite check packages/http/src/testing.ts packages/http/src/__tests__/testing.test.ts packages/http/package.json packages/http/README.md scripts/check-readme-snippets.ts .changeset/trl-862-http-adapter-testing.md` | TRL-862 formatting | pass | Matched files clean after formatter fix. |
| `bunx markdownlint-cli2 packages/http/README.md .changeset/trl-862-http-adapter-testing.md .agents/plans/2026-05-30-v1-convergence-loop/RETRO.md` | TRL-862 docs/hygiene | pass | 0 markdown errors. |
| `git diff --check` | TRL-862 whitespace | pass | No whitespace findings. |
| `bun run docs:wrap-check` | TRL-862 docs/hardwrap | pass | Lower-stack ADR hardwraps were reflowed on their owning branches; 159 scanned files clean. |
| `gh pr checks 643` | Top-of-stack hosted CI | fail | `Test` timed out in the TRL-862 HTTP public testing subpath smoke test on the CI runner. |
| `gh run view 26689927179 --job 78664434517 --log-failed` | Hosted CI failure investigation | pass | Confirmed the timeout was `@ontrails/http/testing public subpath > typechecks the public testing subpath`. |
| `bun test packages/http/src/__tests__/testing.test.ts` | TRL-862 hosted CI fix | pass | 14 tests passed after switching the public subpath smoke test away from `bunx tsc` and giving the subprocess an explicit timeout. |
| `bun run --cwd packages/http lint` | TRL-862 hosted CI fix | pass | Oxlint clean. |
| `bun run --cwd packages/http test` | TRL-862 hosted CI fix | pass | 159 HTTP package tests passed. |
| `bun run --cwd packages/http typecheck` | TRL-862 hosted CI fix | pass | `tsc --noEmit` clean. |
| `bun test packages/http/src/__tests__/testing.test.ts` | TRL-862 review-thread follow-up | pass | 14 HTTP conformance tests passed after switching the redaction case to a native `Error`. |
| `bun run --cwd packages/http lint` | TRL-862 review-thread follow-up | pass | Oxlint clean. |
| `bun run lint:ast-grep` | TRL-862 pre-push follow-up | pass | Native redaction error kept behind a helper so the repo-wide `Result.err(new Error(...))` structural rule stays clean. |
| `bun run --cwd packages/http typecheck && bun run --cwd packages/http build` | TRL-862 pre-push follow-up | pass | HTTP typecheck and build clean after the helper extraction. |
| `bunx ultracite check packages/http/src/__tests__/testing.test.ts` | TRL-862 hosted CI fix | pass | Formatting and lint clean for the touched test file. |
| `bun test packages/adapter-kit/src/__tests__/check.test.ts packages/adapter-kit/src/__tests__/catalog.test.ts` | TRL-863 adapter check engine | pass | 17 tests passed. |
| `bun run --cwd packages/adapter-kit typecheck` | TRL-863 adapter check engine | pass | `tsc --noEmit` clean. |
| `bun run --cwd packages/adapter-kit lint` | TRL-863 adapter check engine | pass | Oxlint clean. |
| `bunx tsc -p packages/adapter-kit/tsconfig.tests.json --noEmit` | TRL-863 adapter check engine | pass | Test tsconfig typecheck clean. |
| `bun run --cwd packages/adapter-kit build` | TRL-863 adapter check engine | pass | `tsc -b` clean. |
| `bunx ultracite check packages/adapter-kit/src/check.ts packages/adapter-kit/src/__tests__/check.test.ts packages/adapter-kit/src/index.ts` | TRL-863 formatting | pass | Formatter initially found two files; `ultracite fix` applied formatting and rerun passed. |
| `bun -e "import { checkAdapters } from './packages/adapter-kit/src/check.ts'; ..."` | TRL-863 live repo smoke | pass | Reported 2 targets, 0 subjects, and 4 expected `missing-adapter-metadata` diagnostics for current extracted adapters. |
| `bun run typecheck` | TRL-863 workspace integration | pass | 24 package typechecks passed. |
| `bun run lint` | TRL-863 workspace integration | pass | 25 lint tasks passed. |
| `bun test packages/adapter-kit/src/__tests__/check.test.ts` | TRL-876 review fix | pass | 14 focused adapter-check tests passed, including comment/string/type-only import regressions. |
| `bun run --cwd packages/adapter-kit test` | TRL-876 review fix | pass | 22 adapter-kit tests passed. |
| `bun run --cwd packages/adapter-kit lint` | TRL-876 review fix | pass | Oxlint clean. |
| `bun run --cwd packages/adapter-kit typecheck` | TRL-876 review fix | pass | `tsc --noEmit` clean. |
| `git diff --check` | TRL-876 review fix | pass | No whitespace findings. |
| `bun test packages/adapter-kit/src/__tests__/check.test.ts` | TRL-876 inline type-import follow-up | pass | 16 focused adapter-check tests passed after adding the inline `import { type ... }` regression and mixed value/type positive case. |
| `bun run --cwd packages/adapter-kit lint` | TRL-876 inline type-import follow-up | pass | First run caught helper ordering via `no-use-before-define`; helper moved and rerun passed. |
| `bun run --cwd packages/adapter-kit typecheck` | TRL-876 inline type-import follow-up | pass | `tsc --noEmit` clean. |
| `git diff --check` | TRL-876 inline type-import follow-up | pass | No whitespace findings. |
| `bun test packages/adapter-kit/src/__tests__/check.test.ts` | TRL-876 review-thread follow-up | pass | 18 focused adapter-check tests passed, including missing export targets and TS type-query import regressions. |
| `bun run --cwd packages/adapter-kit lint` | TRL-876 review-thread follow-up | pass | Oxlint clean. |
| `bun run --cwd packages/adapter-kit typecheck` | TRL-876 review-thread follow-up | pass | `tsc --noEmit` clean. |
| `bun run format:check` | TRL-876 review-thread follow-up | pass | Full Ultracite check clean after formatting the touched check engine. |
| `git diff --check` | TRL-876 review-thread follow-up | pass | No whitespace findings. |
| `bun test packages/adapter-kit/src/__tests__/check.test.ts` | TRL-876 nested type-query follow-up | pass | 18 focused adapter-check tests passed after adding a nested `Array<import(...)>` regression. |
| `bun run --cwd packages/adapter-kit lint` | TRL-876 nested type-query follow-up | pass | Oxlint clean. |
| `bun run --cwd packages/adapter-kit typecheck` | TRL-876 nested type-query follow-up | pass | `tsc --noEmit` clean. |
| `bunx markdownlint-cli2 .changeset/trl-863-adapter-check-engine.md` | TRL-863 changeset follow-up | pass | Branch-local adapter-kit changeset markdown clean. |
| `bun test packages/warden/src/__tests__/adapter-check.test.ts packages/warden/src/__tests__/cli.test.ts apps/trails/src/__tests__/adapter-check.test.ts` | TRL-864 review-thread follow-up | pass | 54 tests passed, covering explicit adapter-check opt-in, `--jsonl`, and repaired export-map fixtures. |
| `bun run --cwd packages/warden typecheck && bun run --cwd apps/trails typecheck` | TRL-864 review-thread follow-up | pass | Warden and Trails typechecks clean. |
| `bun run --cwd packages/warden lint && bun run --cwd apps/trails lint` | TRL-864 review-thread follow-up | pass | Oxlint clean for both packages. |
| `bun run format:check` | TRL-864 review-thread follow-up | pass | Full Ultracite check clean after formatting the touched adapter-check surface. |
| `git diff --check` | TRL-864 review-thread follow-up | pass | No whitespace findings. |
| `bun test packages/warden/src/__tests__/cli.test.ts` | TRL-864 pre-push fixture follow-up | pass | 47 Warden CLI tests passed after making the adapter-check opt-in fixture explicitly opt in. |
| `bun test apps/trails/src/__tests__/adapter-check.test.ts` | TRL-864 env output follow-up | pass | 6 Trails adapter-check tests passed, including `TRAILS_JSON=1` and `TRAILS_JSONL=1` structured-output handling. |
| `bun run --cwd apps/trails lint` | TRL-864 env output follow-up | pass | Oxlint clean after making env restore explicit. |
| `bun run --cwd apps/trails typecheck` | TRL-864 env output follow-up | pass | `tsc --noEmit` clean. |
| `bun test packages/warden/src/__tests__/adapter-check.test.ts packages/warden/src/__tests__/command.test.ts packages/warden/src/__tests__/public-api.test.ts` | TRL-864 Warden adapter projection | pass | 20 tests passed. |
| `bun test apps/trails/src/__tests__/adapter-check.test.ts apps/trails/src/__tests__/warden.test.ts` | TRL-864 local adapter check projection | pass | 22 tests passed. |
| `bun test packages/http/src/__tests__/testing.test.ts adapters/hono/src/__tests__/conformance.test.ts packages/adapter-kit/src/__tests__/check.test.ts packages/adapter-kit/src/__tests__/catalog.test.ts packages/warden/src/__tests__/adapter-check.test.ts apps/trails/src/__tests__/adapter-check.test.ts` | TRL-864 restacked focused regression set | pass | 43 tests passed after fixing the lower TRL-862 Warden error. |
| `bun packages/warden/bin/warden.ts --adapter-check --depth source --lock skip --format json` | TRL-864 Warden live smoke | pass | Before Hono dogfood, reported 0 errors and 4 adapter-check warnings. |
| `bun run typecheck` | TRL-864 workspace integration | pass | 24 package typechecks passed. |
| `bun run lint` | TRL-864 workspace integration | pass | 25 lint tasks passed. |
| `bun run format:check` | TRL-864 formatting | pass | Full Ultracite check clean. |
| `bun run docs:wrap-check` | TRL-864 docs/hardwrap | pass | 159 scanned files clean. |
| `bun run changeset:check` | TRL-864 release hygiene | pass | Changeset gate passed for adapter-kit, http, store, trails, and warden. |
| `bun run publish:check` | TRL-864 publish hygiene | pass | All public package pack checks passed, including newly publishable `@ontrails/adapter-kit`. |
| `bun test packages/adapter-kit/src/__tests__/dogfood.test.ts adapters/hono/src/__tests__/conformance.test.ts` | TRL-865 Hono dogfood | pass | 7 tests passed; dogfood regression proves Hono target metadata and owner conformance path. |
| `bun run --cwd packages/adapter-kit typecheck && bun run --cwd adapters/hono typecheck` | TRL-865 package typecheck | pass | Adapter-kit and Hono typechecks clean. |
| `bun run --cwd packages/adapter-kit lint && bun run --cwd adapters/hono lint` | TRL-865 package lint | pass | Oxlint clean for both packages. |
| `bun apps/trails/bin/trails.ts adapter check --root-dir .` | TRL-865 local dogfood smoke | pass | Expected non-zero due remaining adapters; report now shows 1 adapter subject and 3 remaining metadata diagnostics. |
| `bun packages/warden/bin/warden.ts --adapter-check --depth source --lock skip --format json` | TRL-865 Warden dogfood smoke | pass | 0 errors, 3 adapter-check warnings; Warden passes because adapter findings remain warnings by default. |
| `bun run typecheck` | TRL-865 stack-tip final gate | pass | 24 package typechecks passed. |
| `bun run lint` | TRL-865 stack-tip final gate | pass | 25 lint tasks passed. |
| `bun run format:check` | TRL-865 stack-tip final gate | pass | Full Ultracite check clean. |
| `bun run docs:wrap-check` | TRL-865 stack-tip final gate | pass | 159 scanned files clean. |
| `bun run changeset:check` | TRL-865 stack-tip final gate | pass | Changeset gate passed for adapter-kit, Hono, HTTP, Store, Trails, and Warden. |
| `bun run publish:check` | TRL-865 stack-tip final gate | pass | All public package pack checks passed. |

## Remote PR Ledger

| PR | Branch | State | CI | Notes |
| --- | --- | --- | --- | --- |
| [#634](https://github.com/outfitter-dev/trails/pull/634) | `trl-834-draft-warden-fix-metadata-adr` | ready | green | Bottom branch; draft Warden fix metadata ADR. |
| [#635](https://github.com/outfitter-dev/trails/pull/635) | `trl-866-project-warden-diagnostic-fix-metadata-through-rule-trail` | ready | green | Preserves fix metadata through Warden rule trail outputs. |
| [#636](https://github.com/outfitter-dev/trails/pull/636) | `trl-853-draft-adr-conformance-snippet-calls-runconformance-without` | ready | green | Fixes adapter ADR conformance snippet import. |
| [#637](https://github.com/outfitter-dev/trails/pull/637) | `trl-861-define-adapter-target-metadata-and-catalog-derivation` | ready | green | Adds adapter target catalog derivation and HTTP/Store metadata. |
| [#638](https://github.com/outfitter-dev/trails/pull/638) | `trl-862-add-http-adapter-authoring-support-and-conformance-factory` | ready | green | Adds HTTP owner conformance factory and testing subpath. |
| [#639](https://github.com/outfitter-dev/trails/pull/639) | `trl-863-build-shared-adapter-check-engine` | ready | green | Adds shared adapter check engine. |
| [#640](https://github.com/outfitter-dev/trails/pull/640) | `trl-864-expose-adapter-checks-through-warden-and-trails-adapter` | ready | green | Exposes adapter checks through Warden and `trails adapter check`. |
| [#641](https://github.com/outfitter-dev/trails/pull/641) | `trl-865-dogfood-adapter-authoring-path-on-a-first-party-http-adapter` | ready | green | Dogfoods Hono as first extracted HTTP adapter subject. |

Submitted with `gt submit --stack --draft --no-edit --no-interactive`, then
marked ready after every PR reported green CI. Before submit, the bottom real
branch had to be reparented from the zero-diff worker lane onto `main`.
Graphite refused to submit dependents of the empty lane branch, which confirms
the worktree-farm base branch is useful for local farming but should not sit
under a submitted stack.

## Review Findings

Laplace reviewed TRL-861 and found one P1 and three P2 issues. All four were
fixed on `trl-861-define-adapter-target-metadata-and-catalog-derivation` before
continuing upward.

Follow-up review on #638 found the public redaction conformance case used
`InternalError`, which proved known TrailsError projection rather than generic
error redaction. The conformance fixture now returns a native `Error` while
retaining the same public `InternalError` response expectation.

Pre-push then caught that the literal `Result.err(new Error(...))` shape trips
the repo-wide native-error structural rule. The fixture still returns a native
`Error`, but constructs it through a small helper before passing it to
`Result.err()`, preserving the redaction behavior without violating the
syntax-level guardrail.

Bacon reviewed the TRL-876 / #639 conformance import-detection bug and agreed
the narrow fix should stay on import syntax only, leaving helper-call validation
to the later conformance-metadata/scaffold branch. The line-comment,
block-comment, string-literal, and type-only false positives were fixed on
`trl-863-build-shared-adapter-check-engine`.

Goodall reviewed the resubmitted #639/#643 fix and found one remaining P2:
inline named type-only imports such as `import { type Foo } from ...` still
counted as fallback conformance evidence. The scanner now rejects import
clauses with only inline type bindings while preserving mixed value/type imports.

Follow-up review threads on #639 found that package exports were accepted when
their targets did not exist, TS type-query `import("...")` references counted as
runtime conformance imports, and `skipLineComment()` stopped on the newline
itself. The shared check engine now requires exported targets to exist, ignores
type-query imports, and advances line-comment skips past the newline.

Another #639 follow-up found nested TS type-query imports such as
`Array<import("@ontrails/http/testing").Adapter>` still counted as conformance
evidence, and that the exported adapter-kit check API needed a branch-local
changeset. The scanner now treats annotated generic type positions as erased
imports, and TRL-863 carries its own `@ontrails/adapter-kit` patch changeset.

Follow-up review threads on #640 found that advisory Warden runs were no longer
pure advisory-rule runs because adapter checks were implicitly attached, and that
`trails adapter check --jsonl` still printed the human report. Warden now runs
adapter checks only behind explicit adapter opt-in, while the Trails CLI bridge
defers both `--jsonl` and `--output jsonl` to the structured output path.

Pre-push later caught that the Warden opt-in regression fixture no longer
produced adapter-check diagnostics after unannotated adapters became out of
scope. The fixture now declares `trails.adapter` explicitly so the test proves
opt-in execution instead of relying on old unannotated-adapter behavior.

A later #640 review found that `trails adapter check` skipped human output for
structured flags but ignored the repo-wide topo env selectors. The adapter-check
result bridge now delegates to `deriveOutputMode()`, so `TRAILS_JSON=1` and
`TRAILS_JSONL=1` behave like the corresponding flags.

Final stack-tip self-review checked the cumulative diff, stale private-package
wording, `Result.err(new Error(...))` reintroductions, local adapter smoke
behavior, Warden adapter-check behavior, changeset hygiene, publish packing, and
full typecheck/lint/format gates. No new P0/P1/P2 findings were found. The
remaining review risk is scope, not correctness: this stack stops after the
first extracted HTTP adapter dogfood and intentionally leaves `create.adapter`
scaffolding plus Commander/Drizzle/Vite metadata for the next stack.

Remote review status after marking ready: GitHub CI passed on all eight PRs.
Greptile posted only its account/billing message ("free trial has ended") on
each PR rather than a code review. Treat that as an unavailable review signal,
not as a clean Greptile review and not as a code finding.

## Open Risks

- TRL-850 may already be partially stale if the adapter ADR merge refreshed the
  decision map. Verify before cutting its branch.
- TRL-826 and TRL-829 are conditional. Keep them only if this stack produces
  enough implementation evidence.
- Adapter tooling package name is now implemented as publishable-but-internal
  `@ontrails/adapter-kit`; keep watching whether the name communicates
  tooling rather than central authority as later branches consume it.
