# Local Review Round 1: V1 Audit Lane

Date: 2026-05-12
Reviewer lane: V1 audit
Scope: TRL-634, TRL-636, TRL-637 audit reports and follow-ups
Stack tip: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`

## Result

Found one P2 audit-correctness issue in the TRL-634 parity report. No P0/P1 findings. TRL-636 and TRL-637 are evidence-backed and their filed follow-ups match the live gaps I checked.

## Findings

### P2: TRL-634 misclassifies the demo signal consumer as internal

Owning branch: `trl-634-audit-cross-surface-parity-coverage-gaps`

The parity counts are correct, but the report says all three non-projected trails are internal. The demo non-projected trail is actually a public signal activation consumer; it is excluded from surface projection because `filterSurfaceTrails()` rejects trails with activation sources, not because its visibility is internal.

Report evidence:

- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md:14`:
  > The projection posture is structurally aligned for the three shipped surfaces. Every public, surface-eligible trail in both app topos derives a CLI command, MCP tool, and HTTP route. The three non-projected trails are intentionally internal:
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md:104`:
  > | `entity.notify-updated` | write | - | - | - | not shipped | internal activation consumer | n/a |
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md:117`:
  > - Internal trails remain absent from public surfaces unless explicitly included. This matches `create.scaffold`, `add.verify`, and `entity.notify-updated`.

Source evidence:

- `apps/trails-demo/src/trails/notify.ts:30`:
  > export const notifyEntityUpdated = trail('entity.notify-updated', {
- `apps/trails-demo/src/trails/notify.ts:66`:
  > on: ['entity.updated'],
- `packages/core/src/trail.ts:461`:
  > visibility: rawVisibility ?? 'public',
- `packages/core/src/surface-filter.ts:154-155`:
  > if (trail.activationSources.length > 0) {
  > return false;

Validation:

```bash
bun --eval 'import { app } from "./apps/trails/src/app.ts"; import { graph as demo } from "./apps/trails-demo/src/app.ts"; import { deriveCliCommands } from "./packages/cli/src/index.ts"; import { deriveMcpTools } from "./packages/mcp/src/index.ts"; import { deriveHttpRoutes } from "./packages/http/src/index.ts"; const unwrap = (r) => r.isOk() ? r.value : (() => { throw r.error; })(); for (const [name, topo] of [["@ontrails/trails", app], ["trails-demo", demo]]) { const trails = topo.list(); const cli = unwrap(deriveCliCommands(topo)); const mcp = unwrap(deriveMcpTools(topo)); const http = unwrap(deriveHttpRoutes(topo)); const cliIds = new Set(cli.map((c) => c.trail.id)); const mcpIds = new Set(mcp.map((t) => t.trailId)); const httpIds = new Set(http.map((r) => r.trailId)); console.log(JSON.stringify({ name, storedTrails: trails.length, cli: cli.length, mcp: mcp.length, http: http.length, nonProjected: trails.filter((t) => !cliIds.has(t.id) && !mcpIds.has(t.id) && !httpIds.has(t.id)).map((t) => ({ id: t.id, visibility: t.visibility, on: t.on?.length ?? 0, activationSources: t.activationSources?.length ?? 0 })) }, null, 2)); }'
```

Observed result:

```json
{
  "name": "@ontrails/trails",
  "storedTrails": 29,
  "cli": 27,
  "mcp": 27,
  "http": 27,
  "nonProjected": [
    { "id": "create.scaffold", "visibility": "internal", "on": 0, "activationSources": 0 },
    { "id": "add.verify", "visibility": "internal", "on": 0, "activationSources": 0 }
  ]
}
{
  "name": "trails-demo",
  "storedTrails": 8,
  "cli": 7,
  "mcp": 7,
  "http": 7,
  "nonProjected": [
    { "id": "entity.notify-updated", "visibility": "public", "on": 1, "activationSources": 1 }
  ]
}
```

Recommended action:

Update `m3-parity-audit.md` to distinguish:

- 34 public, surface-eligible trails projected on CLI/MCP/HTTP.
- 2 intentionally internal trails: `create.scaffold`, `add.verify`.
- 1 public activation consumer excluded from callable surfaces: `entity.notify-updated`.

Also adjust the intentional-differences and coverage-matrix wording so the future parity runner filters by shipped-surface eligibility, not by "internal" status alone. The existing TRL-704/705/706 follow-ups can remain, but their evidence should not inherit the false "internal" claim.

### P3: TRL-634 includes a non-runnable probe placeholder

Owning branch: `trl-634-audit-cross-surface-parity-coverage-gaps`

The audit is otherwise backed by source and a live repro above, but one command block is not reproducible as written:

- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md:37`:
  > bun --eval '/*createTopoSnapshot + createTopoStore + deriveCliCommands + deriveMcpTools + deriveHttpRoutes for @ontrails/trails and trails-demo*/'

Recommended action:

Replace the placeholder with the actual short probe, or add a checked-in scratch helper under the report directory if the command is too long. This is P3 because the key claims are independently verifiable, but the report should be restartable without reconstructing the probe.

## Clean Checks

TRL-636 docs/examples audit:

- `bun run docs:snippets` still reports only `packages/tracing/README.md`, matching the TRL-708 finding.
- The fresh-start blocker remains grounded: `npm view @ontrails/commander version --json` still returns E404, matching TRL-707.
- Follow-ups TRL-707, TRL-708, TRL-709, and TRL-710 are focused, parented to TRL-636, and non-duplicative.

TRL-637 release-process audit:

- `bun run publish:check` passed for every non-private packable workspace, including packages that registry probes cannot resolve.
- `bunx changeset status --verbose` still fails with `Found changeset logtape-observe-target for package @ontrails/logging which is not in the workspace`, matching TRL-713.
- `.changeset/logtape-observe-target.md:2` still contains `"@ontrails/logging": patch`.
- `.changeset/pre.json:2-3` is still prerelease mode with tag `beta`.
- `scripts/publish.ts:153-170` uses `.changeset/pre.json` while in prerelease mode and falls back to `latest` outside prerelease mode.
- `scripts/publish.ts:448-483` publishes with `bun publish --access public --tag <tag>` and aborts on first failure.
- Follow-ups TRL-711, TRL-712, TRL-713, and TRL-714 are focused, parented to TRL-637, and use Bun publish language. The `npm view` usage is read-only registry verification, not publish guidance.

Linear readback:

- TRL-704 through TRL-714 exist, are open in Backlog, and are parented to their audit issues: TRL-704/705/706 under TRL-634, TRL-707/708/709/710 under TRL-636, and TRL-711/712/713/714 under TRL-637.

## Commands Run

```bash
/usr/bin/git branch --show-current
/usr/bin/git status --short
/usr/bin/git log --oneline --decorate -20
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md
nl -ba packages/testing/src/all.ts | sed -n '130,210p'
nl -ba packages/testing/src/index.ts
nl -ba docs/index.md | sed -n '1,80p'
nl -ba docs/api-reference.md | sed -n '120,175p'
nl -ba .changeset/pre.json
nl -ba .changeset/config.json
nl -ba .changeset/logtape-observe-target.md
nl -ba scripts/publish.ts | sed -n '1,90p'
nl -ba scripts/publish.ts | sed -n '140,185p'
nl -ba scripts/publish.ts | sed -n '340,500p'
bun --eval '<surface projection count probe>'
bunx changeset status --verbose
npm view @ontrails/commander version --json
npm view @ontrails/observe version --json
npm view @ontrails/topographer version --json
npm view @ontrails/wayfinder version --json
bun run docs:snippets
bun run publish:check
```

Linear read tools were used only to fetch TRL-704 through TRL-714; no Linear mutation was performed.
