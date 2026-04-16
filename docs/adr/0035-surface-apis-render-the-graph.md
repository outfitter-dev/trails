---
id: 35
slug: surface-apis-render-the-graph
title: Surface APIs Render the Graph
status: accepted
created: 2026-04-16
updated: 2026-04-16
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, 5, 6, 8, 29]
---

# ADR-0035: Surface APIs Render the Graph

## Context

### `trailhead` stopped naming one thing

Before the surface cutover, `trailhead` simultaneously meant:

- the conceptual boundary where a graph became externally reachable
- the one-liner helper that started that boundary
- the derived artifact underneath that helper

The helper verbs made that blur worse. `buildCliCommands()` and
`buildHttpRoutes()` did not "build" mutable runtime objects. They projected a
deterministic surface definition from a graph. Then separate helpers such as
`toCommander()` or `connectStdio()` handled the last mile into a host runtime.
The naming made the API look more stateful and connector-specific than it
really was.

That mismatch became harder to ignore once the package graph sharpened.
`@ontrails/http` exists to derive framework-agnostic route definitions.
`@ontrails/hono` exists to materialize and serve a Hono app.
`@ontrails/vite` composes on top of an already-created app rather than
deriving a second HTTP model. The architecture has layers. The names should
reveal them.

### We need the same question sequence on every boundary

For every boundary-facing package, developers and agents now ask the same three
questions:

1. Can I inspect the projected shape without starting anything?
2. Can I materialize a host object and keep lifecycle ownership?
3. Can I let Trails own the whole boundary for me?

The API should answer those questions with the same verbs across CLI, MCP,
HTTP, and future surfaces.

## Decision

### `surface()` is the boundary-owned one-liner

A **surface** is the package-owned rendering of a graph for an external
boundary. `surface(graph)` is the high-level helper that takes lifecycle
ownership of that boundary.

This means:

- CLI `surface(graph)` parses argv
- MCP `surface(graph)` creates the server and connects stdio
- Hono `surface(graph)` creates the app and starts serving it

`surface()` is intentionally effectful. It exists for the "just open this
graph" path.

### `derive*` names deterministic projections

When a helper returns a framework-agnostic projected shape from a graph, it
uses `derive*` and returns `Result`.

```text
deriveCliCommands(graph)
deriveMcpTools(graph)
deriveHttpRoutes(graph)
```

These functions do not start transports or mutate runtime state. They project
contract data into surface-specific definitions. If projection fails because of
validation or collisions, the failure is reported as `Result.err(...)` at the
derivation boundary.

The test: if the function is answering "what would this graph look like on this
surface?", it is a derivation.

### `create*` names runtime materialization without opening the boundary

When a helper creates a host-library runtime object but stops short of opening
it to the outside world, it uses `create*`.

```text
createProgram(graph)   -> Commander program
createServer(graph)    -> MCP Server instance
createApp(graph)       -> Hono app
```

`create*` materializes a runtime instance. It may fail fast by throwing if the
graph cannot produce a valid projection. That does not weaken the
"implementations return Result" rule from
[ADR-0000](0000-core-premise.md). The purity rule governs trail execution.
`create*` lives at startup and runtime ownership boundaries, not inside trail
logic.

### The public story is `derive` -> `create` -> `surface`

Every surface now follows the same conceptual ladder:

| Layer | Verb | Responsibility | Side effects |
| --- | --- | --- | --- |
| Projection | `derive*` | Render the graph into a surface-specific definition | None |
| Materialization | `create*` | Create a host runtime object from that definition | Local object creation only |
| Ownership | `surface()` | Open the boundary and own the lifecycle | Yes |

Examples:

```text
CLI:  deriveCliCommands(graph) -> createProgram(graph) -> surface(graph)
MCP:  deriveMcpTools(graph)    -> createServer(graph)  -> surface(graph)
HTTP: deriveHttpRoutes(graph)  -> createApp(graph)     -> surface(graph)
```

Not every surface must expose every rung as a separate package. The rule is
semantic, not structural. `@ontrails/http` and `@ontrails/hono` split
projection from runtime materialization because the split is useful.
`@ontrails/mcp` keeps both in one package because there is no smaller reusable
layer below the server itself.

### `to*` remains a thin translation verb, not the main storyline

Helpers such as `toCommander(commands)` remain valid when a package needs a
narrow translation from a projected definition into a library-specific object.
They are escape hatches, not the primary conceptual path.

The docs, scaffolding, and examples should tell the story as `derive*`,
`create*`, and `surface()`. `to*` is for specific composition points, not for
explaining the framework.

### `graph` is the canonical local name for a topo instance

The primitive stays `topo()`. The local value it returns should be named
`graph` in active docs and examples:

```typescript
const graph = topo('myapp', entityModule);
await surface(graph);
```

`topo()` names the primitive. `graph` names the thing returned by it. That
matches the tenet that the resolved graph is the story.

### Runtime adapters compose on created surfaces, not by inventing new projections

A runtime adapter that layers on top of an existing surface runtime should
compose above `create*` rather than deriving a parallel contract model.

```typescript
import { createApp } from '@ontrails/hono';
import { vite } from '@ontrails/vite';

server.middlewares.use('/api', vite(createApp(graph)));
```

The Vite adapter does not derive a second HTTP projection. It adapts an
already-created Hono surface into another host environment. That keeps the
concept count flat.

## Consequences

### Positive

- Developers and agents can ask the same three questions on every boundary:
  derive, create, or surface.
- Projection helpers now read as pure derivations instead of pseudo-builders.
- The API makes lifecycle ownership visible. `surface()` owns it. `create*`
  returns it. `derive*` avoids it.
- Runtime adapters such as Vite compose without requiring a new primitive or a
  parallel derivation layer.

### Tradeoffs

- The public story gains one more noun. `surface` and `projection` are more
  precise than `trailhead`, but they require a vocabulary pass across docs.
- The API is less romantic than the original all-in-one `trailhead()` story.
  That loss of poetry is acceptable because the runtime boundaries are clearer.
- `derive*` returning `Result` while `create*` may throw introduces a
  deliberate split. The split is worth it because the failure modes happen at
  different layers.

## Non-goals

- Renaming the `topo()` primitive itself
- Forcing every boundary to split across multiple packages
- Removing useful `to*` helpers where they already fit a host library cleanly
- Deciding the WebSocket surface shape or naming ahead of that implementation

## Non-decisions

- Whether future surfaces such as WebSocket expose all three rungs as separate
  public APIs
- Whether every connector package should eventually support additional runtime
  adapters
- How connector-contributed trails and platform bundles should present their
  own surface helpers

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — the trail is the product;
  the resolved graph is the story
- [ADR-0001: Naming Conventions](0001-naming-conventions.md) — the verb and
  grammar rules this ADR extends
- [ADR-0005: Framework-Agnostic HTTP Route Model](0005-framework-agnostic-http-route-model.md)
  — the route projection model that stays pure under `deriveHttpRoutes`
- [ADR-0006: Shared Execution Pipeline with Result-Returning Builders](0006-shared-execution-pipeline.md)
  — `Result` remains the execution contract even as surface startup helpers stay
  effectful
- [ADR-0008: Deterministic Trailhead Derivation](0008-deterministic-trailhead-derivation.md)
  — surface projections are deterministic renderings of the graph
- [ADR-0029: Connector Extraction and Composition Around Core Contracts](0029-connector-extraction-and-the-with-packaging-model.md)
  — package boundaries and composition layers around extracted connectors
- [API Reference](../api-reference.md) — the concrete public API that this ADR
  explains
