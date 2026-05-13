# References: V1 Readiness Closure Stack

This file makes the packet executable without chat history or ignored scratch
docs.

## Core Guidance

- `AGENTS.md` - repo commands, Graphite workflow, release/publish posture,
  subagent rules, Warden guide, and Trails project doctrine.
- `.agents/plans/PLANNING.md` - repo-local goal planning preferences:
  tracked packets, Linear as tracker, Graphite as branch model, local review
  before remote, no merge queue label, no merge without Matt.
- `.agents/plans/2026-05-13-v1-readiness-closure-stack/PLAN.md` - canonical
  execution plan.
- `.agents/plans/2026-05-13-v1-readiness-closure-stack/GOAL.md` - pasteable
  `/goal` prompt.
- `.agents/plans/2026-05-13-v1-readiness-closure-stack/RETRO.md` - running
  execution log.

## Source Reports Copied Into This Packet

These reports came from the merged TopoGraph Query + V1 Closeout stack and are
copied here so the new packet does not depend on archived or ignored material.

- `reports/source-m3-parity-audit.md`
  - Source issue: `TRL-634`
  - Key finding: CLI/MCP/HTTP projection is structurally aligned for public
    surface-eligible trails, but execution parity is unverified.
  - Follow-ups: `TRL-704`, `TRL-705`, `TRL-706`
- `reports/source-m5-docs-audit.md`
  - Source issue: `TRL-636`
  - Key finding: fresh generated CLI projects fail install because
    `@ontrails/commander@^1.0.0-beta.15` is missing/inaccessible, README
    snippet coverage is too narrow, link integrity is ungated, and public API
    `@example` coverage is sparse.
  - Follow-ups: `TRL-707`, `TRL-708`, `TRL-709`, `TRL-710`
- `reports/source-m6-release-process-audit.md`
  - Source issue: `TRL-637`
  - Key finding: release mechanics are workable, but stable cutover lacks a
    durable runbook, stable 1.x doctrine ADR, clean Changesets status, and
    registry/dist-tag preflights.
  - Follow-ups: `TRL-711`, `TRL-712`, `TRL-713`, `TRL-714`

## Prior Packet

The prior packet has been archived locally:

```text
.agents/plans/archive/2026-05-12-topograph-query-docs-stack/
```

Do not rely on the archived packet for execution. Use the copied source reports
and this packet instead.

## Linear Snapshot

Live Linear state checked on 2026-05-13:

| Issue | Priority | State | Milestone | Parent | Branch |
| --- | --- | --- | --- | --- | --- |
| `TRL-704` | High | Backlog | M3: Cross-surface parity | `TRL-634` | `trl-704-add-http-surface-harness-and-include-it-in` |
| `TRL-705` | High | Backlog | M3: Cross-surface parity | `TRL-634` | `trl-705-add-example-driven-climcphttp-parity-runner-and-ci-gate` |
| `TRL-706` | Medium | Backlog | M3: Cross-surface parity | `TRL-634` | `trl-706-expose-complete-shipped-surface-projection-inventory-for` |
| `TRL-707` | High | Backlog | M5: Docs v1 readiness | `TRL-636` | `trl-707-fix-fresh-start-install-blocker-for-generated-cli-projects` |
| `TRL-708` | Medium | Backlog | M5: Docs v1 readiness | `TRL-636` | `trl-708-expand-readme-typescript-snippet-verification-beyond-tracing` |
| `TRL-709` | Medium | Backlog | M5: Docs v1 readiness | `TRL-636` | `trl-709-add-markdown-link-integrity-check-for-docs-and-readmes` |
| `TRL-710` | Medium | Backlog | M5: Docs v1 readiness | `TRL-636` | `trl-710-create-public-api-example-coverage-inventory-and-gate` |
| `TRL-711` | High | Backlog | M6: Release process | `TRL-637` | `trl-711-codify-the-beta-to-10-release-runbook` |
| `TRL-712` | High | Backlog | M6: Release process | `TRL-637` | `trl-712-author-stable-release-doctrine-adr-for-the-1x-line` |
| `TRL-713` | High | Backlog | M6: Release process | `TRL-637` | `trl-713-repair-stale-changesets-references-before-stable-cutover` |
| `TRL-714` | High | Backlog | M6: Release process | `TRL-637` | `trl-714-add-registry-availability-and-dist-tag-release-preflights` |

Dependency/link updates made while preparing this packet:

- `TRL-705` is blocked by `TRL-704` and `TRL-706`.
- `TRL-711` is blocked by `TRL-712`, `TRL-713`, and `TRL-714`.
- `TRL-707` is related to `TRL-714`.

## Open PR Context

- PR #479: `docs: refresh taxonomy and vocab audit metadata`
  - Branch: `chore/docs-freshness-taxonomy-vocab`
  - Status at packet creation: draft, dirty against current `main`.
  - Out of scope; do not build this stack on top of it.
- PR #447: `feat(adapters): add @ontrails/bun adapter`
  - Branch: `feat/adapters-bun`
  - Status at packet creation: draft, dirty against current `main`.
  - Out of scope; this is a separate adapter/product direction question.

## High-Risk Boundary: Publishing

This stack may need registry probes, but it must not publish packages or mutate
registry state.

Allowed:

- `bun run publish:check`
- read-only package/version/dist-tag probes
- deterministic tests for registry-preflight script behavior

Forbidden without Matt's explicit confirmation:

- `bun run publish:packages`
- `bun publish`
- `npm publish`
- package ownership/access mutations
- real dist-tag mutations

If `TRL-707` can only be completed by publishing missing packages, stop and
report the exact evidence and smallest human action.

## Useful Commands

Preflight:

```bash
gt sync
gt checkout main
git status --short --branch
gt log --stack --no-interactive
gh pr list --state open --limit 50 --json number,title,headRefName,isDraft,mergeStateStatus,url
```

Release checks:

```bash
bunx changeset status --verbose
bun run changeset:check
bun run publish:check
```

Docs checks:

```bash
bun run docs:snippets
bun scripts/adr.ts check
bun run format:check
```

Testing/parity checks:

```bash
bun test packages/testing
bun test apps/trails-demo
bun run typecheck
```

Full tip gate:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run build
bun run format:check
bun run check
bun run dead-code
bun run publish:check
git diff --check
```
