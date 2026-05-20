# Local Review Round 1: Docs / CLI

Date: 2026-05-19
Stack tip reviewed: `trl-116-run-examples-and-testall-across-live-version-entries`

## Scope

- ADR-0048 doctrine and ADR-0044 supersession.
- ADR-0016 forward pointer.
- Lexicon and language-styleguide versioning vocabulary.
- CLI namespace cleanup after `trails compile` / `trails validate`.
- Post-PR #530 blaze wording.

## Initial Findings

### P2: Accepted ADR docs still taught retired topo command grammar

Accepted ADRs 0014, 0015, 0017, and 0019 still presented `trails topo compile`, `trails topo verify`, or `trails topo diff` as current operator guidance after TRL-729 promoted the namespace to top-level `trails compile`, `trails validate`, and `trails survey diff --against`.

Resolution: fixed on `trl-729-feattrails-settle-top-level-cli-namespace-before-versioning`.

### P2: Bundled agent guidance still used retired topo commands

`plugin/skills/trails/SKILL.md`, `plugin/agents/trail-engineer.md`, and `plugin/skills/trails/references/migration-checklist.md` still instructed agents to run `trails topo compile` / `trails topo verify`.

Resolution: fixed on `trl-729-feattrails-settle-top-level-cli-namespace-before-versioning`.

## Latest Sweep

No current-facing P0/P1/P2 findings remain in docs, apps, packages, plugin guidance, or the active packet. Remaining hits for retired command names are historical/supersession contexts:

- ADR-0048 explicitly states that `trails topo compile` promotes to `trails compile` and `trails topo verify` is retired.
- ADR drafts keep old names as historical proposal text.
- The active plan/goal files preserve the original execution instructions.

## P3 Residual

- `docs/adr/0048-trail-versioning-v3.md` links ADR-0008 to `README.md` instead of `0008-deterministic-trailhead-derivation.md`. This is navigational, not doctrinal.
- A few accepted-doc prose phrases still say "topo compile" or "compile, verify" as nouns rather than runnable command guidance. The post-fix docs/CLI report lists the exact lines.

## Verification

- `bun scripts/adr.ts check` passed after the command-guidance fixes.
- `bun run format:check` passed after the command-guidance fixes.
- `rg` stale-command sweeps show no unresolved current-facing hits outside reports, the packet instructions, historical drafts, and ADR-0048 retirement wording.

## Result

Round 1 initially found P2 docs/CLI drift. The P2s were fixed on the owning branch. Latest state is P3-only for this lane.
