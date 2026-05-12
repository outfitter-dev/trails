# Local Review Round 2: V1 Audit Lane

Date: 2026-05-12
Reviewer lane: V1 audit
Scope: TRL-634, TRL-636, TRL-637 audit reports and follow-up mapping
Stack tip: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`

## Result

Not clean. I found one P2 audit-correctness issue. The TRL-634 parity report
itself now distinguishes internal trails from public activation consumers and
contains a runnable projection probe, but the execution retro still carries the
old false summary.

No P0/P1 findings. TRL-636 and TRL-637 remain evidence-backed, and the
TRL-704 through TRL-714 follow-up mapping checks out against Linear readback.

## Findings

### P2: RETRO still says all three non-projected trails are internal

Owning branch: `trl-634-audit-cross-surface-parity-coverage-gaps`

The round 1 TRL-634 report finding was fixed in
`reports/m3-parity-audit.md`, but the execution retro still repeats the old
classification. That leaves the handoff artifact contradicting the canonical
audit report and the live projection probe.

Report evidence:

- `.agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md:213-216`:
  > `reports/m3-parity-audit.md`, and filed follow-ups `TRL-704`, `TRL-705`, and
  > `TRL-706`. The audit found 37 trails across `@ontrails/trails` and
  > `trails-demo`: 34 public trails project on CLI/MCP/HTTP, 3 are intentionally
  > internal, and WebSocket remains planned/not shipped.

Corrected canonical report evidence:

- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md:16-23`:
  > The projection posture is structurally aligned for the three shipped surfaces.
  > Every public, surface-eligible trail in both app topos derives a CLI command,
  > MCP tool, and HTTP route. The non-projected trails are either intentionally
  > internal or activation-source consumers that are not callable surface trails:
  >
  > - `@ontrails/trails:create.scaffold`
  > - `@ontrails/trails:add.verify`
  > - `trails-demo:entity.notify-updated`
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md:148`:
  > | `entity.notify-updated` | write | - | - | - | not shipped | public activation consumer | n/a |
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md:163-165`:
  > - Public activation consumers remain absent from callable surfaces because
  >   `filterSurfaceTrails()` excludes trails with activation sources. This matches
  >   `entity.notify-updated`.

Validation:

```bash
bun --eval '<M3 surface projection count probe from reports/m3-parity-audit.md>'
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

Recommended action:

Update the TRL-634 execution-log entry in `RETRO.md` to say the audit found
34 public trails projected on CLI/MCP/HTTP, 2 intentionally internal trails
(`create.scaffold`, `add.verify`), and 1 public activation consumer
(`entity.notify-updated`) excluded from callable surfaces by activation-source
filtering.

## Clean Checks

TRL-634 parity audit:

- `reports/m3-parity-audit.md` now has a real `bun --eval` workspace index probe
  and a real `bun --eval` surface-projection probe.
- The report's matrix and intentional-differences section now classify
  `entity.notify-updated` as a public activation consumer instead of internal.
- The follow-ups remain appropriate: TRL-704 for HTTP testing harness coverage,
  TRL-705 for example-driven CLI/MCP/HTTP parity execution, and TRL-706 for a
  complete shipped-surface projection inventory.

TRL-636 docs/examples audit:

- `bun run docs:snippets` still passes and reports only
  `packages/tracing/README.md`, matching TRL-708.
- `docs/index.md:28-31` and `docs/api-reference.md:149` still describe
  CLI/MCP/HTTP as shipped and WebSocket as planned, matching the audit posture.
- Linear readback shows TRL-707 through TRL-710 are parented to TRL-636 in the
  `v1 Release Prep` project.

TRL-637 release-process audit:

- `bun run publish:check` passed for all non-private packable workspaces.
- `bunx changeset status --verbose` still fails with
  `Found changeset logtape-observe-target for package @ontrails/logging which is not in the workspace`,
  matching TRL-713.
- `.changeset/logtape-observe-target.md:2` still contains
  `"@ontrails/logging": patch`.
- `.changeset/pre.json:2-3` is still prerelease mode with tag `beta`.
- `scripts/publish.ts:153-170` resolves `beta` from `.changeset/pre.json` while
  in prerelease mode and falls back to `latest` outside prerelease mode.
- `scripts/publish.ts:448-483` publishes with `bun publish --access public --tag <tag>`
  and aborts on the first package failure.
- Read-only registry probes for `@ontrails/commander`, `@ontrails/observe`,
  `@ontrails/topographer`, and `@ontrails/wayfinder` still return E404, matching
  TRL-714 and the TRL-707 generated-project symptom.
- Linear readback shows TRL-711 through TRL-714 are parented to TRL-637 in the
  `v1 Release Prep` project.

Linear readback:

- TRL-704, TRL-705, and TRL-706 are parented to TRL-634.
- TRL-707, TRL-708, TRL-709, and TRL-710 are parented to TRL-636.
- TRL-711, TRL-712, TRL-713, and TRL-714 are parented to TRL-637.
- No Linear mutation was performed.

## Commands Run

```bash
pwd
/usr/bin/git branch --show-current
/usr/bin/git status --short
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-v1-audit-round-1.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md
nl -ba .agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md
nl -ba packages/testing/src/all.ts | sed -n '130,215p'
nl -ba packages/testing/src/index.ts
nl -ba docs/index.md | sed -n '1,90p'
nl -ba docs/api-reference.md | sed -n '130,175p'
nl -ba scripts/publish.ts | sed -n '1,90p'
nl -ba scripts/publish.ts | sed -n '145,175p'
nl -ba scripts/publish.ts | sed -n '350,490p'
nl -ba .changeset/pre.json
nl -ba .changeset/config.json
nl -ba .changeset/logtape-observe-target.md
rg -n "entity.notify-updated|activation consumer|internal|runnable|bun --eval|TRL-704|TRL-705|TRL-706" .agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md
rg -n "3 are intentionally internal|public activation consumer|34 public trails|entity.notify-updated|TRL-704|TRL-707|TRL-711|logtape-observe-target|@ontrails/logging" .agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md .agents/plans/2026-05-12-topograph-query-docs-stack/reports/*.md
bun --eval '<M3 surface projection count probe from reports/m3-parity-audit.md>'
bun run docs:snippets
bunx changeset status --verbose
bun run publish:check
npm view @ontrails/commander version --json
npm view @ontrails/observe version --json
npm view @ontrails/topographer version --json
npm view @ontrails/wayfinder version --json
/usr/bin/git diff --check
```

Linear read tools were used only to list children of TRL-634, TRL-636, and
TRL-637. No source-control write commands and no Linear mutations were run.
