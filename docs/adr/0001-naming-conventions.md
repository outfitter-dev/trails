---
id: 1
slug: naming-conventions
title: Naming Conventions — Guessable API Through Structural Rules
status: accepted
created: 2026-03-27
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0001: Naming Conventions — Guessable API Through Structural Rules

## Context

Trails is a contract-first framework. The public API is the language people use to think with, not just a set of import paths. Because the project is still pre-release, we can still choose coherence over compatibility and rewrite history for clarity where needed.

The earlier naming pass deliberately preserved some generic technical words such as `surface`, `adapter`, `Layer`, `event`, and `service`. That kept the API closer to established framework vocabulary, but it also split the mental model in two. Core trail concepts used the branded language (`trail`, `topo`, `follow`, `blaze`, `warden`) while adjacent concepts kept unrelated infrastructure jargon. The result was a translation tax:

- docs had to explain which nouns were special and which were just borrowed
- scaffolding and examples mixed two vocabularies in the same story
- future renames became more expensive because "temporary generic" terms started leaking into file names, tests, and architecture docs

This ADR resets the rule: if a concept is central to Trails and repeatedly appears in public APIs, runtime wiring, docs, or governance, it should live in the same vocabulary family.

## Decision

### Author, derive, declare

The framework still passes every feature through the same three questions:

- **Author** — can a human or agent get this right the first time?
- **Derive** — can the framework extract maximum value from the authored declaration?
- **Declare** — can the framework keep the declaration and reality from drifting apart?

Naming follows the same rule. If a name causes translation work at authoring time or explanation time, it is already making the framework worse.

### Clarity without context

A name must be understandable on line 200 of a file without seeing the import at the top.

Good:

- `testExamples(topo)`
- `autoIterateGate`
- `createTestContext()`

Bad:

- `examples(topo)`
- `autoIterate`
- `testContext()`

### Trails vocabulary for Trails concepts; standard vocabulary for everything else

Trail-native terms are not reserved only for the most romantic concepts. They should cover the framework's core model end to end.

**Trail-native:** `trail`, `blaze`, `topo`, `trailhead`, `run`, `cross`, `crosses`, `signal`, `fires`, `provision`, `provisions`, `gate`, `tracker`, `track`, `permit`, `loadout`, `warden`, `mount`, `pack`, `depot`

**Standard:** `logger`, `config`, `context`, `Result`, `error`, `connector`, `build*`, `to*`, `connect*`

The test is no longer "would another framework use this word?" The test is "does this concept belong to the story Trails tells?" If yes, give it the framework vocabulary.

### `test*` for testing helpers

Testing helpers keep the `test*` prefix.

```typescript
testExamples(topo);
testTrail(trail, scenarios);
testContracts(topo);
testDetours(topo);
```

Future additions should read naturally, for example `testWayfinding(topo)`.

### `expect*` for test-time narrowing

Helpers that assert and narrow in tests keep the `expect*` prefix.

```typescript
const value = expectOk(result);
const error = expectErr(result);
```

### Bare nouns for definitions, `create*` for runtime instances

Frozen definitions use bare nouns. Stateful runtime instances use `create*`.

| Produces | Naming style | Examples |
| --- | --- | --- |
| Frozen definition | Bare noun | `trail()`, `signal()`, `provision()`, `topo()` |
| Runtime instance | `create*` | `createTrailContext()`, `createLogger()`, `createTrackerGate()` |

### The vocabulary progression

The framework should read like one system:

```text
trail()         -> define a unit of work
blaze:          -> give the trail its implementation
signal()        -> define a typed notification
topo()          -> assemble the graph
trailhead()     -> open the graph to the outside world
run()           -> execute a specific trail directly
```

The sentence that explains the framework is now: **"You blaze a trail. Then you run it."**

### Suffix instances when the type isn't obvious from context

When an instance of a supporting concept can appear far from the declaration site where its role is obvious, suffix it with what it is.

The heuristic: if this name appeared alone on line 200, would a reader know what kind of thing it is?

```typescript
autoIterateGate;
httpTrailhead;
jwtConnector;
```

Core primitives do not get redundant suffixes. Supporting instances do.

### Trailhead wiring — `build*` then `to*` or `connect*`

Every trailhead keeps a two-step escape hatch behind the `trailhead()` one-liner:

1. `build*` — derive the trailhead representation from a topo
2. `to*` or `connect*` — wire to the runtime

| Verb | Meaning | Returns | Lifecycle |
| --- | --- | --- | --- |
| `to*` | Transform into a library-specific runtime object | The object | Developer controls |
| `connect*` | Wire to a transport and start it | `void` or a handle | Framework controls |

```text
CLI:  buildCliCommands(topo) -> toCommander(commands) -> program.parse()
MCP:  buildMcpTools(topo)    -> connectStdio(server)
HTTP: buildHttpRoutes(topo)  -> toHono(routes) -> app.listen(3000)
```

`trailhead()` collapses the full sequence into one call.

### Don't namespace what package scope provides

Package imports provide enough scoping. No `trails.*` or `core.*` namespace object is needed just to compensate for weak naming.

### `derive*` for framework derivations

Derivations keep the `derive*` prefix.

```typescript
deriveFields(schema);
deriveFlags(trail);
deriveToolName(trail);
deriveAnnotations(trail);
```

### `validate*` for contract verification

Validation helpers keep the `validate*` prefix and return `Result`.

```typescript
validateInput(schema, data);
validateOutput(schema, data);
validateTopo(topo);
```

Principle: Zod is the schema authoring language. Trails is the validation language. You write schemas in Zod, you validate with Trails.

### Zod is authoring, Trails is everything else

Zod remains the schema authoring language. Trails owns the surrounding language for execution, validation, derivation, and runtime wiring.

## Consequences

### Positive

- **Guessable API.** A contributor who knows the conventions can predict function names before looking them up.
- **One vocabulary family.** Trail, blaze, topo, trailhead, cross, provision, signal, gate, tracker, and warden belong to the same story.
- **Docs and scaffolding get simpler.** We stop teaching a mix of branded and generic conceptual nouns.
- **Drift resistance.** Naming now follows the same author/derive/declare discipline as the rest of the framework.
- **Agent-friendly.** The API becomes easier to consume from names alone, with less contextual reasoning.

### Tradeoffs

- **This is a broad rewrite.** File names, exports, docs, tests, and architecture terms all move together.
- **Some nouns are less familiar than the generic alternatives.** That is acceptable because the system becomes more coherent once the vocabulary is learned.
- **A few swaps require deliberate sequencing.** `run` and `blaze` trade meanings, and `signal` must stop meaning `AbortSignal` before it can mean notifications.

### What this does NOT decide

- Specific per-package migration mechanics
- Whether a temporary bridge name is used inside a branch-local codemod
- Future concepts that do not yet have a stable public shape

## References

- [ADR-0000: Core Premise](0000-core-premise.md)
- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md)
- [ADR-0013: Tracker](0013-crumbs.md)
- [API Reference](../api-reference.md)
- [Vocabulary](../vocabulary.md)
