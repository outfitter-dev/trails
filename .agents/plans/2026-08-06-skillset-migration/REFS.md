---
created: "2026-08-06T21:00:00Z"
updated: "2026-08-07T18:35:00Z"
description: Portable source map for the standalone Skillset migration.
linear:
  - TRL-1271
  - TRL-1272
  - TRL-1273
  - TRL-1274
  - TRL-1275
impl_status: in_progress
references:
  - PLAN.md
  - GOAL.md
  - RETRO.md
---

# References

## Durable sources

- [Goal loop bootstrap — Trails to standalone Skillset](https://linear.app/outfitter/document/goal-loop-bootstrap-trails-to-standalone-skillset-90480b17c152)
- [TRL-1271](https://linear.app/outfitter/issue/TRL-1271/prove-trails-agent-output-parity-with-standalone-skillset)
- [TRL-1272](https://linear.app/outfitter/issue/TRL-1272/adopt-canonical-skillset-source-and-lock-provenance-for-trails-agents)
- [TRL-1273](https://linear.app/outfitter/issue/TRL-1273/cut-trails-skill-sync-and-checks-over-to-standalone-skillset)
- [TRL-1274](https://linear.app/outfitter/issue/TRL-1274/move-trails-repo-local-plugin-projections-onto-skillset)
- [TRL-1275](https://linear.app/outfitter/issue/TRL-1275/project-warden-derived-agent-guidance-through-skillset)
- [SET-394](https://linear.app/outfitter/issue/SET-394/preserve-executable-modes-in-generated-resource-and-plugin-files)
- [SET-395](https://linear.app/outfitter/issue/SET-395/coalesce-canonical-and-generated-skill-roots-during-repo-adoption)
- [SET-396](https://linear.app/outfitter/issue/SET-396/preserve-provider-native-project-agent-references-to-unmanaged-skills)
- [#990](https://github.com/outfitter-dev/trails/pull/990)
- [#991](https://github.com/outfitter-dev/trails/pull/991)
- [#992](https://github.com/outfitter-dev/trails/pull/992)
- [#393](https://github.com/outfitter-dev/skillset/pull/393)
- [#395](https://github.com/outfitter-dev/skillset/pull/395)

## Repository contracts

- `AGENTS.md`
- `.agents/plans/PLANNING.md`
- `docs/tenets.md`
- `docs/lexicon.md`
- `docs/contributing/script-graduation.md`

## Migration anchors

- `package.json`
- `bun.lock`
- `scripts/codex/skillset.ts`
- `scripts/codex/skillset.config.toml`
- `scripts/__tests__/skillset.test.ts`
- `.claude/skills/`
- `.agents/skills/`
- `.codex/agents/`
- `scripts/sync-plugin-metadata.ts`
- `scripts/sync-skill-warden-guide.ts`
- `scripts/sync-agents-warden-guide.ts`
- `scripts/check-installed-trails-skill.ts`

Missing or renamed anchors are evidence, not permission to invent replacements. This packet does not depend on `.agents/notes/`, sibling checkouts, chat history, or temporary files.

## Published execution contract

- Registry package: exact npm `skillset@0.22.0`, reverified as `latest` on 2026-08-06.
- Released npm artifacts and CLI behavior are authoritative; `/Users/mg/Developer/outfitter/skillset` may be consulted only as non-authoritative orientation.
- Hermetic executions use temporary source/output and explicit temporary HOME, XDG config, XDG cache, and XDG state paths.
