# Local Review Round 4: Final Clean Sweep

Date: 2026-05-19
Stack tip reviewed: `trl-116-run-examples-and-testall-across-live-version-entries`

## Scope

- Follow-up after all P2 owning-branch fixes.
- Current-facing stale command and stale doctrine sweep.
- Marker/runtime regression spot checks.
- Guide/testAll live-entry behavior.
- Changeset coverage.

## Commands / Evidence

- `rg -n "trails topo compile|trails topo verify|topo compile/verify|trails topo diff" docs plugin apps packages .agents/plans/2026-05-19-trail-versioning-m1-m2 --glob '!reports/*.md'`
- `rg -n "trails version|trails sunset|trails mark|trails fork|trails archive|version\\.markers|adapt:|--preserve|kind: 'forced'|forced markers|fork-without-preserved-impl" docs plugin apps packages .agents/plans/2026-05-19-trail-versioning-m1-m2 --glob '!docs/adr/drafts/**' --glob '!reports/*.md'`
- `rg -n "crossInput|deriveCurrentTrailVersionMarkerContent|resolveTopoGraphVersionReference|countTrailExamples|checkVersionExamples|Trail version .*crosses|Trail version .*resource" packages apps`
- `git diff --name-only main...HEAD -- .changeset`
- `bun test packages/core/src/__tests__/version-marker.test.ts packages/core/src/__tests__/version-execution.test.ts packages/core/src/__tests__/validate-topo.test.ts packages/topographer/src/__tests__/derive.test.ts apps/trails/src/__tests__/guide.test.ts packages/testing/src/__tests__/examples.test.ts packages/testing/src/__tests__/all.test.ts`
- `bun run --cwd packages/core typecheck`
- `bun run --cwd packages/topographer typecheck`
- `bun run --cwd apps/trails typecheck`

## Findings

No P0/P1/P2 findings remain.

## Accepted Residuals

- P3: ADR-0048 links ADR-0008 to the ADR index instead of the ADR-0008 file.
- P3: residual non-command prose still uses "topo compile" or "compile, verify" wording in a few current docs, while command snippets and CLI surfaces are correct.
- Historical ADR/draft/packet/report text still contains retired command and versioning spellings as history, anti-patterns, or execution instructions.
- `docs/contributing/language-styleguide.md` intentionally lists retired versioning shapes in the "avoid" section.

## Result

Latest local review pass is P3-only. Local review can stop once the full stack-tip verification gate remains clean and RETRO is updated.
