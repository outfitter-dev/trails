---
id: 36
slug: warden-rules-ship-only-as-trails
title: Warden rules ship only as trails
status: accepted
created: 2026-04-20
updated: 2026-04-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 7]
---

# ADR-0036: Warden rules ship only as trails

## Context

### The wrapping governed execution, not export

[ADR-0007](0007-governance-as-trails.md) made warden rules into trails internally. Every rule is wrapped via `wrapRule()` into a trail with ID `warden.rule.<name>`, gets a schema, examples, and runs through the shared execution pipeline.

That decision governed how rules *execute*. It did not reach the package boundary — the wrapper sat behind the boundary next to the raw object, not in front of it.

By the time the first topo-aware rule landed, `@ontrails/warden` was exporting each rule three different ways:

1. **The raw rule object** — `export { noThrowInImplementation } from './rules/no-throw-in-implementation.js';`
2. **The trail wrapper** — `export { noThrowInImplementationTrail } from './trails/index.js';`
3. **The registry** — `wardenRules` / `wardenTopoRules`, keyed by rule name.

All three point at the same behavior. A consumer reaches the same lint by importing the raw object, calling `.implementation()` on the trail wrapper, or looking up the entry in the registry.

### The three-path shape does not self-maintain

During review of [PR #195](https://github.com/outfitter-dev/trails/pull/195), Devin flagged that the new topo-aware rule `incompleteAccessorForStandardOp` was shipped via paths 2 and 3 but not path 1. Nothing in the build, the type system, or any lint caught the omission. The raw-rule re-export block in `packages/warden/src/index.ts` is a manual barrel; every new rule has to remember to add a line to it; the only thing that notices when someone forgets is a human reviewer.

That is exactly the drift class the framework exists to prevent, showing up in the framework's own governance package. It generalizes: any manually maintained export barrel that duplicates an already-authored set — here, the rule set that the registry already enumerates — will drift from that set by construction.

### The wrapper is strictly richer than the raw object

A trail wrapper is a `trail()` instance. It carries:

- `.implementation` — the function that runs the rule
- `.input` / `.output` — schemas describing the contract
- `.examples` — the happy-path and violation cases that feed `testAll()`
- `.id` — the canonical `warden.rule.<name>` identifier
- The rest of the trail contract

The raw rule object is a `WardenRule`: a `{ name, severity, check }` struct that predates the wrapping. It is strictly a subset of what the trail exposes.

## Decision

### The trail is the public rule; the raw object is private

Warden rules ship from `@ontrails/warden` through two paths only:

1. The trail wrapper (`incompleteCrudTrail`, `noThrowInImplementationTrail`, and so on)
2. The registry (`wardenRules`, `wardenTopoRules`)

The raw rule object stays inside the package. It is an implementation detail of the wrapper, not a public export.

```typescript
// Before
import { noThrowInImplementation } from '@ontrails/warden'; // raw rule object
import { noThrowInImplementationTrail } from '@ontrails/warden'; // trail wrapper
import { wardenRules } from '@ontrails/warden'; // registry

// After
import { noThrowInImplementationTrail } from '@ontrails/warden'; // trail wrapper
import { wardenRules } from '@ontrails/warden'; // registry
// raw rule object no longer importable
```

The registry stays public because it is the concrete shape `runWarden` and external runners consume — a `ReadonlyMap<string, Trail>` keyed by rule name, used for iteration and name-based lookup. It is derivable from the trail set, but multiple consumers want the same derived view, so the framework provides it once rather than forcing every caller to rebuild it.

### Consumers drive rules through the trail

A consumer who wants to run a rule directly goes through `.implementation(ctx, input)` on the trail wrapper, the same pathway every other trail uses:

```typescript
import { firesDeclarationsTrail } from '@ontrails/warden';

const result = await firesDeclarationsTrail.implementation(ctx, {
  filePath: 'src/trails/entity.ts',
  sourceCode,
});
```

No separate raw-call path exists. The direct-drive idiom collapses into the standard trail execution path.

### Extension slots into the same shape

When a connector package contributes a warden rule, or a project defines its own, the rule is a trail — not a raw rule plus optional wrapper. Third-party rules and built-ins share one public shape. `runWarden` grows its extension hooks on top of trails, not on top of two parallel shapes.

This closes the loop [ADR-0007](0007-governance-as-trails.md) left open in "Whether custom user-defined rules will be supported beyond the built-in set": user-defined rules, when they arrive, are trails. That is the only shape to support.

### Self-governance protects this decision

Shrinking the drift class is not the same as removing it. A manually maintained registry and a manually maintained trail-wrapper barrel can still disagree — one rule added to `wardenRules` without the matching `*Trail` export, one orphan `*Trail` export with no registry entry, one raw rule object slipped back into the public barrel. The ADR removes the three-path shape in principle; only a check removes the drift in practice.

Warden enforces registry-and-trail symmetry on its own package source:

1. Every entry in `wardenRules` / `wardenTopoRules` has a matching `*Trail` export in `packages/warden/src/index.ts`.
2. Every public `*Trail` export has a corresponding registry entry — no orphans.
3. No raw rule object name escapes to the public barrel.

Properties 1 and 2 are candidates for *structural* enforcement: if `wardenRules` / `wardenTopoRules` are projected from the trail set at build time — keyed by the rule suffix on each trail's `warden.rule.<name>` ID — the registry and the trail set are the same information, and disagreement is impossible by construction. Property 3 is a negative assertion about the public surface and cannot be derived; a lint-time check is the right level for it.

The [drift guard in ADR-0000](0000-core-premise.md) prefers derivation over lint-time checks. The implementation should evaluate structural derivation for properties 1 and 2 first, and fall back to a lint-time check only if derivation is not practical. Either way, the decision in this ADR is the same: drift between the registry and the trail set must fail before merge.

Implementation is tracked separately in [TRL-341](https://linear.app/outfitter/issue/TRL-341). The check depends on the trim landing first, so it lands after TRL-340.

## Non-goals

- Implementing extension hooks on `runWarden` (`extraRules` for file-scoped rules, auto-discovery of project-local warden trails). Those are follow-up work this ADR unblocks but does not scope.
- Changing the internal `WardenRule` / `TopoAwareWardenRule` types. They remain the shape the wrappers build on; they just do not escape the package.
- Altering rule execution semantics. `.implementation()` on the trail wrapper runs the same code the raw `.check()` method did.

## Consequences

### Positive

- One canonical public shape for every warden rule — built-in, connector-contributed, or project-local. Third parties do not have to straddle two shapes.
- The "forgot to add the third export" drift class disappears. Adding a rule adds one registry entry and one trail wrapper export. There is no third step to forget.
- Extension design simplifies. `runWarden` can accept user trails alongside built-in trails without negotiating between raw objects and wrappers.
- [ADR-0007](0007-governance-as-trails.md)'s intent — governance is trails — now holds at the package boundary, not only inside the package.

### Tradeoffs

- Backwards-incompatible for the one external consumer using the raw path. `apps/trails-demo/__tests__/signals.test.ts` was the only file in the monorepo importing raw rule objects; it migrates to `.implementation()` on the trail wrapper. Acceptable in the pre-1.0 cutover window.
- Driving a single rule directly gains one indirection. `rule.check(ctx, input)` becomes `ruleTrail.implementation(ctx, input)`. The call signature is the same; the receiver changes.

## Non-decisions

- The shape of `runWarden`'s extension hooks. `extraTopoRules` today is a test-only seam; a full public API comes later, informed by real third-party use cases.
- Whether project-local warden trails should be auto-discovered from the project's topo or registered explicitly. Same dependency on use cases.
- Whether the self-governance check later extends to third-party packages that contribute warden rules. The current commitment is to enforce symmetry on `@ontrails/warden` itself; extending the check to connectors or projects is a follow-up when that extension path exists.
- Whether auto-fix capabilities eventually attach to the trail wrapper or to a new primitive — deferred from [ADR-0007](0007-governance-as-trails.md) and still deferred here.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — "the trail is the unit of everything"; this ADR enforces that at the package boundary
- [ADR-0007: Governance as Trails with AST-Based Analysis](0007-governance-as-trails.md) — established that warden rules wrap as trails internally; this ADR extends that to the public export surface
- [PR #195](https://github.com/outfitter-dev/trails/pull/195) — surfaced the gap that prompted this decision
