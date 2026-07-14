---
id: 29
slug: connector-extraction-and-the-with-packaging-model
title: Adapter Extraction and Composition Around Core Contracts
status: accepted
created: 2026-04-09
updated: 2026-06-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [5, 9, 16, 22, 23]
---

# ADR-0029: Adapter Extraction and Composition Around Core Contracts

The historical slug is preserved for reference stability. The 2026-05-08 amendment retires `connector` as the public package taxonomy term while preserving this ADR's extraction model.

## Context

### Extraction solved the coupling problem

The original problem still stands: when adapter code lives as a subpath inside an owning package, dependency and release boundaries blur. `@ontrails/store` should not need to ship Drizzle. `@ontrails/http` should not need to own every host framework. Extracting adapters into dedicated workspace packages fixed that part of the story, and the one-way dependency arrow remains correct.

### The `with-*` prefix did not survive the packaging sweep

What did not survive was the idea that every extracted adapter should use a `with-*` prefix. Once the repo gained sharper composition layers, the prefix stopped helping:

- `@ontrails/drizzle` is clearer than `@ontrails/with-drizzle`
- `@ontrails/hono` is clearer than `@ontrails/with-hono`
- `@ontrails/vite` is clearer than `@ontrails/with-vite`

The important architectural fact is that the adapter is extracted and composes around a core contract, not that its name can be read as a sentence.

### Adapter is the public category

Trails now has multiple composition layers around a graph:

- pure contract packages such as `@ontrails/store` and `@ontrails/http`
- extracted adapters such as `@ontrails/drizzle` and `@ontrails/hono`
- composed adapters such as `@ontrails/vite`, which layer on top of an
  already-created surface runtime

The packaging model needs to describe those layers without inventing a new rule for every case.

### What "adapter" means

An adapter bridges Trails contracts to a named external system, library, framework, tool, platform, format, or ecosystem. The distinction between materializing a surface and translating a record is descriptive, not categorical: Hono, Commander, Drizzle, LogTape, JWT, and OTel all sit at boundary points and follow the same packaging discipline.

`integration` remains available as colloquial English. It is not a second public taxonomy category. `trailhead` names grouped surface entries, and `schema facet` remains descriptive schema-slice prose; neither term names package or subpath boundaries.

## Decision

### Adapters stay extracted into `adapters/`

Extracted adapters that deserve their own dependency and release boundaries live as workspace packages under `adapters/`. The 2026-05 connector-to-adapter cutover migrates the historical `connectors/` workspace root to this shape:

```text
packages/       framework contracts and pure projections
adapters/       extracted adapters and runtime adapters
apps/           applications
```

This provides:

- **One-way dependency arrows.** Extracted adapters depend on core contracts.
  Core contracts never depend on extracted adapters.
- **Independent release cadence.** A Hono or Drizzle change does not force a
  publish of the contract package that it binds to.
- **Clearer contribution boundaries.** New adapters can land without changing
  the owning contract package's exports or internals.

### Names follow the owned adapter, not a prefix

Extracted adapter packages are named for the thing they bind to, not for a `with-*` sentence pattern:

```text
@ontrails/drizzle    Drizzle store adapter
@ontrails/hono       Hono HTTP adapter
@ontrails/vite       Vite runtime adapter
```

The repo location already tells us these are extracted adapters. The package name should answer "what does this adapt?" rather than "can I put the word 'with' in front of it?"

### Composition follows responsibility, not symmetry

Package shape is driven by what a package owns, not by a mandatory two-package template.

| Role | Package | Responsibility |
| --- | --- | --- |
| Core contract | `@ontrails/store` | Store declaration and schema-derived contract |
| Extracted adapter | `@ontrails/drizzle` | Bind the store contract to Drizzle |
| Pure projection | `@ontrails/http` | Derive framework-agnostic route definitions |
| Surface runtime | `@ontrails/hono` | Materialize and serve a Hono app from those routes |
| Runtime adapter | `@ontrails/vite` | Adapt an already-created Hono app to Vite middleware |
| Adapter subpath, pre-split | `@ontrails/cli/commander` | Commander-specific CLI runtime; beta.16 moves this to `@ontrails/commander` |

Some adapters are worth a standalone package. Some stay as subpaths because splitting them further would add ceremony without buying a new dependency or governance boundary. The rule is architectural clarity, not symmetry.

### First-party built-in store backends stay under `@ontrails/store/*`

Some backends are part of the store story itself: local, first-party, opt-in backends that ship with no third-party adapter boundary and primarily exist to make the contract useful quickly. Those stay as subpath exports on the owning package:

```text
@ontrails/store/jsonfile      first-party file-backed store
@ontrails/store/bun-sqlite    reserved for a future Bun-native SQLite store
```

This is an explicit carve-out, not a loophole. The rule becomes:

- `@ontrails/store` root stays backend-agnostic.
- `@ontrails/store/*` is reserved for first-party built-in backends owned by the
  store package.
- `adapters/` packages are reserved for extracted adapters that bind core
  contracts to external libraries, frameworks, tools, or runtimes.

That preserves the one-way dependency arrow at the root package while still letting Trails ship "quick win" backends as part of the first-party store experience.

### Built-in runtime materializers may stay under the owning surface package

The same dependency test applies to runtime surface materializers:

- A runtime materializer that depends only on platform built-ins may live as a
  subpath of the owning projection package.
- A runtime materializer that binds Trails to a third-party framework, library,
  or ecosystem gets an extracted adapter package.

That distinction keeps `derive*` projection APIs pure without forcing every `create*` helper into a top-level package. A projection answers, "what does this graph look like on this surface?" A materializer answers, "how do I run that projection on this host runtime?"

For HTTP:

```text
@ontrails/http        deriveHttpRoutes(graph)
@ontrails/http/fetch  createFetchHandler(graph), createRouteHandler(route)
@ontrails/http/bun    createApp(graph), surface(graph)
@ontrails/hono        createApp(graph), surface(graph)
```

`@ontrails/http/fetch` uses Web Standard `Request` and `Response`, which are runtime boundary types rather than a third-party framework. It can therefore live under `@ontrails/http` without weakening the HTTP route model:

- [ADR-0005: Framework-Agnostic HTTP Route Model](0005-framework-agnostic-http-route-model.md) — `deriveHttpRoutes` continues to expose a framework-agnostic route projection, while the `./fetch` subpath exposes a reusable Web Fetch materializer for adapters and runtimes.

`@ontrails/http/bun` uses Bun's built-in `Bun.serve` routes table. It adds a Bun runtime requirement but no package dependency on a third-party framework, so it stays as a subpath on `@ontrails/http`. A standalone `@ontrails/bun` package would add package ceremony without buying a new dependency or governance boundary.

`@ontrails/hono` remains extracted because Hono is a third-party framework and a real dependency boundary. It composes over `@ontrails/http/fetch` rather than duplicating Web request parsing, error projection, webhook handling, or diagnostics.

This rule does not imply a standalone package for every vendor-named adapter. For example, v1 OTel support remains at `@ontrails/observability/otel` unless the implementation needs a hard OpenTelemetry SDK dependency or a separate release boundary.

### Adapters can stack

An extracted package can bind a core contract directly, or it can layer on top of another extracted surface:

```typescript
import { createApp } from '@ontrails/hono';
import { vite } from '@ontrails/vite';

server.middlewares.use('/api', vite(createApp(graph)));
```

The Vite package does not invent a second HTTP contract. It adapts the Hono surface that already exists. This stacking model is part of the adapter composition story.

### Migration from subpaths to extracted packages

| Current | Becomes |
| --- | --- |
| `@ontrails/store/drizzle` | `@ontrails/drizzle` |
| `@ontrails/http/hono` | `@ontrails/hono` |
| `@ontrails/with-jsonfile` | `@ontrails/store/jsonfile` |

This is a breaking change in import paths for extracted adapters. First party built-in store backends remain available as opt-in `@ontrails/store/*` subpaths.

### The resource and surface boundaries are unchanged

The `resource()` primitive[^1] is still the stable seam for infrastructure. Extracted packages produce resources or materialize surfaces. Trails consume resources. Graphs still derive projections and open boundaries the same way. Nothing about trail contracts changes because adapter code moved.

```typescript
// Before: adapter lives in store package
import { connectDrizzle } from '@ontrails/store/drizzle';
const notesDb = connectDrizzle(definition, { url: './notes.sqlite' });

// After: adapter lives in its own package
import { connectDrizzle } from '@ontrails/drizzle';
const notesDb = connectDrizzle(definition, { url: './notes.sqlite' });
```

The return type is identical. The topo registration is identical. The trail's `resources: [...]` declaration doesn't change.

## Non-goals

- **Defining the adapter lifecycle contract.** How an adapter declares what it bridges, what lifecycle hooks it supports, and how it reports health — that's a separate decision. This ADR moves package boundaries. Resource bundling is covered by [ADR: Resource Bundles](drafts/20260409-resource-bundles.md) (draft); lifecycle hooks remain open.
- **Adapter scaffolding.** A `trails create adapter` command is desirable but not part of this decision.
- **Trail factories on adapters.** Adapters may eventually export trails via
  a `/trails` subpath (for example `@ontrails/cloudflare/trails`). That's a
  separate decision that depends on the `deriveTrail()` design.
- **Forcing every runtime binding into its own top-level package.** Some
  bindings may stay as subpaths when there is no meaningful architectural
  boundary to extract.
- **Profile-based adapter selection.** How a deployment profile chooses which adapter backs which resource is a configuration concern, not a packaging concern.

## Consequences

### Positive

- **Core packages become cleaner contracts.** `@ontrails/store` owns the store
  contract. `@ontrails/http` owns the route projection contract. Extracted
  adapters stop expanding those packages' dependency and release scope.
- **Built-in backends stay discoverable.** A developer can start with `@ontrails/store/jsonfile` without learning the external adapter catalog first.
- **Independent release cadence.** Extracted adapters version and publish
  independently. A Hono or Drizzle update does not block a contract change.
- **Runtime adapters can stack.** Packages such as `@ontrails/vite` can compose
  above an extracted surface without inventing a second projection model.
- **Clear dependency direction.** The one-way arrow from extracted adapters
  to core contracts is enforceable at the workspace level.

### Tradeoffs

- **Migration cost.** Existing imports of extracted adapters must change.
  This is mechanical but repo-wide.
- **More packages to maintain.** Each extracted adapter is a workspace
  package with its own `package.json`, build config, and test suite.
- **The package taxonomy is less mechanical.** There is no single prefix that
  identifies every extracted adapter. The payoff is that package names are
  clearer, but the model must be explained in docs.

## Non-decisions

- **Whether `adapter()` becomes a framework primitive.** Platform adapters with shared lifecycle might benefit from framework-level support, but the bar for new primitives is high[^2]. This ADR extracts adapters without deciding their runtime shape.
- **How trails subpaths work on adapters.** Adapters that contribute trails
  (health checks, platform-optimized operations) may export them at
  `@ontrails/<adapter>/trails`. The design depends on
  [ADR-0030: Contours as First-Class Domain Objects](0030-contours-as-first-class-domain-objects.md)
  and the `deriveTrail()` helper.
- **Adapter lifecycle hooks.** How adapters report readiness, perform health checks, and handle graceful shutdown. Resource bundling is addressed by [ADR: Resource Bundles](drafts/20260409-resource-bundles.md) (draft); lifecycle hooks remain deferred.

## References

- [ADR-0009: First-Class Resources](0009-first-class-resources.md) — the `resource()` primitive that adapters produce and trails consume
- [ADR-0016: Schema-Derived Persistence](0016-schema-derived-persistence.md) — the store contract that adapters bind to concrete backends
- [ADR-0022: Drizzle Binds Schema-Derived Stores to SQLite](0022-drizzle-store-connector.md) — the first extracted store binding that motivated the packaging model
- [ADR-0023: Simplifying the Trails Lexicon](0023-simplifying-the-trails-lexicon.md) — the naming heuristic that now favors clear owned-adapter names over prefix magic
- [ADR-0035: Surface APIs Render the Graph](0035-surface-apis-render-the-graph.md) — the surface composition ladder that extracted runtime adapters build on
- [ADR-0005: Framework-Agnostic HTTP Route Model](0005-framework-agnostic-http-route-model.md) — the HTTP projection model that `@ontrails/http/fetch` and `@ontrails/http/bun` now materialize without turning `deriveHttpRoutes` into a framework adapter
- [ADR-0030: Contours as First-Class Domain Objects](0030-contours-as-first-class-domain-objects.md) — upstream of the `/trails` subpath design on adapters
- [ADR-0031: Backend-Agnostic Store Schemas](0031-backend-agnostic-store-schemas.md) — the store-kind model that makes first-party backends meaningful
- [ADR: Resource Bundles](drafts/20260409-resource-bundles.md) (draft) — the bundling mechanism for adapter and pack resources

### Amendment log

- 2026-04-16: In-place vocabulary update per ADR-0035 Cutover 3 — title updated to drop `with-*` prefix convention, naming rules revised for extracted connectors, migration table and composition layer table aligned with surface API grammar.
- 2026-05-08: Connector-to-adapter taxonomy cutover — `adapter` becomes the canonical public package category, `integration` is retained only as colloquial prose, and the historical `connectors/` workspace root is superseded by `adapters/`. Later v1 vocabulary work moved grouped surface entries to `trailhead`.
- 2026-05-16: Web Fetch kernel amendment — runtime materializers with no third-party dependency may stay as subpaths on the owning projection package, covering `@ontrails/http/fetch` and `@ontrails/http/bun` while preserving `@ontrails/hono` as the extracted Hono adapter.
- 2026-06-09: Binding vocabulary note — this ADR's built-in-materializer vs extracted-adapter distinction is the `native binding` vs `adapter binding` distinction now defined in [the lexicon](../lexicon.md#binding); the dependency-boundary test in this ADR sets the kind.

[^1]: [ADR-0009: First-Class Resources](0009-first-class-resources.md)
[^2]: See the evaluation hierarchy in [Tenets: Primitives](../tenets.md#the-bar-for-new-primitives)
