# Warden-as-Coach Overnight Stack

Date: 2026-05-24
Owner: Lewis
Branch root: `trl-791-warden-coach-against-destructured-ctxcross-new-reject-and`
Tracker: Linear `TRL`, project `Fieldwork Loop`, milestone `Warden as Coach`

## Objective

Turn the Radio/Fieldwork learning into Warden guidance that keeps future Trails authors and agents on the happy path.

The stack should favor small, reviewable slices:

1. `TRL-791` - add a source-static Warden rule that coaches against destructuring `cross` off `ctx` inside blaze bodies.
2. `TRL-793` - if time remains and the diff stays diagnostic-only, upgrade the 8 names-only Warden diagnostics to teach the fix.
3. `TRL-785` - close the `implementation-returns-result` alias/provenance coverage gap from `TRL-333`.
4. `TRL-786` - only after `TRL-785`, add redundant `Result.err(x.error)` re-wrap detection for provably safe cases.

Do not take `TRL-790` in this first branch. The clean fix likely touches root lint/plugin config and scaffold-generated lint config, which overlaps the open scaffold stack. Revisit after the scaffold PRs land or intentionally stack it there.

## Doctrine

- Core premise: author what's new, derive what's known, override what's wrong.
- Drift guard rung: Warden is the right layer for coaching canonical authored shapes that TypeScript cannot forbid cleanly.
- Compound test: `ctx.cross(...)` is the runtime composition primitive; preserving the direct member-expression shape helps Warden recognize composed `Result` values and keeps composition visible to readers, docs, and future Ranger/fieldguide guidance.
- Evaluation hierarchy: strengthen an existing primitive (`ctx.cross`) before broadening behavior or introducing aliases.
- Vocabulary: say `trail`, `blaze`, `topo`, `cross`, `surface`, `resource`, `layer`. Do not call this a handler or middleware rule.

## Current Tracker Truth

`TRL-791` is Backlog at planning time. It already contains the OD-4 ruling: reject and coach, do not bridge destructured `cross` in `implementation-returns-result`.

`TRL-793` is Backlog. Clark filed it from the Warden diagnostic-language audit. It is low risk only if limited to diagnostic strings and tests for names-only offenders.

`TRL-785` is Backlog. Clark/Hume found it overlaps done issue `TRL-333`; current scope is a coverage-gap follow-up, not a fresh imported-helper implementation.

`TRL-786` is Backlog. Do not implement before `TRL-785` creates enough provenance to avoid noisy syntactic false positives.

## TRL-791 Acceptance Criteria

- New rule id: `no-destructured-cross`.
- Severity: `warn`.
- Metadata: concern `composition`, tier `source-static`, scope `external`, lifecycle durable.
- Flags both canonical shadow patterns inside trail blaze bodies:
  - parameter destructuring: `blaze: async (input, { cross }) => ...`
  - body destructuring from the context parameter: `const { cross } = ctx;`
- Flags aliases too: `const { cross: compose } = ctx` and `({ cross: compose })`.
- Stays quiet for direct `ctx.cross(...)`.
- Stays quiet for non-blaze code and nested callbacks/functions unrelated to the blaze's context parameter.
- Registers in `wardenRules`, `registry-names`, metadata, and Warden trail wrappers.
- Regenerates Warden guide blocks with repo scripts.
- Includes a patch changeset for `@ontrails/warden`.

## Likely TRL-791 Edit Set

- `packages/warden/src/rules/no-destructured-cross.ts`
- `packages/warden/src/__tests__/no-destructured-cross.test.ts`
- `packages/warden/src/rules/index.ts`
- `packages/warden/src/rules/registry-names.ts`
- `packages/warden/src/rules/metadata.ts`
- `packages/warden/src/trails/no-destructured-cross.trail.ts`
- `packages/warden/src/trails/index.ts`
- `AGENTS.md`
- `.claude/skills/clark/references/warden-guide.md`
- `plugin/skills/trails/references/warden-guide.md`
- `.changeset/<slug>.md`
- This packet's `RETRO.md`

## Validation Ladder

Focused:

```bash
bun test packages/warden/src/__tests__/no-destructured-cross.test.ts
bun test packages/warden/src/__tests__/warden-rule-metadata.test.ts packages/warden/src/__tests__/guide.test.ts packages/warden/src/__tests__/warden-export-symmetry.test.ts
bun run warden:agents:check
bun run warden:skills:check
```

Branch:

```bash
bun --cwd packages/warden test
bun run typecheck
bun run lint
bun run format:check
git diff --check
```

Before PR handoff:

```bash
bun run check
```

## Review Protocol

Use at least two local review lanes before submit:

- Warden implementation/test lane: AST scope, false positives, registration, guide sync.
- Doctrine/vocabulary lane: diagnostic teaches the fix and preserves `ctx.cross(...)` as canonical.

If the first review pass finds P0/P1/P2, fix before submit. P3 can remain only if logged in `RETRO.md`.

## Source Control

- Use Graphite.
- No merge.
- No merge queue label.
- No publish or registry mutation.
- Subagents may inspect, test, and edit bounded files if delegated, but must not run git/gt write commands.
- Keep PR draft until local review and CI are green.

## Stop Rules

Stop and ask Matt if:

- The fix requires changing public `ctx.cross` typing or `implementation-returns-result` recognition semantics beyond adding the coaching rule.
- `TRL-793` stops being diagnostic-only.
- `TRL-785` requires a broad imported-module resolver rewrite.
- `TRL-786` cannot prove re-wrap redundancy without noisy false positives.
- Remote review finds a doctrine conflict rather than an implementation bug.
