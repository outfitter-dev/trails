# References

## Constitutional Sources

- `docs/adr/0000-core-premise.md` - author what's new, derive what's known, override what's wrong.
- `docs/tenets.md` - `cross()` / `crosses` as first-class composition, drift guard, compound value.
- `docs/lexicon.md` - `cross` / `crosses`, `trail`, `blaze`, `topo`, `surface`, `resource`, `layer`.
- `AGENTS.md` - Warden guide, Graphite workflow, subagent constraints.
- `.agents/plans/PLANNING.md` - goal packet and retro discipline.

## Tracker

- `TRL-791` - Warden coach against destructured `ctx.cross`; OD-4 reject-and-coach ruling.
- `TRL-793` - upgrade names-only diagnostics to teach the fix.
- `TRL-785` - `implementation-returns-result` helper provenance coverage gap after `TRL-333`.
- `TRL-786` - redundant `Result.err(x.error)` re-wrap detection, blocked on safer provenance.
- `TRL-790` - fieldwork marker lint; defer due scaffold/lint config overlap.

## Warden Implementation Anchors

- `packages/warden/src/rules/implementation-returns-result.ts`
  - Existing direct `ctx.cross` member-expression recognition lives in `isResultMemberCall`.
  - Diagnostic style is trail-id anchored.
- `packages/warden/src/rules/cross-declarations.ts`
  - Existing cross extraction recognizes both member calls and destructured bare `cross(...)`, but TRL-791 should coach destructuring away rather than extend this tolerated shape.
- `packages/warden/src/rules/no-direct-implementation-call.ts`
  - Small source-static rule pattern and good teaching diagnostic model.
- `packages/warden/src/rules/ast.ts`
  - `findTrailDefinitions`, `findBlazeBodies`, `identifierName`, `offsetToLine`, `walkScope`, `walkWithScopes`.
- `packages/warden/src/rules/metadata.ts`
  - Built-in rule metadata and concern/tier defaults.
- `packages/warden/src/rules/registry-names.ts`
  - Snapshot used by `warden-export-symmetry`.
- `packages/warden/src/trails/no-direct-implementation-call.trail.ts`
  - Wrapper model for the new rule trail.

## Audit Summary Imported From Trailblazing

Clark's audit note lives outside this repo at:

`/Users/mg/Developer/outfitter/trailblazing/plans/fieldwork-loop/warden-diagnostic-audit-20260523.md`

Load-bearing summary copied here so the tracked packet does not depend on that external file:

- 56 Warden rules audited.
- 24 teach the fix, 13 partially teach, 8 are names-only, 11 were skipped as internal/repo-local/dynamic.
- Highest-priority names-only offender is `implementation-returns-result`, because Radio showed the diagnostic can lead agents to cargo-cult `Result.err(x.error)` re-wraps.
- `TRL-791` is the model for a good teaching diagnostic: name the violation, name the cost, and point at the canonical authoring shape.
- `TRL-793` should start with names-only diagnostic strings and tests, not rule-logic changes.

## Subagent Findings Imported Into Packet

Gibbs on `TRL-791`:

- Recommended rule id `no-destructured-cross`.
- Register in rule index, metadata, registry-name snapshot, trail wrapper, and generated guides.
- Detect parameter destructuring and body destructuring from the blaze context parameter.
- Use a warning diagnostic that teaches direct `ctx.cross(...)`.

Hume on `TRL-785` / `TRL-786`:

- Current Warden already supports many imported Result helpers from `TRL-333`.
- Current gap includes `Result as ResultType` aliases; helper facts are still name-heavy rather than provenance-rich.
- Do `TRL-785` before `TRL-786`; a syntactic re-wrap rule would be too noisy.

Boyle on `TRL-790`:

- Native Oxlint config lacks a clean allowlist for `TODO[trails-*]`.
- A clean fix likely requires custom lint rule/plugin behavior and possibly generated scaffold lint config.
- Defer or stack intentionally on the scaffold branch; do not branch from main as a casual sidecar.
