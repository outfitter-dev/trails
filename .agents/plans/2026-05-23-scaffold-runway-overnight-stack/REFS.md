# References: Scaffold Runway Overnight Stack

## Tracked / Portable Sources

- `AGENTS.md` - repo doctrine, commands, Graphite workflow, changeset rules, subagent constraints.
- `.agents/plans/PLANNING.md` - packet, review, tracker, and source-control rules for goal work.
- `apps/trails/src/trails/create-scaffold.ts` - scaffold file map and generated content templates.
- `apps/trails/src/__tests__/create.test.ts` - existing scaffold coverage and helper assertions.
- `apps/trails/src/project-writes.ts` - supported project write operation shapes; currently write/mkdir/rename, not symlink.
- `apps/trails/tsconfig.tests.json` - dogfooded app-level test TypeScript config for root `__tests__/`.
- `packages/core/tsconfig.tests.json` - package-level sibling config shape.
- `docs/releases/beta-channel-policy.md` - TRL-792 target doc.
- `README.md` and `docs/getting-started.md` - adjacent consumer install docs to check for contradiction.

## Untracked / Local-Only Sources

- `/Users/mg/Developer/outfitter/trailblazing/inbox/2026-05-23-lewis-clark-turnaround.md` - Lewis/Clark coordination note; summarized in `RETRO.md` and shared note, not load-bearing for execution.

## Copied Or Summarized Sources

- This packet summarizes the post-577 state from the shared note: PR #577 merged at commit `52e4e8f7d`; TRL-780 is Done; Scaffold Runway is no longer blocked by the active stack hold.

## Tracker Records

- TRL-788 - generated `tsconfig.tests.json` sibling.
- TRL-777 - generated `AGENTS.md` + `CLAUDE.md` briefing.
- TRL-779 - generated README.
- TRL-792 - Bun runtime requirement docs.
- TRL-780 - prerequisite, Done via PR #577.
- Fieldwork Loop project - milestone container; all in-goal issues are under Scaffold Runway.

## PRs / Branches

- PR #577 - merged prerequisite: `fix: add scaffolded Trails CLI scripts`.
- Scaffold stack:
  1. `trl-788-trails-create-scaffold-tsconfigtestsjson-sibling-for-lsp`
  2. `trl-777-trails-create-scaffolds-agentsmd-claudemd-minimal-trails`
  3. `trl-779-trails-create-scaffolds-readmemd-create-react-app-style`
- Sidecar branch from `main`:
  - `trl-792-document-bun-runtime-requirement-for-consumers-beta-channel`

## Prior Plans

- `.agents/plans/archive/2026-05-23-trl-780-scaffold-cli-scripts/` - completed prerequisite packet, archived during this planning pass.

## Validation Commands

- `bun test apps/trails/src/__tests__/create.test.ts` - targeted scaffold behavior.
- `bun --cwd apps/trails test` - package-local app CLI test suite.
- `bun run typecheck` - repo type gate.
- `bun run lint` - repo lint gate with private Oxlint plugin build path.
- `bun run format:check` - repo formatting gate.
- `git diff --check` - whitespace and patch hygiene.
- `bun run check` - broad repo gate when time allows.
