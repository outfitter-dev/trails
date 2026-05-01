# TRL-509 Advisory Skill Briefs

**Issue:** TRL-509
**Branch:** `trl-509-draft-advisory-skill-briefs-after-prevention-audit`
**Purpose:** Draft advisory-skill briefs after the prevention audit, grounded in post-Warden source-tier doctrine.

## Inputs

- `.scratch/2026-04-25-hardening/08-prevention-rails.md`
- `.scratch/2026-04-25-hardening/tmp-audits/08-prevention-rails-reconciliation.md`
- `.scratch/2026-04-25-hardening/tmp-audits/reconciliation.md`
- `docs/rule-design.md`
- Warden source-tier foundation from TRL-512 through TRL-514
- Owner-first rule data rewires from TRL-528 and TRL-529

## Briefs

### trails-warden-advisory

Help agents decide whether a proposed static or advisory guardrail belongs in Warden, repo-local Oxlint, docs, or a one-off migration.

The skill should require source evidence before recommending a rule home:

- The Trails concept protected by the rule.
- The narrowest Warden tier that can answer the question.
- The owner-owned data source, if one exists.
- The diagnostic shape and likely false-positive surface.
- The lifecycle: one-shot migration, repo-local hygiene, or durable framework correctness.

The skill must not recreate broad rule doctrine in prompt prose. It should point agents back to `docs/rule-design.md` and current Warden source-tier implementation.

### trails-dogfood-check

Help agents review whether framework-owned Trails code follows the same Result/resource/error/cwd boundaries that consumer trails are expected to follow.

The skill should inspect:

- Trail blazes that read ambient process state such as `process.cwd()`.
- Runtime failures that throw or return raw `Error` across a Trails surface.
- App-loading or materialization paths that should be Result-shaped.
- Remaining intentional host boundaries that should be documented instead of silently treated as trail logic.

The skill should use TRL-564 and PR #300 as the source-backed example of the preferred cleanup shape.

### trails-primitive-parity

Help agents compare primitive maturity without forcing premature parity. Trails, resources, signals, contours, detours, and other primitives do not need identical surfaces, but differences should be deliberate.

The skill should gather:

- Existing public docs and ADR posture for the primitive.
- Whether the primitive participates in topo validation, Warden checks, examples, query surfaces, or trailheads.
- Whether missing affordances are real user-facing gaps or future-facing symmetry pressure.

The output should be an advisory recommendation, not an automatic demand for new public API.

### trails-derive-from-source

Help agents derive framework facts from authoritative owner modules instead of creating shadow registries.

The skill should inspect:

- Owner exports for error names/categories, rule metadata, surface maps, schema descriptors, or other first-party facts.
- Projection code that duplicates owner data.
- Warden rules that should consume owner-owned constants rather than parallel string lists.

The skill should reject `canonicalSource()`-style indirection unless a live owner boundary proves it is needed.

### trails-error-format

Help agents review error taxonomy, redaction, projection, and host-boundary behavior.

The skill should inspect:

- The most specific `TrailsError` subclass available for framework runtime failures.
- CLI, HTTP, MCP, and Hono projection ownership.
- Whether redaction and status-code mappings are owner-derived.
- Whether a throw is an intentional construction/programmer boundary or a runtime failure that should be Result-shaped.

The skill should not collapse all throws into bugs; it should distinguish construction/materialization boundaries from trail execution behavior.

### trails-discriminate-union

Help agents check queryable or public outputs that expose union-like data to agents and surfaces.

The skill should inspect:

- Whether union branches have stable discriminants such as `kind`, `mode`, or `type`.
- Whether tests assert the discriminant shape.
- Whether downstream surfaces can branch without guessing from partial field presence.
- Whether the issue belongs as Warden source-tier/project-tier work or as a focused schema cleanup.

The skill should avoid making every private union public doctrine. The scope is public/queryable outputs where agents consume the shape.

## Decision

All six briefs survive the prevention audit as advisory skills. They should remain advisory and evidence-seeking. Implementation follow-up issues are created separately under TRL-545.
