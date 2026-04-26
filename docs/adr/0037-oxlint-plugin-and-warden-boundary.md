---
id: 37
slug: oxlint-plugin-and-warden-boundary
title: Oxlint Plugin and the Warden Boundary
status: accepted
created: 2026-04-25
updated: 2026-04-26
owners: ['[galligan](https://github.com/galligan)']
depends_on: [7, 23, 36]
---

# ADR-0037: Oxlint Plugin and the Warden Boundary

## Context

Trails has one rule home today: the warden. Per ADR-0036, every warden rule ships as a trail — a typed, contract-first unit that operates against the framework's resolved topo. That decision is correct for governance rules whose authority comes from cross-trail awareness, runtime invocation, derivation, or any other relationship the topo expresses.

But the v1 hardening pass surfaced a class of rules where the warden's shape is structural overhead. Several recurring patterns are file-level:

- `Result.err(new Error(...))` outside testing helpers
- `process.cwd()` inside trail blazes and other pure layers
- Output schemas declared as `z.union([...])` without a discriminant
- Numeric literals matching exported framework constants in scope
- `node:fs` sync APIs in async-capable contexts

None of these need the topo. None require runtime invocation. None need cross-trail comparison. They are AST-and-imports-level checks. Implementing them as warden trails forces them through topo machinery they don't use, and ships them through a tool that consumers run less frequently than their normal lint pass.

A second, related observation: Trails apps already run oxlint via ultracite. The lint pipeline is the place where consumer code is checked file-by-file at editor speed. If the framework can reach into that pipeline, framework-shipped lint rules run on consumer code with no extra ceremony. And — more importantly — the same plugin can expose the AST primitives consumers and extensions need to write their own framework-aware lint rules.

There is no current mechanism for extension authors or consumers to write framework-aware custom rules. They can hand-write oxlint rules using bare oxc-parser, but they lose the framework's vocabulary: `findTrailDefinitions`, `findBlazeBodies`, `isBlazeCall`, and contour-reference resolution. Several of these primitives already exist inside `@ontrails/warden`'s implementation; they are not currently part of any public surface that supports custom-rule authoring.

The question is whether to keep all rules inside warden — making the topo-as-rule-home assumption universal — or to carve out a second rule home where file-level rules and authoring primitives can live with shapes that match what they actually do.

## Decision

Ship `@ontrails/oxlint` as a second framework-shipped rule home, with a **bright-line boundary** against warden.

### The bright line

A rule belongs in **warden** if it requires any of:

- The resolved topo (cross-trail relationships, declared-vs-called comparisons, project-wide ID resolution, signal/resource graph traversal)
- Runtime invocation of framework helpers (`mock()`, `contour()`, `deriveFields()`, etc.)
- Derivation that depends on resolved framework state
- Advisory / suggestion modes that operate against compiled topo state

A rule belongs in **`@ontrails/oxlint`** otherwise. The default is oxlint when the rule can answer its question from a single file's AST plus its imports plus values resolved through their owner modules (per the [Owner-First Authority ADR](0038-owner-first-authority.md)).

In practice, this resolves to three tiers, not two:

| Tier | Scope | Home |
|---|---|---|
| File-local static | Single file's AST + literal imports | oxlint |
| Project-aware static | Bounded import and symbol resolution, but no resolved topo | oxlint, if bounded and fast |
| Resolved-graph / runtime / advisory | Topo, runtime invocation, or compiled framework state | warden |

The middle tier is real because a rule may need bounded import and symbol resolution without needing the resolved topo. A rule that needs to know whether an imported symbol resolves to a Trails primitive is project-aware but not topo-aware. Such rules belong in oxlint as long as the resolution stays bounded and fast — once a rule needs the full resolved topo, runtime invocation, or compiled framework state, it crosses into warden.

The line is principled, not preference-driven: it tracks what the rule structurally depends on, not what the rule feels like. A rule's home is determined by what it needs, not by who wrote it or which contexts it applies to.

**Failure mode test.** A boundary is only real if putting the rule in the wrong home has a named cost:

- **File-level rule misplaced in warden:** ships through topo machinery it doesn't use; runs at warden cadence rather than editor cadence; consumers see violations later than they should.
- **Topo-aware rule misplaced in oxlint:** can't see the cross-file relationships it needs; either produces false negatives (silent gaps) or attempts heuristic resolution that drifts from real topo state.
- **Project-aware rule misclassified as file-local:** can't resolve imports it needs; misses the rule's actual invariant.

When classifying a candidate rule, name its failure mode. If you can't, the classification isn't load-bearing yet.

### What `@ontrails/oxlint` ships

The plugin contains three kinds of artifact:

1. **Pre-built rules** — universal file-level rules that apply across `external` / `extension` / `internal` contexts (e.g., `result-err-new-error`, `process-cwd-in-pure-layer`, `union-output-without-discriminant`). Plus internal-only file-level rules where an oxlint home is more useful than warden (e.g., framework-internal hardening rules during pre-1.0).
2. **Trails-aware AST primitives** — a public API for traversing Trails-shaped TypeScript code. The initial stable set starts with semantic helpers that already exist inside warden, such as `findTrailDefinitions`, `findBlazeBodies`, `findContourDefinitions`, and `isBlazeCall`. Lower-level node walking, generalized result-context discovery, and broader project-aware resolution live behind an explicitly experimental subpath until their API shape is proven by real rules.
3. **Custom-rule scaffolding** — `defineTrailsRule(...)` wrapping oxlint's normal rule shape with Trails context detection (`external` / `extension` / `internal`) and the AST primitives above.

Framework authoritative data (error class hierarchies, intent values, CRUD operations, etc.) is consumed via direct imports from owner modules per the [Owner-First Authority ADR](0038-owner-first-authority.md) — no separate registry mechanism is shipped or required.

Custom-rule authoring looks like this:

```typescript
import { defineTrailsRule, findTrailDefinitions, isBlazeCall } from '@ontrails/oxlint';

export default defineTrailsRule({
  name: 'acme/no-direct-payment-call',
  contexts: ['external'],
  meta: {
    type: 'problem',
    docs: { description: 'Payment trails must compose via ctx.cross()' },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isBlazeCall(node) && isPaymentTrail(node)) {
          context.report({
            node,
            message: 'Use ctx.cross("payment.charge") instead of direct .blaze().',
          });
        }
      },
    };
  },
});
```

The same rule shape is what warden rules can't be — warden rules are trails (per ADR-0036), and trails operate on the topo, not on syntax. The two shapes match what each tool can do.

### How the two homes compose

The plugin and warden are independent rule homes that share the same data layer — owner-module imports, per the [Owner-First Authority ADR](0038-owner-first-authority.md). Both consume framework authoritative values by importing from the modules that own them.

Warden continues to be Trails-native and trail-shaped per ADR-0036. Its rules are still trails. Its scope tightens to the rules that genuinely require topo or derivation.

The plugin is mechanism-shaped — oxlint-native rules, not trails. Its scope is anything file-level. Crucially, this is where the **custom-rule authoring story lives**: extension authors and consumers using oxlint can write their own framework-aware rules with the exposed primitives.

### What this means for consumers

A consumer running `bunx ultracite check` (or oxlint directly) gets framework-shipped lint rules automatically. Universal rules apply to their code; framework-internal rules don't fire (context detection skips them in `external` context).

A consumer wanting to enforce their own conventions writes an oxlint rule using `defineTrailsRule` and the exposed primitives. Their rule sits alongside the framework's rules in the same lint pass. No separate runner, no extra ceremony.

### What this means for extensions

A connector author (today: first-party `@ontrails/*` connectors; tomorrow: third-party connectors using `trails.extends`) can ship their own oxlint rules as part of their package. Those rules use the same AST primitives. Connector authors who need topo still ship warden rules per ADR-0036; connector authors with file-level concerns ship oxlint rules alongside.

## Consequences

### Positive

- **Right home per rule shape.** Rules that need topo get topo; rules that don't get a faster, lighter pipeline. Forcing every rule through warden makes neither home good at its job.
- **Consumer benefit at zero ceremony.** Consumers running their normal lint pipeline get framework rules for free. No new runner, no Trails-specific CLI invocation needed.
- **Custom-rule authoring becomes a first-class story.** Extensions and consumers gain a supported path to write framework-aware rules, using the same primitives the framework uses. This is a material expansion of the framework's "extension as first-class" story.
- **Warden tightens to its strength.** Removing file-level rules from warden lets warden focus on topo-aware governance and advisory modes — including the suggest-next-tightening behavior that several tenets describe but is not yet shipped.
- **Faster feedback during development.** Oxlint runs incrementally in editors and CI. File-level rules surface violations at typing speed rather than at warden-run cadence.

### Tradeoffs

- **Two homes to maintain and document.** Anyone authoring or auditing rules must know which home applies. The bright line is principled, but it introduces a discrimination step that didn't previously exist.
- **Potential for drift between homes.** If the same rule could plausibly live in either home, choosing wrong creates duplication or omission. Mitigated by the bright line being structural (file-vs-topo) rather than aesthetic.
- **Two authoring shapes.** Warden rules are trail-shaped; oxlint rules use oxlint's visitor pattern. This is unavoidable: each shape matches what its tool can do. Pretending they're the same would be ceremony, not coherence.
- **Pre-1.0 surface commitment.** Shipping `@ontrails/oxlint` adds a public package. Once shipped, its API is semver-contracted. Mitigation: scope the v1 plugin tightly — universal rules, AST primitives, and `defineTrailsRule` — with intentional headroom for adding rules and primitives without breaking changes.

## Non-decisions

- This ADR does not specify which file-level rules ship in the v1 plugin beyond the boundary criterion. Specific rules are decided in the hardening work.
- This ADR does not define the full set of exposed AST primitives. The initial set comes from what warden already uses internally; further additions follow consumer and extension demand.
- This ADR does not define a separate rule home for ESLint or other linters. Trails uses oxlint[^oxlint] via ultracite; multi-engine support, if ever needed, is a future-extension concern.
- This ADR does not introduce a generic authority registry, loader, or tag format. Framework authoritative data follows the owner-first resolution model in [ADR: Owner-First Authority](0038-owner-first-authority.md).

## Boundary examples

To make the bright line concrete, here is how rules from the existing warden inventory and the v1 hardening backlog sort:

### Stays in warden (topo-aware or runtime-dependent)

- `cross-declarations`, `fires-declarations`, `resource-declarations` — declared-vs-called requires project-wide call-site resolution
- `contour-exists`, `reference-exists`, `resource-exists`, `on-references-exist` — workspace-wide ID resolution
- `unreachable-detour-shadowing` — needs the `TrailsError` class hierarchy resolved at runtime
- `valid-detour-contract`, `permit-governance` — operate on compiled topo
- `intent-propagation` — cross-trail intent comparison
- `incomplete-crud`, `missing-reconcile`, `incomplete-accessor-for-standard-op` — project-wide CRUD pattern detection plus runtime mock invocation
- `error-mapping-completeness` — needs `errorCategories` enumeration at runtime
- `example-valid` — invokes `contour()` to evaluate examples
- `prefer-schema-inference` — needs `deriveFields()` semantics
- `dead-internal-trail`, `missing-visibility`, `valid-describe-refs`, `orphaned-signal` — cross-file or topo-aware

### Moves to (or starts in) `@ontrails/oxlint`

- `result-err-new-error` — universal; file-level
- `process-cwd-in-pure-layer` — universal; file-level (purity check)
- `union-output-without-discriminant` — universal; file-level
- `parsed-error-message-direct` — universal; file-level
- `node-fs-sync-in-async-context` — universal; file-level
- `process-exit-numeric-literal` — internal-only; file-level (lives in oxlint with `internal` context tag)
- `throw-typeerror-in-framework` — internal-only; file-level
- Closed-grammar verb prefix (when authored) — universal; file-level

### Existing warden rules that could be reconsidered

A handful of existing warden rules are file-level and could conceptually move (`no-throw-in-implementation`, `no-throw-in-detour-recover`, `implementation-returns-result`). The hardening audit marked them durable in their current home; reclassifying them is a follow-up, not a v1 requirement. The default is to leave existing warden rules in place unless their move into oxlint produces material consumer benefit.

## References

- [ADR-0007: Governance as Trails with AST-Based Analysis](0007-governance-as-trails.md) — warden's foundational decision; the trail-shape for rules
- [ADR-0023: Simplifying the Trails Lexicon](0023-simplifying-the-trails-lexicon.md) — vocabulary alignment for `external` / `extension` / `internal` contexts
- [ADR-0036: Warden Rules Ship Only as Trails](0036-warden-rules-ship-only-as-trails.md) — establishes warden's rule shape; this ADR carves out a complementary home for non-trail rules
- [Rule Design](../rule-design.md) — rule-design methodology; the survival heuristic and owner-first authority pattern apply equally in both homes

[^oxlint]: [oxlint](https://oxc.rs/docs/guide/usage/linter.html) — fast Rust-based JavaScript/TypeScript linter that powers Trails' lint pipeline via ultracite.
