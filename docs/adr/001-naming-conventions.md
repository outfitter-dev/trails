---
status: accepted
created: 2026-03-27
updated: 2026-03-27
author: '@galligan'
---

# ADR-001: Naming Conventions

## Context

Trails is a contract-first framework. The names in its public API are the first thing developers, agents, and contributors encounter. They form the language people use to think about and discuss the system. Getting them right at the foundation matters more than in most frameworks because:

1. **Trails-branded vocabulary is central to the framework's identity.** Terms like `trail`, `follow`, `topo`, `blaze` carry meaning that standard terms don't. Misnamed concepts create confusion that compounds over time.
2. **Agents consume the API programmatically.** Names need to be unambiguous without contextual reasoning — a function name should tell an agent exactly what it does.
3. **The framework is pre-v1 with zero users.** This is the best moment to get naming right. After v1, renames are breaking changes.

This ADR establishes the naming conventions that govern all public API names across all packages. Individual naming decisions (which function is called what) are recorded separately in the API surface catalog. This ADR captures the *rules* those decisions follow.

## Decision

### Convention 0: Author, derive, declare — guard against drift

The meta-principle that governs all others. Every feature and API decision passes through three questions:

- **Author:** Is it easy to get right the first time? Can a novice or agent produce correct output without special knowledge? Does the framework guide them toward the right thing?
- **Derive:** Can the framework extract maximum value from what was authored? Does one declaration feed multiple consumers — types, surfaces, tests, docs, governance? Is the derivation deterministic?
- **Declare:** When the developer tightens the contract, does the framework ensure the declaration stays true? Can the declaration drift from reality? If it can, is that drift detected and surfaced?

The third question is the most important. Every declaration surface — output schemas, error types, `follow`, safety properties, examples — is a place where the stated contract can diverge from actual behavior. The framework must make divergence structurally difficult or immediately visible.

**Drift guard checklist** applied to every new declaration feature:

| Question | If "no," the feature needs work |
| --- | --- |
| Can the framework derive this instead of requiring authoring? | Prefer derivation. |
| If authored, does the compiler catch inconsistency? | Prefer compile-time safety. |
| If not compile-time, does `testExamples` catch it? | Prefer test-time safety. |
| If not test-time, does the warden catch it? | Prefer lint-time safety. |
| If not lint-time, does `survey --diff` catch it? | Prefer diff-time safety. |
| If none of the above, is the declaration freeform? | Freeform is acceptable only for `metadata`. |

### Convention 1: Clarity without context

A name must be understandable on line 200 of a file without seeing the import at the top. If a reader has to scroll up to know what a function does, the name failed.

Good:

- `testExamples(topo)` — clear on its own
- `autoIterateLayer` — obviously a layer, even outside a `layers: [...]` array
- `createTestContext()` — obviously a factory creating a test context

Bad:

- `examples(topo)` — ambiguous: returning them? filtering? running?
- `autoIterate` — could be a function, a flag, a config key
- `testContext()` — could be accessing a global, not constructing one

### Convention 2: Trails vocabulary for Trails concepts; standard vocabulary for everything else

Trails-branded terms are reserved for concepts unique to the framework — the things that make Trails feel like Trails. Standard infrastructure concepts keep their standard names.

**Trails-branded:** `trail`, `blaze`, `trailblaze`, `follow`, `topo`, `surface`, `warden`, `survey`, `guide`, `scout` (reserved), `trailhead` (reserved)

**Standard:** `logger`, `config`, `context`, `harness`, `sink`, `formatter`, `layer`, `event`, `error`, `result`

**The test:** if a developer already knows what the word means from other frameworks, don't rename it. `event` stays `event` because every developer knows what an event is. Composition uses `follow` because `route` means something different (HTTP path -> handler) in every other framework.

### Convention 3: `test*` for testing helpers

Testing functions use the `test` prefix. This makes them self-documenting and provides a consistent, extensible pattern. The word after `test` describes what is being verified.

```typescript
testExamples(topo)          // run all trail examples as tests
testTrail(trail, [...])     // run custom scenarios against a trail (including follow chains)
testContracts(topo)         // verify output against declared schemas
testDetours(topo)           // verify detour recovery paths
```

Future additions follow naturally: `testWayfinding(topo)`.

### Convention 4: `expect*` for test-time narrowing

Helpers that assert-and-return (combining an assertion with type narrowing) use the `expect` prefix. This mirrors the test runner's `expect()` and signals "this will fail the test if the condition isn't met."

```typescript
const value = expectOk(result); // assert Ok, return value
const error = expectErr(result); // assert Err, return error
```

### Convention 5: Bare nouns for definitions, `create*` for runtime instances

Functions that produce frozen, inert definitions use bare noun names. Functions that produce stateful runtime instances use the `create` prefix.

| Produces | Prefix | Examples |
| --- | --- | --- |
| Frozen definition (no lifecycle) | Bare noun | `trail()`, `event()`, `topo()` |
| Runtime instance (holds state) | `create*` | `createTrailContext()`, `createLogger()`, `createTestContext()` |

**The test:** after calling this function, does the result change over time or hold resources? If yes, `create`. If no, bare noun.

This mirrors the broader TypeScript ecosystem: Zod uses `z.object()` (definition), React uses `createContext()` (runtime instance).

### Convention 6: The vocabulary progression

Each step adds a layer. Everything before `blaze` is definition. Everything after is execution.

```text
trail()        → define a unit of work (with optional follow for composition)
event()        → define a payload schema
topo()         → assemble into a queryable topology
blaze()        → light up one surface (one-liner)
trailblaze()   → light up the full runtime (future: multi-surface, production)
```

`topo()` is the pivot — where definitions become a connected graph. Everything operates on the topo: `blaze`, `survey`, `warden`, `guide`, `testExamples`, `testContracts`, `generateSurfaceMap`. The topo is the center of gravity.

The sentence that explains the framework: **"You define trails. Then you follow them."**

### Convention 7: Suffix instances when the type isn't obvious from context

When an instance of a supporting concept can appear far from the declaration site where its role is obvious, suffix it with what it is.

**The heuristic:** if this name appeared alone on line 200, would a reader know what kind of thing it is?

```typescript
autoIterateLayer; // obviously a layer
outputModePreset; // obviously a preset
passthroughResolver; // obviously an InputResolver
```

This mirrors convention 3: the suffix exists for the reader who doesn't have surrounding context. Repetition in a list (`layers: [rateLimitLayer, cachingLayer]`) is a signal, not noise.

**When NOT to suffix:** Core primitives (`trail`, `event`, `topo`) are the vocabulary itself. You don't write `myTrailTrail`. The suffix convention applies to instances of *supporting* concepts — layers, presets, harnesses, formatters, sinks, resolvers.

### Convention 8: Surface wiring — `build*` then `to*` or `connect*`

Every surface has a two-step escape hatch behind the `blaze()` one-liner:

1. **`build*`** — derive the surface representation from a topo. Always the first step.
2. **`to*`** or **`connect*`** — wire to a runtime. Which verb depends on the transport:

| Verb | Meaning | Returns | Lifecycle |
| --- | --- | --- | --- |
| `to*` | Transform into library-specific runtime object | The object | Developer controls |
| `connect*` | Wire to transport and start | void | Framework controls |

```text
CLI:  buildCliCommands(topo) → toCommander(commands) → program.parse()
MCP:  buildMcpTools(topo)    → connectStdio(server)
HTTP: buildHttpRoutes(topo)  → toHono(routes) → app.listen(3000)   (future)
```

`blaze()` collapses all steps into one call.

### Convention 9: Don't namespace what package scope provides

Package-level imports (`@ontrails/core`, `@ontrails/testing`) provide sufficient scoping. No `z.`-style namespace object is needed at current API density.

If a domain grows dense enough to justify namespacing (e.g., a future `mock` namespace with `mock.input()`, `mock.services()`, `mock.fromExamples()`), add it then. Don't prematurely namespace.

### Convention 10: `derive*` for framework derivations

"Derive" is the framework's core capability — you declare the trail, the framework derives everything else. Functions that perform derivation use the `derive` prefix. The word after `derive` names what's derived.

```typescript
deriveFields(schema); // surface-agnostic field descriptors
deriveFlags(trail); // CLI flags (internal)
deriveToolName(trail); // MCP tool name (internal)
deriveAnnotations(trail); // MCP annotations (internal)
deriveMocks(schema); // mock data (future)
deriveExamples(trail); // generated examples (future)
```

### Convention 11: `validate*` for contract verification

Validation functions use the `validate` prefix. They always return `Result`. They always use Trails error types (`ValidationError`). Developers never need to interact with Zod's validation API for validation operations.

```typescript
validateInput(schema, data); // v1
validateOutput(schema, data); // v1
validateExample(trail, example); // future
validateFollow(from, to); // future
validateTopo(topo); // future
```

**Principle:** Zod is the schema authoring language. Trails is the validation language. You write schemas *in* Zod, you validate *with* Trails.

### Convention 12: Zod is authoring, Trails is everything else

The abstraction boundary between Zod and Trails:

**Zod stays exposed for:**

- Schema definition (`z.object`, `z.string`, `.refine`, `.transform`)
- Schema composition (`.extend`, `.pick`, `.omit`)
- Branded schema creation (`brand(z.string(), 'UUID')`)

**Trails absorbs (no Zod leak):**

- Type extraction → `TrailInput<T>`, `TrailOutput<T>`, `TrailRawInput<T>`, `TrailErrors<T>`
- Validation → `validate*` family returning Result
- Error introspection → `ValidationError.issues` in Trails-native format
- Schema reuse → `inputOf(trail)`, `outputOf(trail)`

The developer thinks in Zod when writing schema definitions. They think in Trails everywhere else.

## Consequences

### Positive

- **Guessable API.** A contributor who knows the conventions can predict function names before looking them up. `test*` for testing, `create*` for factories, `derive*` for derivations, `validate*` for verification, `build*` for surface derivation.
- **Consistent mental model.** The vocabulary progression (trail → follow → event → topo → blaze → trailblaze) tells a learnable story. Each step builds on the previous.
- **Drift resistance.** Convention 0 ensures every declaration feature has enforcement at some level. The drift guard checklist is applied to new features before they ship.
- **Agent-friendly.** Unambiguous names without contextual reasoning. An agent can consume the API from names alone.
- **Community-scalable.** New contributors follow the conventions. Reviewers enforce them. The naming debates are pre-answered.

### Tradeoffs

- **`Partial<I>` on examples.** Erases compile-time completeness checking for example inputs. Caught at test time and lint time, not compile time. Accepted: authoring friction reduction outweighs the safety loss.
- **`follow` learning curve.** Composition is expressed via `follow` on the trail spec rather than a separate primitive. This keeps the API surface smaller at the cost of a slightly less obvious first encounter.
- **Convention count.** Thirteen conventions is a lot to internalize. In practice, most are intuitive after seeing a few examples. Convention 0 is the one that requires active thinking; the rest become muscle memory.

### What this does NOT cover

- Specific function-to-name mappings (see the [API Reference](../api-reference.md))
- Internal naming conventions (non-exported code follows general TypeScript conventions)
- Trail ID naming conventions (e.g., `entity.show` dot-separated format) — that's a separate [vocabulary](../vocabulary.md) concern
- File naming conventions — follows from the export names naturally

## References

- [ADR-000: Core Premise](000-core-premise.md) — the foundational decisions these conventions serve
- [API Reference](../api-reference.md) — the canonical public API surface
- [Vocabulary](../vocabulary.md) — the Trails vocabulary guide
- [Testing](../testing.md) — the testing story that informed several conventions
