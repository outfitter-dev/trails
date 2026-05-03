---
name: trails-derive-from-source
description: Use when a Trails change derives framework facts, projections, rule data, or surface metadata. Helps agents find authoritative owner exports and avoid shadow registries, duplicated maps, and canonical-source indirection.
---

# Trails Derive From Source

Use this skill when a proposal adds a table, projection, metadata map, generated artifact, or Warden rule that repeats framework facts.

## Workflow

1. Name the fact being derived: error class, error category, intent, Result accessor, detour cap, rule metadata, surface projection, package entrypoint, or schema fact.
2. Find the natural owner module for that fact.
3. Check whether the owner already exports typed data the consumer can import.
4. If the owner does not export it, prefer adding a narrow owner export before creating a projection-local list.
5. Compare consumers against owner data and remove shadow copies when possible.
6. File a follow-up only when the owner boundary itself is missing or unclear.

## Authoritative Sources

- `docs/adr/0037-owner-first-authority.md`
- `docs/rule-design.md`
- Owner modules in `packages/core/src`, `packages/topographer/src`, `packages/warden/src/rules`, or the package that owns the primitive.
- Projection consumers in CLI, MCP, HTTP/Hono, Warden, docs generation, or topo compile/verify paths.

## Advisory Context

- Scratch audit notes, issue bodies, and PR discussions may identify suspected shadow data, but the owner module and committed doctrine decide the source of truth.

## Must Not

- Do not add generic `canonicalSource()` APIs, TSDoc registries, or topo-resident canonical tables by default.
- Do not make a consumer package the authority for framework-wide facts.
- Do not duplicate owner facts into a Warden rule because importing the owner export feels inconvenient.
- Do not treat intentionally local policy deny lists as owner projections unless another consumer needs the same data.

## Output

Return:

- The owner source.
- Each projection or consumer checked.
- Shadow data found or ruled out.
- The smallest owner export needed, if any.
- Whether the change should proceed, move to the owner package first, or become a follow-up issue.
