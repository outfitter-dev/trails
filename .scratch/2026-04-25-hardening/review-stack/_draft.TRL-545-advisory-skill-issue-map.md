# TRL-545 Advisory Skill Issue Map

**Issue:** TRL-545
**Branch:** `trl-545-create-advisory-skill-follow-up-issues-from-prevention-audit`
**Purpose:** Translate accepted TRL-509 advisory briefs into actionable follow-up issues.

## Issue Map

| Brief | Follow-up | Required evidence |
| --- | --- | --- |
| `trails-warden-advisory` | TRL-593 | Rule tier, source owner, diagnostic shape, lifecycle, false positives. |
| `trails-dogfood-check` | TRL-594 | App/CI/framework trail runtime boundaries, Result errors, cwd/rootDir handling, host exceptions. |
| `trails-primitive-parity` | TRL-595 | Primitive docs, topo participation, Warden coverage, examples, query surfaces. |
| `trails-derive-from-source` | TRL-596 | Owner exports, projection consumers, rejected shadow registries. |
| `trails-error-format` | TRL-597 | Error taxonomy, projection maps, redaction, surface status codes, host boundaries. |
| `trails-discriminate-union` | TRL-598 | Public/queryable output schemas, stable discriminants, surface/agent branch behavior. |

## Shared Acceptance Criteria

Every advisory-skill follow-up should:

- Point to the repo sources it expects agents to inspect.
- Name which evidence is authoritative and which evidence is advisory.
- Include at least one "must not" guardrail to prevent public API drift.
- Produce recommendations or review findings, not automatic framework changes.
- Stay separate from durable Warden implementation unless the issue explicitly promotes a rule candidate.

## Non-Goals

- Do not implement the skills in this closeout stack.
- Do not create public Trails API from advisory guidance.
- Do not duplicate `docs/rule-design.md` inside each skill.
- Do not file a new issue for a skill candidate that already has a child issue under TRL-545.

## Decision

The six accepted advisory-skill issues are sufficient and should remain in Backlog until skill implementation is intentionally scheduled.
