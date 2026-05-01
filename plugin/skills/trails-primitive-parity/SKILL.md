---
name: trails-primitive-parity
description: Use when comparing maturity across Trails primitives without assuming every primitive must match trail capabilities. Helps agents identify deliberate gaps, real user-facing gaps, and future-facing symmetry pressure.
---

# Trails Primitive Parity

Use this skill when a resource, signal, contour, detour, layer, permit, tracing primitive, or other Trails concept looks less mature than trails.

## Workflow

1. Name the primitive and the suspected gap.
2. Gather current public docs, ADRs, examples, and package exports for that primitive.
3. Check whether it participates in topo validation, Warden, examples, query surfaces, trailheads, or generated artifacts.
4. Decide whether the difference is:
   - Deliberate scope for the primitive's current maturity.
   - A user-facing gap.
   - Agent ergonomics debt.
   - Future-facing symmetry pressure with no current implementation need.
5. Recommend docs, examples, Warden coverage, query support, or no change based on evidence.

## Authoritative Sources

- `docs/architecture.md`
- `docs/adr/`
- Primitive owner packages under `packages/`.
- Tests and examples for the primitive under review.

## Advisory Context

- Prior hardening audit theme: compare primitive maturity from current user-facing behavior, not assumed symmetry with trails.
- Primitive parity findings should separate deliberate scope, agent ergonomics debt, and real implementation gaps before recommending docs, examples, Warden coverage, query support, or no change.

## Must Not

- Do not force every primitive to have trail-equivalent surfaces, examples, or Warden rules.
- Do not turn layer v1 design questions into automatic enforcement.
- Do not create public API solely for symmetry.
- Do not call missing parity a bug without proving a user-facing or agent-facing failure mode.

## Output

Return:

- Primitive and maturity dimension reviewed.
- Evidence from docs, code, tests, and topo/query behavior.
- Classification of the gap.
- Recommended action or no-op decision.
- Follow-up issue scope if implementation is warranted.
