# Local Review Round 3: V1 Audit Reports And Follow-Up Mapping

Date: 2026-05-12
Reviewer lane: V1 audit reports and Linear follow-up mapping
Stack tip observed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`

## Result

Clean for P0/P1/P2 in this lane. The M3, M5, and M6 audit reports are evidence-backed against the local stack tip, the round 1 and round 2 P2s are fixed, and the RETRO no longer contradicts the canonical reports.

Residuals are P3-only:

- I did not re-query Linear live in this round. Local report/RETRO issue IDs and purposes are internally consistent, and round 2 records live Linear readback for TRL-704 through TRL-714, but current tracker parentage was not refreshed here.
- M5 still records the relative-link scan as an ad hoc placeholder command, but the broken-link table is concrete and TRL-709 owns the durable Markdown-aware checker.

## Findings

| Severity | Owning branch | Finding | Recommended action |
| --- | --- | --- | --- |
| Clean | `trl-634-audit-cross-surface-parity-coverage-gaps` | M3 correctly distinguishes 34 public surface-eligible trails, two internal trails, one public activation consumer, and WebSocket as planned/not shipped. The two M3 `bun --eval` probes are runnable at the stack tip. | No P0/P1/P2 action. Keep TRL-704, TRL-705, and TRL-706 as focused follow-ups. |
| Clean | `trl-636-audit-docs-and-examples-for-v1-readiness` | M5 uses concrete evidence for the generated-project install blocker, narrow README snippet coverage, relative-link gaps, and sparse public API `@example` coverage. Follow-ups TRL-707 through TRL-710 are focused. | No P0/P1/P2 action. TRL-709 should replace the ad hoc link scan with a durable code-fence-aware checker. |
| Clean | `trl-637-audit-release-process-and-beta-to-10-cutover-requirements` | M6 uses the repo's Bun release language: `bun run publish:check` and `bun run publish:packages` are the release commands, while `npm view` is only a read-only registry probe. Follow-ups TRL-711 through TRL-714 are focused cutover gaps. | No P0/P1/P2 action. |
| Clean | V1 audit tail | Round 1's M3 classification P2 and round 2's stale RETRO P2 are fixed in the canonical report and RETRO. | No further correction needed. |
| P3 / unknown | V1 audit tail / tracker mapping | Live Linear parentage was not re-read in this round. Local artifacts consistently map M3 to TRL-704/705/706, M5 to TRL-707/708/709/710, and M6 to TRL-711/712/713/714. | If merge gating needs live tracker proof, run a read-only Linear readback for TRL-704 through TRL-714 before final handoff. |

## Evidence

### Scope And Expected Artifacts

- `PLAN.md:38-40` says TRL-634/636/637 are audit/report branches, their reports live under `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/`, and TRL-637 uses Bun publish flow with `bun run publish:check` and `bun run publish:packages`, "not npm publish or changeset publish."
- `PLAN.md:433-445` requires M3 to produce `reports/m3-parity-audit.md`, build a CLI/MCP/HTTP/WebSocket/internal matrix, and file focused follow-ups rather than implementing the parity harness.
- `PLAN.md:455-468` requires M5 to produce `reports/m5-docs-audit.md`, include fresh-checkout failure output if anything breaks, audit `@example` coverage and snippet verification, and file focused follow-ups.
- `PLAN.md:479-491` requires M6 to produce `reports/m6-release-process-audit.md`, use Bun publish language, inventory `.changeset/pre.json`, release scripts, CI gates, and beta-to-stable order, and not run the release.

### M3 Parity Report

- `m3-parity-audit.md:11-19` reports `@ontrails/trails` as 29 stored / 27 public surface-eligible projected trails, `trails-demo` as 8 stored / 7 public surface-eligible projected trails, and says non-projected trails are "either intentionally internal or activation-source consumers."
- `m3-parity-audit.md:21-23` lists the three non-projected trails: `create.scaffold`, `add.verify`, and `entity.notify-updated`.
- `m3-parity-audit.md:100-103` defines `internal` separately from `activation consumer`.
- `m3-parity-audit.md:112`, `m3-parity-audit.md:116`, and `m3-parity-audit.md:148` classify `add.verify` and `create.scaffold` as internal, and `entity.notify-updated` as a public activation consumer.
- `m3-parity-audit.md:161-166` says internal trails remain absent unless included, public activation consumers are excluded because `filterSurfaceTrails()` excludes activation sources, and WebSocket has no public surface package/API.
- Source supports the filter: `packages/core/src/surface-filter.ts:154-155` returns false when `trail.activationSources.length > 0`; `packages/cli/src/build.ts:1186-1194`, `packages/mcp/src/build.ts:912-921`, and `packages/http/src/build.ts:773-782` all derive from `filterSurfaceTrails(...)`.
- Source supports the harness gap: `packages/testing/src/all.ts:164-177` validates CLI and MCP only in `testAllEstablished()`, and `packages/testing/src/index.ts:33-35` exports CLI and MCP harnesses with no HTTP harness export.
- Source supports WebSocket posture: `docs/index.md:28-31` lists CLI, MCP, and HTTP as shipped today and WebSocket as planned; `docs/api-reference.md:149` says WebSocket has no public package or API yet.

M3 projection probe output from this round:

```json
{
  "name": "@ontrails/trails",
  "storedTrails": 29,
  "cli": 27,
  "mcp": 27,
  "http": 27,
  "nonProjected": [
    { "activationSources": 0, "id": "create.scaffold", "on": 0, "visibility": "internal" },
    { "activationSources": 0, "id": "add.verify", "on": 0, "visibility": "internal" }
  ]
}
{
  "name": "trails-demo",
  "storedTrails": 8,
  "cli": 7,
  "mcp": 7,
  "http": 7,
  "nonProjected": [
    { "activationSources": 1, "id": "entity.notify-updated", "on": 1, "visibility": "public" }
  ]
}
```

The workspace-index probe in `m3-parity-audit.md:36` also ran successfully. Its output showed `apps` as `["@ontrails/trails","trails-demo"]`, `collisions` as `[]`, `source` as `discovery`, and an `index` object containing 37 trail entries. It warned that no workspace topo lock exists in `.trails`, matching the report's discovery fallback.

### M5 Docs/Examples Report

- `m5-docs-audit.md:136-144` records the fresh generated-project failure: `@ontrails/commander@^1.0.0-beta.15 failed to resolve` after npm returned 404.
- `m5-docs-audit.md:159-162` concludes the fresh-start path cannot pass dependency installation when CLI is included, and maps this to TRL-707.
- `m5-docs-audit.md:169-177` records `bun run docs:snippets` output as `README snippet typecheck passed for: packages/tracing/README.md`; this round reran the command with the same output.
- `m5-docs-audit.md:179-182` concludes the checker is too narrow and maps it to TRL-708.
- `m5-docs-audit.md:194-211` lists concrete broken relative links and the code-fence false positive, then maps the durable checker to TRL-709.
- `m5-docs-audit.md:256-271` lists high-value missing `@example` coverage across CLI, HTTP, MCP, Commander, and Hono entrypoints, then maps the inventory/gate to TRL-710.
- `m5-docs-audit.md:286-293` lists focused follow-ups TRL-707, TRL-708, TRL-709, and TRL-710.

Docs snippet output from this round:

```text
$ bun scripts/check-readme-snippets.ts
README snippet typecheck passed for: packages/tracing/README.md
```

### M6 Release/Cutover Report

- `m6-release-process-audit.md:14-21` says publishing is done with `bun run publish:packages`, not `changeset publish` or `npm publish`, and that `bun run publish:check` packs every non-private workspace.
- `m6-release-process-audit.md:38-56` cites the repo release guidance, `.changeset/pre.json`, and `scripts/publish.ts` for the Bun publish flow, default prerelease tag, pack dry-run, and sequential `bun publish --access public --tag <tag>`.
- `m6-release-process-audit.md:89-91` describes `npm view <package> version --json` as a read-only registry check, not a publish command.
- `AGENTS.md:271-284` says Changesets owns versioning and changelogs, not `changeset publish`, and publishing goes through the Bun script with `bun run publish:check` then `bun run publish:packages`.
- `AGENTS.md:296` says `publish:check` runs `bun pm pack --dry-run` and `publish:packages` uses the dist-tag from `.changeset/pre.json`, falling back to `latest` outside prerelease mode.
- `scripts/publish.ts:4-9` states the script publishes public `@ontrails/*` workspaces using `bun publish`, sorts workspace dependency edges, and blocks unresolved range leakage.
- `scripts/publish.ts:153-170` resolves `beta` from `.changeset/pre.json` in prerelease mode and refuses a silent fallback if the tag is missing.
- `scripts/publish.ts:419-445` runs the pack check; `scripts/publish.ts:448-483` publishes sequentially with `bun publish --access public --tag <tag>` and aborts on the first failure.
- `.changeset/pre.json:2-3` is still `mode: "pre"` with tag `beta`.
- `.changeset/logtape-observe-target.md:2` still references retired `@ontrails/logging`, matching the TRL-713 finding.
- `m6-release-process-audit.md:268-292` maps the stale Changesets failure to TRL-713.
- `m6-release-process-audit.md:294-317` maps the registry readiness gap to TRL-714 while keeping it distinct from local packability.
- `m6-release-process-audit.md:341-348` lists focused release follow-ups TRL-711 through TRL-714.

Release check outputs from this round:

```text
bunx changeset status --verbose
Found changeset logtape-observe-target for package @ontrails/logging which is not in the workspace
```

```text
bun run publish:check
...
✓ All package pack checks passed!
```

```text
npm view @ontrails/commander version --json -> E404
npm view @ontrails/observe version --json -> E404
npm view @ontrails/topographer version --json -> E404
npm view @ontrails/wayfinder version --json -> E404
```

### RETRO And Prior Round Fixes

- Round 1 P2: `local-review-v1-audit-round-1.md:14-18` found that M3 misclassified the demo signal consumer as internal. Current M3 report evidence above shows this is fixed.
- Round 1 P3: `local-review-v1-audit-round-1.md:83-94` found that the M3 projection probe was a placeholder. Current `m3-parity-audit.md:36-79` contains runnable `bun --eval` probes, both rerun successfully here.
- Round 2 P2: `local-review-v1-audit-round-2.md:20-27` found that RETRO still carried the old false "three internal trails" summary. Current `RETRO.md:211-219` now says 34 public surface-eligible trails project on CLI/MCP/HTTP, 2 are intentionally internal, 1 public activation consumer is excluded by activation-source filtering, and WebSocket remains planned/not shipped.
- `RETRO.md:127-137` maps M3 follow-ups to TRL-704/705/706, M5 follow-ups to TRL-707/708/709/710, and M6 follow-ups to TRL-711/712/713/714.
- `RETRO.md:357-387` records the branch-focused checks for TRL-634, TRL-636, and TRL-637.

## Commands Run

Read-only/source inspection:

```bash
rg -n "M4b|V1 audit|local-review-v1|m3-parity|m5-docs|m6-release|2026-05-12-topograph" /Users/mg/.codex/memories/MEMORY.md
nl -ba /Users/mg/.codex/memories/MEMORY.md | sed -n '120,136p'
rg --files .agents/plans/2026-05-12-topograph-query-docs-stack reports docs packages/testing/src scripts .changeset | rg '(^|/)(PLAN|RETRO)\.md$|local-review-v1-audit-round-[12]\.md$|m[356]-.*audit\.md$|docs/(index|api-reference)\.md$|packages/testing/src/all\.ts$|scripts/publish\.ts$|\.changeset/(pre\.json|logtape-observe-target\.md)$'
pwd
git branch --show-current
git status --short
wc -l .agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md .agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-v1-audit-round-1.md .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-v1-audit-round-2.md .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-v1-audit-round-3.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-v1-audit-round-3.md | sed -n '1,220p'
rg -n "report|reports|TRL-63[467]|TRL-70[4-9]|TRL-71[0-4]|M3|M5|M6|WebSocket|surface-eligible|internal|activation|publish:check|publish:packages|changeset publish|npm publish|\.scratch/v1-release-prep|RETRO" .agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md .agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md
rg -n "surface-eligible|internal|activation|WebSocket|websocket|runnable|bun --eval|testAll|HTTP|MCP|CLI|TRL-70[4-6]|Follow-up|Result|Conclusion" .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md
rg -n "docs:snippets|snippet|link|example|TRL-70[7-9]|TRL-710|Follow-up|Result|Conclusion|readiness|gap|evidence|bun run check|format:check|git diff --check" .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md
rg -n "publish:check|publish:packages|bun publish|npm publish|changeset publish|changeset status|npm view|TRL-71[1-4]|Follow-up|Result|Conclusion|cutover|pre\.json|logtape|@ontrails/logging|registry|release" .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-v1-audit-round-1.md | sed -n '1,180p'
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-v1-audit-round-2.md | sed -n '1,220p'
nl -ba docs/index.md | sed -n '20,40p'
nl -ba docs/api-reference.md | sed -n '140,160p'
nl -ba packages/testing/src/all.ts | sed -n '155,185p'
nl -ba packages/testing/src/index.ts | sed -n '25,42p'
nl -ba packages/core/src/surface-filter.ts | sed -n '145,170p'
nl -ba packages/cli/src/build.ts | sed -n '1180,1200p'
nl -ba packages/mcp/src/build.ts | sed -n '906,926p'
nl -ba packages/http/src/build.ts | sed -n '767,787p'
nl -ba scripts/publish.ts | sed -n '1,12p;145,175p;410,490p'
nl -ba .changeset/pre.json
nl -ba .changeset/logtape-observe-target.md
nl -ba AGENTS.md | sed -n '269,301p'
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md | sed -n '36,42p'
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md | sed -n '433,498p'
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md | sed -n '508,524p'
/usr/bin/git status --porcelain=v1 -uall
```

Verification commands:

```bash
bun --eval 'import { buildWorkspaceTrailIndex } from "./packages/topographer/src/index.ts"; const result = await buildWorkspaceTrailIndex({ cwd: process.cwd() }); console.log(JSON.stringify(result, null, 2));'
bun --eval '<M3 surface projection probe from m3-parity-audit.md:42-79>'
bun run docs:snippets
bunx changeset status --verbose
bun run publish:check
npm view @ontrails/commander version --json
npm view @ontrails/observe version --json
npm view @ontrails/topographer version --json
npm view @ontrails/wayfinder version --json
git diff --check
```

One exploratory reduced M3 workspace-index summary command failed because I incorrectly read the result as `result.trails.length`; the exact report command was rerun immediately after and passed. No source-control write commands, `gt` commands, merge commands, or Linear mutations were run.
