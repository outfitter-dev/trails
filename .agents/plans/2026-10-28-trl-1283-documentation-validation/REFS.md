---
description: Portable source map and comparison policy for the first documentation validation slice.
linear: [TRL-1283]
---

# Sources and ownership

- [TRL-1283](https://linear.app/outfitter/issue/TRL-1283/establish-documentation-validation-and-migration-accounting): owning intent and whole-issue acceptance. Directly read during implementation; Backlog at that read. This slice does not satisfy every criterion.
- `docs/adr/0062-documentation-architecture.md`, recorded in architecture commit `206dfef144aec70efb5925868cc9cf368ca1a19c`: accepted project architecture, ordinary index membership, natural owners, metadata floor and migration obligations. Local source is a dependency, not proof of merged state.
- `AGENTS.md`: current native-stack evaluation against main, generated ownership, source boundaries and distribution readiness. Coordinator explicitly confirmed canonical-main CI selection for this slice.
- `docs/contributing/script-graduation.md`: repository history facts may stay in tooling; durable Trails contract derivation belongs to its concept.
- `scripts/sync-error-taxonomy-docs.ts`, `scripts/sync-agents-warden-guide.ts` and `.skillset/plugins/trails-dev/skills/trails-adrs/scripts/lib/{index,decision-map}.ts`: existing generator owners. The numbered ADR index and decision-map writer are separate calls; together they render four artifacts.
- Existing `docs:links`, `docs:snippets`, `docs:wrap-check`, `error-taxonomy:check`, `warden:agents:check` and ADR check remain their current scan owners. This umbrella does not enlarge those owners' guarantees.
- `scripts/__tests__/docs-migrations.test.ts`: executable real-history evidence, including lower/upper branch comparison, missing and shallow history, rewritten renames, workspace removal and symlink boundaries.
- `scripts/__tests__/docs-ci.test.ts`: actual workflow-shell execution against a real local main/upper Git fixture, followed by event-specific comparison argument capture and a missing push-base failure.

Load-bearing scope and review criteria are in this packet. Ignored campaign scratch evidence is supplemental; execution does not require it. The advertised Linear agent-context endpoint was unavailable earlier, so owning issue/source reads supply the task evidence rather than invented shared notes.
