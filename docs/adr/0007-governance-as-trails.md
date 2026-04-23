---
id: 7
slug: governance-as-trails
title: Governance as Trails with AST-Based Analysis
status: accepted
created: 2026-03-29
updated: 2026-04-22
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0007: Governance as Trails with AST-Based Analysis

## Context

The warden is Trails' governance system. It checks that code follows framework conventions: no throws in implementations, Result returns, cross declarations matching usage, no surface types in domain logic, and so on. It exists because the type system alone can't catch everything — `throw` is legal TypeScript, and nothing in the compiler prevents importing `Request` into a trail implementation.

Early warden rules used regex pattern matching on source code. This worked for the simplest cases but broke down fast. A `throw` inside a JSDoc comment triggered false positives. A string literal containing `new Request` looked like a surface type import. Nested scopes were invisible — regex can't tell the difference between a `throw` inside a `.map()` callback and a `throw` inside the implementation body itself.

Rules were standalone functions with ad-hoc interfaces. Each had a `name`, a `check` function, and a `severity`, but there were no schemas, no examples, no composition through the topo. The governance system was the one part of Trails that didn't use the Trails contract model.

That's a credibility problem. If the framework's own governance tools don't follow the patterns they enforce, the patterns are weaker for it.

## Decision

### Part 1: Rules as trails

Each source-file rule is wrapped via `wrapRule()` into a trail with ID `warden.rule.<name>`. `wrapRule()` has two overloads — one for plain `WardenRule` (single-file analysis) and one for `ProjectAwareWardenRule` (single-file analysis with cross-file context such as `knownTrailIds`). Topo-aware rules that inspect the resolved graph rather than source files are wrapped separately via `wrapTopoRule()`.

**Input** is `{ filePath: string, sourceCode: string }` for file-scoped rules, extended with project context such as `knownTrailIds` when a rule needs cross-file awareness. Topo-aware rules receive `{ topo: Topo }`.

**Output** is `{ diagnostics: Diagnostic[] }` where each diagnostic carries `filePath`, `line`, `message`, `rule`, and `severity`.

**Intent** is always `'read'` — rules are pure analysis, they never modify source files.

Rules have examples showing both clean code (empty diagnostics array) and violations (expected diagnostics with specific messages and line numbers). This means every rule's behavior is documented in the contract itself, not in separate test files or prose.

The built-in wrappers are collected into `wardenTopo`, but dispatch now follows the runtime shape instead of pretending every rule is file-scoped. `runWardenTrails(filePath, sourceCode, options?)` iterates only the file-scoped wrappers. `runTopoAwareWardenTrails(topo)` dispatches topo-aware wrappers once per resolved graph. `runWarden()` composes both paths, running file-scoped analysis across the requested sources and then adding topo-aware diagnostics when invoked with a resolved `Topo`.

This is dogfooding. The governance system uses the same contract model it enforces. Rules get schemas, examples, and testing for free — `testAll(wardenTopo)` validates the built-in rule trails in a single call, even as the registries evolve.

### Part 2: AST-based analysis

Rules that need structural understanding of code use `oxc-parser` instead of regex. The `parseSync()` function produces a full AST from TypeScript source with native speed[^oxc].

The warden provides lightweight helpers over the raw AST:

- `parse()` — parse source into an AST, returning null on failure
- `walk()` — depth-first traversal of all nodes
- `findTrailDefinitions()` — locate `trail()` and `signal()` call sites with their config objects
- `findBlazeBodies()` — extract `blaze:` property values from trail configs
- `findConfigProperty()` — find a named property inside an ObjectExpression
- `offsetToLine()` — convert byte offset to 1-based line number

One critical addition: `walkScope()`. Standard `walk()` descends into everything, including nested function expressions inside `.map()`, `.filter()`, and other callbacks. `walkScope()` stops at function boundaries. This prevents false positives — a `throw` inside a callback passed to an external library is not a `throw` in the implementation body. Rules that need finer-grained behavior (for example hoisted `var` handling or assignment tracking) layer their own specialized walkers on top of this baseline helper.

### Representative rule families

This ADR decides the execution model, not a fixed count of built-in rules. The concrete registry has grown since adoption and continues to evolve. The stable split is:

- **File-scoped AST rules** like `no-throw-in-implementation`, `implementation-returns-result`, `cross-declarations`, and `resource-declarations`
- **Project-aware source rules** that still run per file but consume derived project context, such as `valid-describe-refs`, `reference-exists`, and `incomplete-crud`
- **Topo-aware rules** that inspect the resolved graph once per topo, such as `incomplete-accessor-for-standard-op`, `permit-governance`, and `valid-detour-contract`

The current source of truth for the built-in registries is `packages/warden/src/rules/index.ts`.

## Consequences

### Positive

- **Rules get the full trail contract for free.** Schemas validate inputs. Examples document behavior. `testAll()` covers every rule's happy and sad paths. No separate test harness needed.
- **AST analysis is scope-aware.** `walkScope()` eliminates the false positives that plagued regex matching. A `throw` inside a `.map()` callback no longer triggers `no-throw-in-implementation`.
- **New rules follow a consistent pattern.** Write a `WardenRule`, `ProjectAwareWardenRule`, or `TopoAwareWardenRule`, wrap it with the matching helper (`wrapRule()` for the first two, `wrapTopoRule()` for the last), add examples, and drop it into the correct registry. The warden discovers and runs it automatically.
- **The governance system is its own proof.** If `wardenTopo` passes `testAll()`, the warden's own code satisfies the patterns it enforces.

### Tradeoffs

- **oxc-parser is a native dependency.** It ships as a Rust-compiled binary with a WASM fallback[^oxc]. This adds platform-specific artifacts to the package. The tradeoff is worth it — AST parsing at native speed with full TypeScript support, no configuration.
- **Rules are slightly more complex to write than regex.** Walking an AST and matching node types requires more code than a regex `.test()`. But the rules are more correct, and the pattern is consistent enough that the complexity is predictable.

### What this does NOT decide

- Whether rules will gain auto-fix capabilities (transforming the AST and writing corrected source back)
- Whether custom user-defined rules will be supported beyond the built-in set
- The specific AST library — oxc-parser is the current choice, but the helpers abstract it behind a stable interface

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — the foundational decisions; warden is the governance arm of "author, derive, declare — guard against drift"
- [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md) — the trail contract model that rules are now wrapped in
- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md) — the shared execution pipeline that runs rule trails

### Amendment log

- 2026-04-16: In-place vocabulary update per ADR-0035 Cutover 3 — `context-no-trailhead-types` → `context-no-surface-types`.
- 2026-04-22: Refreshed the execution model to distinguish file-scoped and topo-aware rule dispatch.

[^oxc]: [oxc-parser](https://oxc.rs/) — Rust-compiled JavaScript/TypeScript toolchain with native bindings and WASM fallback
