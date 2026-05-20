# References: Trail Versioning M1 + M2 Stack

## Tracked / Portable Sources

- `AGENTS.md` - repo guidance, Graphite workflow, release/changeset rules, and
  current lexicon.
- `.agents/plans/PLANNING.md` - Trails goal-planning preferences, including
  local review, retro discipline, tracker hygiene, and no merge queue labels.
- `.agents/plans/2026-05-19-trail-versioning-m1-m2/PLAN.md` - execution plan.
- `.agents/plans/2026-05-19-trail-versioning-m1-m2/GOAL.md` - pasteable goal.
- `docs/adr/0044-trail-versioning.md` - historical ADR to supersede. It is not
  implementation truth for this stack.
- `docs/adr/README.md` and `docs/adr/decision-map.json` - ADR index/map
  surfaces to update/check.
- `docs/adr/0016-*.md` - needs a forward pointer that the draft `mark()`
  reservation is not the versioning grammar.
- `docs/adr/0046-*.md` - check whether TopoGraph content changes require any
  pointer; current doctrine says no `trails.lock` manifest-schema amendment.
- `docs/lexicon.md` - durable vocabulary surface for versioning terms.
- `docs/contributing/language-styleguide.md` - post-PR #530 language guide;
  versioning docs must preserve the `blaze` grammar.
- `apps/trails/bin/trails.ts` - CLI dispatch entrypoint for `trails compile` /
  `trails validate` namespace work.
- `packages/core/src/` - likely home for trail-spec authoring types, runtime
  resolution, marker projection, and `VersionNotSupportedError`.
- `packages/topographer/src/` - likely home for TopoGraph projection and lock
  content changes.
- `packages/testing/src/` - likely home for version-aware `testAll` behavior.

## Local-Only / Ignored Sources

- `.agents/notes/2026-05-19-versioning-reset-v3.md` - local doctrine note that
  drove the Linear reset. It is intentionally not required for execution because
  this packet summarizes the load-bearing decisions. Read it if present, but do
  not depend on it for goal completion.

## Doctrine Summary Copied Into Packet

The following decisions were copied into `PLAN.md` and `GOAL.md`:

- Trail-only versioning for 1.0.
- Source shape is top-level `version: N` plus sibling `versions: { N: {...} }`.
- Current contract stays top-level: `input`, `output`, `blaze`.
- Historical entries require explicit `input` and `output`.
- Revision entries use pure `transpose: { input, output }`.
- Fork entries use `blaze:` and may own runtime context fields.
- Source entries have no `kind:`.
- `marker:` is projected, content-addressed, and not authored.
- `status` lifecycle and graph-only `forces:` belong to later M3 work except
  where M2 needs to leave room.
- Top-level CLI verbs are `create`, `compile`, `validate`, `diff`, `doctor`,
  `revise`, and `deprecate`.
- Current-facing docs must not revive `.v*.ts`, `trails version`,
  `trails sunset`, `version.markers`, `adapt:`, `--preserve`,
  `kind: 'forced'`, or authored timestamps.

## Tracker Records

- Linear project `Trail Versioning` - project body and milestones were updated
  on 2026-05-19 after `gt sync` to include the PR #530 blaze-language note.
- `TRL-728` - ADR-0048 and ADR-0044 supersession.
- `TRL-729` - top-level CLI namespace settle.
- `TRL-113` - `version` / `versions` authoring shape.
- `TRL-114` - pure `transpose:` revision transforms.
- `TRL-739` - projected content-addressed markers.
- `TRL-115` - runtime version resolution.
- `TRL-116` - examples and `testAll` across live version entries.
- Later/out of goal: `TRL-117`, `TRL-118`, `TRL-119`, `TRL-120`, `TRL-730`,
  `TRL-731`, `TRL-732`, and `TRL-508`.

## Branches

| Issue | Linear Branch |
| --- | --- |
| `TRL-728` | `trl-728-docsadr-supersede-adr-0044-with-trail-versioning-v3-doctrine` |
| `TRL-729` | `trl-729-feattrails-settle-top-level-cli-namespace-before-versioning` |
| `TRL-113` | `trl-113-define-trail-version-versions-authoring-shape` |
| `TRL-114` | `trl-114-add-pure-transpose-transforms-for-revision-entries` |
| `TRL-739` | `trl-739-featcore-compute-content-addressed-version-markers` |
| `TRL-115` | `trl-115-resolve-trail-versions-during-execution` |
| `TRL-116` | `trl-116-run-examples-and-testall-across-live-version-entries` |

## PRs / Branch State At Packet Creation

- `main` at `5d88104c6` / `origin/main`.
- PR #530 (`docs: align Trails blaze language`) merged and is the current head.
- Graphite warning: `trl-735-blaze-language-styleguide` is merged but checked
  out in another worktree, so cleanup is blocked there. Not a stack blocker.
- PR #531 (`chore: add codex clark agent wiring`) is draft and out of scope.

## Prior Plans

- `.agents/plans/2026-05-16-http-bun-observability-closeout/` - previous active
  packet. It appears tracked. If the work is complete, the executor may move it
  to `.agents/plans/archive/` on the lowest branch before committing this new
  packet, per `.agents/plans/PLANNING.md`.

## Validation Commands

- `gt sync` - refresh current branch and Graphite metadata.
- `git status --short --branch` - confirm working tree and branch state.
- `bun scripts/adr.ts map` - regenerate/verify ADR map when ADRs change.
- `bun scripts/adr.ts check` - validate ADR metadata and decision graph.
- `bun run typecheck` - repo typecheck.
- `bun run test` - repo test suite.
- `bun run lint` - repo lint gate.
- `bun run lint:ast-grep` - structural lint gate.
- `bun run build` - repo build.
- `bun run format:check` - formatting gate.
- `bun run check` - aggregate repo check.
- `bun run publish:check` - Bun-based package publish-readiness gate.
- `git diff --check` - whitespace/conflict marker check.
- `bun run warden:agents:sync` / `bun run warden:skills:sync` - sync generated
  guidance if Warden or agent-guide content changes.
- `bun run warden:agents:check` / `bun run warden:skills:check` - verify
  generated guidance is current.

## Planning Notes

- The goal-planning `context-prime.sh` helper ran during packet creation and hit
  the known local `jq: Unknown option --argfile` failure while scanning open PRs.
  Treat the primer as advisory and verify live PR / Graphite state directly.
- Linear stale-term searches after the sync found no active issue hits for
  `version.markers`, `adapt:`, `--preserve`, `kind: 'forced'`, `forced markers`,
  or `fork-without-preserved-impl`.
