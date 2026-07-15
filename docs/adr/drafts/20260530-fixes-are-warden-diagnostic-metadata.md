---
slug: fixes-are-warden-diagnostic-metadata
title: Fixes are Warden diagnostic metadata
status: draft
created: 2026-05-30
updated: 2026-05-30
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 7, 36, 37, 43]
---

# ADR: Fixes are Warden diagnostic metadata

## Context

Warden is the governance arm of Trails. It is where drift becomes visible before runtime, and [ADR-0007](../0007-governance-as-trails.md) made that governance trail-shaped instead of a parallel lint system. Later, [ADR-0036](../0036-warden-rules-ship-only-as-trails.md) tightened the public shape: rules ship through Warden's trail and registry surfaces, not as a second raw-rule API.

Fixability creates the same drift risk in a new place. Once Warden can say "this source is wrong," the next tempting move is to build a separate table of "how to fix it" somewhere else: a Regrade migration database, a CLI-specific rewrite list, a guide scraper, or a prose-only convention. That route splits detection from repair. The rule that knows why a finding exists would no longer own the structured facts needed to repair or route it.

That split is especially dangerous for Regrade. Regrade needs Warden's rename-class facts, starting with `term-rewrite`, but it must not become a second Warden. Warden owns detection, rule identity, severity, and governance. Regrade owns application to a target codebase, provenance, validation, and review routing. If Regrade authors its own migration facts for Warden-detected drift, the two systems will disagree by construction.

The first implemented proof already points the right way:

- `WardenDiagnostic` carries optional `fix` metadata.
- `WardenRuleMetadata` carries optional rule-level fix capability.
- `WardenFix` distinguishes a transform class, safety level, concrete edits,
  reason, and fixture pointer.
- The guide/manifest rendering exposes rule-level fix availability.
- `warden --fix` applies only safe edits and leaves review-required fixes
  reported.
- `no-legacy-layer-imports` emits review-required `term-rewrite` metadata for
  the layer exports retired by [ADR-0043](../0043-layer-evolution.md).

This ADR ratifies that direction before Regrade consumes the data.

## Decision

Fix metadata belongs with Warden diagnostics and rule metadata.

The detecting rule owns the fix facts because the detecting rule is the only artifact that knows the matched invariant, source span, safety posture, and migration reason at the moment a finding is created. Other systems may consume those facts, but they do not re-author them.

### Fixability has three states

Warden findings are one of three shapes:

1. **Detection-only.** The rule can explain the violation but does not claim a
   structured fix. No `fix` appears on the diagnostic.
2. **Review-required fix.** The rule understands the migration class and
   reason, but the change needs human judgement. The diagnostic carries
   `fix.safety: 'review'` and no safe edits. Warden reports it and never
   rewrites it.
3. **Safe fix.** The rule can provide deterministic source edits. The
   diagnostic carries `fix.safety: 'safe'` plus concrete half-open edits.
   `warden --fix` may apply them.

This avoids a false binary where "fixable" implies "auto-apply." Review routing is a first-class fix outcome.

### Rule capability and finding edits are separate

Rule metadata advertises capability:

```ts
fix: { class: 'term-rewrite', safety: 'review' }
```

Diagnostic metadata carries the concrete finding:

```ts
fix: {
  class: 'term-rewrite',
  safety: 'review',
  reason: 'Legacy layer ... has no mechanical replacement.'
}
```

The rule-level capability feeds `warden guide`, manifests, agent guides, and rule catalogs. It says "this rule can emit fixes of this class." The diagnostic metadata says "this specific finding has this migration reason and, when safe, these exact edits."

Concrete edits do not live on rule metadata because a rule-level declaration does not know the source span. Prose guidance does not substitute for diagnostic metadata because prose is not a stable integration contract.

Diagnostic fix metadata must survive Warden's trail-shaped outputs. A rule trail output that strips `fix` recreates the parallel-surface drift [ADR-0036](../0036-warden-rules-ship-only-as-trails.md) was written to remove: raw-rule consumers would see richer facts than trail consumers. If a diagnostic has structured fix metadata, every supported Warden diagnostic rendering must either carry it or explicitly document why that rendering is summary-only.

### Safe fixes are deterministic source edits

A safe Warden fix is a set of half-open string-index edits into the exact source text that Warden analyzed. The applicator applies edits last-to-first, rejects non-safe-integer offsets, rejects out-of-bounds spans, and rejects overlap.

Safety means more than "the replacement is obvious." A safe fix must be:

- deterministic from the analyzed source;
- scoped to the scanned file set;
- expressible without semantic judgement;
- test-covered with before/after source; and
- safe to omit from the final diagnostic count once applied.

If those conditions are not true, the finding stays review-required.

### `term-rewrite` is a transform class, not a migration database

`term-rewrite` names the class of mechanical or review-routed term migrations. It is durable vocabulary for routing. It is not a side database of old-to-new terms, and it is not Regrade-owned policy.

For a removed symbol with no mechanical replacement, Warden emits `term-rewrite` with `safety: 'review'` and a reason. For a future renamed term with deterministic spans, Warden may emit `term-rewrite` with `safety: 'safe'` and edits. Regrade can consume both as one transform family: safe edits become rewrite candidates; review-only findings become `NeedsReview`; absence of a finding is no-op.

### Regrade consumes, validates, and routes

Regrade must not duplicate Warden's fix metadata. It can:

- run Warden or consume Warden-produced diagnostics that preserve `fix`;
- select diagnostics by `fix.class`;
- apply safe edits through the same semantics Warden uses;
- record package/source provenance;
- validate the result; and
- route review-required or ambiguous findings to `NeedsReview`.

Regrade does not own rule detection, severity, migration facts, or old-to-new term tables for Warden-detected drift.

This means Warden fix metadata blocks rename-class Regrade integration. It does not block the literal transform-trail tracer, downstream source collection, or other Regrade substrate that does not depend on Warden-authored migration facts.

### Regrade is contract change, not a one-off codemod

Regrade is not a migration utility bolted onto Trails. It is the contract-first model applied to contract change. If Trails makes drift structurally harder while a trail is being authored, the same posture should carry into the moments when a framework contract moves.

The useful invariant is narrower than a generic codemod: Regrade should migrate authored boundaries, then let derivation fan the derived outputs back out. A generic codemod rewrites every surface it can see because it is blind to authored versus derived state. A Trails-aware migration should usually touch less. If Regrade rewrites a rendered output, that is a smell; the rendering should have re-rendered from the updated contract unless the rendered artifact itself is authored.

For Warden-detected migrations, that keeps the ownership line sharp:

- Warden detects the drift and owns the structured migration facts.
- Regrade collects source, applies safe edits, validates the result, and routes review-required findings.
- One-time scripts may exist as prototypes or emergency bridges, but they must not become the durable home for framework migration policy.

The external adopter promise is deliberately staged. Internally, the v1 reset should prove the path first against Trails' own dogfood apps and downstream fixtures. A public promise that every breaking framework contract carries its migration path should wait until Regrade can keep that promise across package boundaries and downstream source, not only inside this monorepo.

### Manifests expose capability, not hidden behavior

Agent-facing guide output and manifests must expose rule-level fix capability when it exists. That lets agents discover which rules can produce fix metadata without manufacturing diagnostics or scraping docs. Concrete edits still appear only in diagnostics from a real run.

This is the same "one write, many reads" doctrine applied to governance repair: the rule author writes structured facts once, and Warden CLI output, guide surfaces, Regrade, and future agents consume the same authored facts.

## Non-goals

- Defining a public third-party fix plugin API.
- Creating a general codemod engine.
- Making Regrade a Warden replacement.
- Guaranteeing every Warden rule has a fix.
- Claiming review-required fixes are safe to apply automatically.
- Deciding Regrade package-source modes or the final Regrade ADR shape.
- Promising external downstream migration support before Regrade has proven
  package-source modes and adopter-source coverage.

## Consequences

### Positive

- Warden remains the source of truth for governance findings and their repair
  metadata.
- Regrade can consume Warden facts without inventing a parallel migration
  database.
- Agents can discover fix capability through manifests instead of parsing prose.
- Safe source edits are constrained enough to trust in `warden --fix`.
- Review-required migrations become visible structured work instead of failed
  auto-fixes.

### Tradeoffs

- Rule authors must do more than emit a message when a finding is fixable: they
  must decide safety, class, reason, and tests.
- Fix metadata expands Warden's public-ish diagnostic shape, so compatibility
  discipline matters.
- The first `term-rewrite` cases may be review-routed even when a human can see
  an obvious edit. That is acceptable until the rule can prove deterministic
  spans.

### Risks

- **Safety inflation.** A rule might mark an edit safe because it is usually
  right. Mitigation: safe fixes require deterministic spans and regression
  tests; otherwise use `review`.
- **Class sprawl.** Every migration could ask for a new class. Mitigation:
  classes route behavior and must earn multiple consumers. Start with
  `term-rewrite`.
- **Regrade drift.** Regrade could quietly add its own mappings for convenience.
  Mitigation: TRL-836 must consume Warden-owned metadata, and local review
  should reject parallel mapping tables.
- **Rendering drift.** A raw Warden rule path might preserve diagnostic fixes
  while a Warden trail path drops them. Mitigation: diagnostic `fix` is part of
  the supported Warden diagnostic shape; TRL-866 closes the current rule-trail
  rendering gap before TRL-836 depends on it.

## Non-decisions

- Whether future fix classes are needed beyond `term-rewrite`.
- Whether project-local Warden rules can expose custom fix classes.
- Whether a future public manifest has a stronger versioned compatibility
  contract.
- Whether Regrade eventually persists review items as entities.
- The exact Regrade integration path for `.tsx` scanning and downstream roots.
  Regrade still owns source collection and package provenance.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) - Warden is the governance
  arm of the contract-first model.
- [ADR-0007: Governance as Trails](../0007-governance-as-trails.md) - Warden
  rules follow the same trail-shaped model they enforce.
- [ADR-0036: Warden rules ship only as trails](../0036-warden-rules-ship-only-as-trails.md)
  - Warden's public rule shape stays canonical.
- [ADR-0037: Owner-First Authority](../0037-owner-first-authority.md) - Warden
  rules own their detection and fix facts; consumers derive from those facts.
- [ADR-0043: Layer Evolution](../0043-layer-evolution.md) - source of the
  retired legacy layer exports used by the first `term-rewrite` metadata.
- TRL-830 - Define Warden fix metadata and safe fix execution.
- TRL-834 - Draft Warden fix metadata ADR.
- TRL-866 - Project Warden diagnostic fix metadata through rule trail outputs.
- TRL-836 - Integrate Warden-backed `term-rewrite` regrades.
