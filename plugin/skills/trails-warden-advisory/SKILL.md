---
name: trails-warden-advisory
description: Use when deciding whether a Trails hardening finding belongs in Warden, repo-local Oxlint, docs, an advisory skill, or no rule. Helps agents classify prevention candidates by owner source, Warden tier, lifecycle, diagnostic shape, and false-positive risk.
---

# Trails Warden Advisory

Use this skill before filing or implementing static guardrails from a Trails audit finding.

## Workflow

1. Name the invariant in framework terms, not as a one-off bug.
2. Identify the Trails concept being protected: trail, blaze, Result, detour, resource, topo, surface, projection, or package boundary.
3. Find the owner source for the data the rule would need. Prefer owner exports over copied strings.
4. Choose the narrowest home that can answer the question:
   - Warden source-static for one-file public Trails semantics.
   - Warden project-static for package/project context.
   - Warden topo-aware for resolved graph facts.
   - Warden drift for generated artifact parity.
   - Warden advisory for evidence-seeking guidance.
   - Repo-local Oxlint only for Trails repository hygiene or temporary cleanup.
   - Docs/manual cleanup when deterministic diagnostics would be noisy or speculative.
5. State lifecycle: durable, temporary with `retireWhen`, advisory, or no-rule.
6. Require at least one accepted fixture and one diagnostic fixture before recommending hard enforcement.

## Authoritative Sources

- `docs/rule-design.md`
- `docs/warden.md`
- `docs/adr/0036-warden-rules-ship-only-as-trails.md`
- `docs/adr/0037-owner-first-authority.md`
- `packages/warden/src/rules/metadata.ts`
- `packages/warden/src/rules/types.ts`
- The owner module for the concept being protected.

## Advisory Context

- Scratch audit notes and PR discussions can explain why a candidate exists, but they do not define rule doctrine.

## Must Not

- Do not create public `@ontrails/oxlint` or a public parser package for framework correctness.
- Do not invent `canonicalSource()`, generic registries, TSDoc canonical tags, or shadow owner tables.
- Do not copy whole doctrine into the issue or rule. Link the owner docs and source.
- Do not promote a one-shot migration scanner into durable Warden without a real invariant and retirement story.

## Output

Return a recommendation with:

- Rule home and Warden tier, if any.
- Owner source and projection target.
- Lifecycle and retirement trigger.
- Diagnostic shape.
- Accepted and rejected examples.
- Follow-up needed before implementation.
