---
name: trails-discriminate-union
description: Use when reviewing public or queryable Trails outputs that expose union-like shapes to agents or surfaces. Helps decide whether stable discriminants are required and whether the issue is schema cleanup, advisory guidance, or Warden work.
---

# Trails Discriminate Union

Use this skill when a trail output, projection, query response, or public schema has multiple object-like branches that consumers must distinguish.

## Workflow

1. Confirm the shape is public or queryable. Focus on trail outputs, topo/query projections, surface responses, or agent-consumed schemas.
2. Identify branch evidence: Zod schemas, JSON Schema projection, tests, examples, and downstream surface behavior.
3. Look for a stable literal discriminant such as `kind`, `mode`, `type`, or another owner-approved field.
4. Check whether consumers currently branch by field guessing, optional-field presence, message text, or array position.
5. Recommend one of:
   - Add or preserve a stable discriminant in the owner schema.
   - Keep private/internal helper unions out of public doctrine.
   - Add advisory follow-up because schema metadata cannot prove the public shape yet.
   - Promote to Warden only with reliable fixtures and a narrow owner source.

## Authoritative Sources

- `packages/core/src/validation.ts`
- Surface builders that project output schemas.
- Tests that cover examples, MCP/HTTP schema projection, or topo query output.

## Advisory Context

- PR #300 / TRL-564 context on queryable-contract hardening and public schema branch identity.
- Prior hardening audit theme: public or queryable object unions need owner-visible branch identity before Warden can enforce them.

## Must Not

- Do not demand discriminants for every private TypeScript union.
- Do not lint arbitrary `z.union(...)` without proving it reaches a public or queryable output.
- Do not break supported MCP/HTTP schema wrapping behavior to satisfy a generic rule.
- Do not infer branch identity from prose when a schema owner should expose it.

## Output

Return:

- Public/queryable status.
- Branch list and current discriminant evidence.
- Downstream consumer risk.
- Recommended owner schema change or advisory follow-up.
- Whether Warden can enforce the shape safely today.
