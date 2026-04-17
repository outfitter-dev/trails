---
id: 29
slug: connector-extraction-and-the-with-packaging-model
title: Connector Extraction and Composition Around Core Contracts
status: accepted
created: 2026-04-09
updated: 2026-04-16
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9, 16, 22, 23]
---

# ADR-0029: Connector Extraction and Composition Around Core Contracts

## Context

### Extraction solved the coupling problem

The original problem still stands: when connector code lives as a subpath inside
an owning package, dependency and release boundaries blur. `@ontrails/store`
should not need to ship Drizzle. `@ontrails/http` should not need to own every
host framework. Extracting integrations into dedicated workspace packages fixed
that part of the story, and the one-way dependency arrow remains correct.

### The `with-*` prefix did not survive the packaging sweep

What did not survive was the idea that every extracted integration should use a
`with-*` prefix. Once the repo gained sharper composition layers, the prefix
stopped helping:

- `@ontrails/drizzle` is clearer than `@ontrails/with-drizzle`
- `@ontrails/hono` is clearer than `@ontrails/with-hono`
- `@ontrails/vite` is clearer than `@ontrails/with-vite`

The important architectural fact is that the integration is extracted and
composes around a core contract, not that its name can be read as a sentence.

### Connectors and adapters now layer around surfaces

Trails now has multiple composition layers around a graph:

- pure contract packages such as `@ontrails/store` and `@ontrails/http`
- extracted bindings such as `@ontrails/drizzle` and `@ontrails/hono`
- runtime adapters such as `@ontrails/vite`, which layer on top of an
  already-created surface runtime

The packaging model needs to describe those layers without inventing a new rule
for every case.

### What "connector" means

A connector still bridges a Trails app with an external system, library, or
platform. "Adapter" remains useful as a scope word for thinner runtime layers,
but not as a separate top-level category with different governance rules. The
repo can host both heavier connectors and thinner adapters inside the same
extracted boundary model.

## Decision

### Connectors stay extracted into `connectors/`

Extracted integrations that deserve their own dependency and release boundaries
live as workspace packages under `connectors/`:

```text
packages/       framework contracts and pure projections
connectors/     extracted bindings and runtime adapters
apps/           applications
```

This provides:

- **One-way dependency arrows.** Extracted integrations depend on core
  contracts. Core contracts never depend on extracted integrations.
- **Independent release cadence.** A Hono or Drizzle change does not force a
  publish of the contract package that it binds to.
- **Clearer contribution boundaries.** New integrations can land without
  changing the owning contract package's exports or internals.

### Names follow the owned integration, not a prefix

Extracted integration packages are named for the thing they bind to, not for a
`with-*` sentence pattern:

```text
@ontrails/drizzle   Drizzle store binding
@ontrails/hono      Hono HTTP surface
@ontrails/vite      Vite runtime adapter
```

The repo location already tells us these are extracted integrations. The
package name should answer "what integration is this?" rather than "can I put
the word 'with' in front of it?"

### Composition follows responsibility, not symmetry

Package shape is driven by what a package owns, not by a mandatory two-package
template.

| Role | Package | Responsibility |
| --- | --- | --- |
| Core contract | `@ontrails/store` | Store declaration and schema-derived contract |
| Extracted binding | `@ontrails/drizzle` | Bind the store contract to Drizzle |
| Pure projection | `@ontrails/http` | Derive framework-agnostic route definitions |
| Surface runtime | `@ontrails/hono` | Materialize and serve a Hono app from those routes |
| Runtime adapter | `@ontrails/vite` | Adapt an already-created Hono app to Vite middleware |
| Tight subpath binding | `@ontrails/cli/commander` | Commander-specific CLI runtime without another top-level package |

Some integrations are worth a standalone package. Some stay as subpaths because
splitting them further would add ceremony without buying a new dependency or
governance boundary. The rule is architectural clarity, not symmetry.

### First-party built-in store backends stay under `@ontrails/store/*`

Some backends are part of the store story itself: local, first-party, opt-in
backends that ship with no third-party integration boundary and primarily exist
to make the contract useful quickly. Those stay as subpath exports on the
owning package:

```text
@ontrails/store/jsonfile      first-party file-backed store
@ontrails/store/bun-sqlite    reserved for a future Bun-native SQLite store
```

This is an explicit carve-out, not a loophole. The rule becomes:

- `@ontrails/store` root stays connector-agnostic.
- `@ontrails/store/*` is reserved for first-party built-in backends owned by the
  store package.
- `connectors/` packages are reserved for extracted integrations that bind core
  contracts to external libraries or runtimes.

That preserves the one-way dependency arrow at the root package while still
letting Trails ship "quick win" backends as part of the first-party store
experience.

### Connectors and adapters can stack

An extracted package can bind a core contract directly, or it can layer on top
of another extracted surface:

```typescript
import { createApp } from '@ontrails/hono';
import { vite } from '@ontrails/vite';

server.middlewares.use('/api', vite(createApp(graph)));
```

The Vite package does not invent a second HTTP contract. It adapts the Hono
surface that already exists. This stacking model is part of the connector
composition story.

### Migration from subpaths to extracted packages

| Current | Becomes |
| --- | --- |
| `@ontrails/store/drizzle` | `@ontrails/drizzle` |
| `@ontrails/http/hono` | `@ontrails/hono` |
| `@ontrails/with-jsonfile` | `@ontrails/store/jsonfile` |

This is a breaking change in import paths for extracted integrations. First
party built-in store backends remain available as opt-in `@ontrails/store/*`
subpaths.

### The resource and surface boundaries are unchanged

The `resource()` primitive[^1] is still the stable seam for infrastructure.
Extracted packages produce resources or materialize surfaces. Trails consume
resources. Graphs still derive projections and open boundaries the same way.
Nothing about trail contracts changes because connector code moved.

```typescript
// Before: connector lives in store package
import { connectDrizzle } from '@ontrails/store/drizzle';
const notesDb = connectDrizzle(definition, { url: './notes.sqlite' });

// After: connector lives in its own package
import { connectDrizzle } from '@ontrails/drizzle';
const notesDb = connectDrizzle(definition, { url: './notes.sqlite' });
```

The return type is identical. The topo registration is identical. The trail's `resources: [...]` declaration doesn't change.

## Non-goals

- **Defining the connector lifecycle contract.** How a connector declares what it bridges, what lifecycle hooks it supports, and how it reports health — that's a separate decision. This ADR moves the code. Resource bundling is covered by [ADR: Resource Bundles](drafts/20260409-resource-bundles.md) (draft); lifecycle hooks remain open.
- **Connector scaffolding.** A `trails create connector` command is desirable but not part of this decision.
- **Trail factories on connectors.** Connectors may eventually export trails via
  a `/trails` subpath (for example `@ontrails/cloudflare/trails`). That's a
  separate decision that depends on the `deriveTrail()` design.
- **Forcing every runtime binding into its own top-level package.** Some
  bindings may stay as subpaths when there is no meaningful architectural
  boundary to extract.
- **Profile-based connector selection.** How a deployment profile chooses which connector backs which resource is a configuration concern, not a packaging concern.

## Consequences

### Positive

- **Core packages become cleaner contracts.** `@ontrails/store` owns the store
  contract. `@ontrails/http` owns the route projection contract. Extracted
  integrations stop expanding those packages' dependency and release scope.
- **Built-in backends stay discoverable.** A developer can start with `@ontrails/store/jsonfile` without learning the external connector catalog first.
- **Independent release cadence.** Extracted integrations version and publish
  independently. A Hono or Drizzle update does not block a contract change.
- **Runtime adapters can stack.** Packages such as `@ontrails/vite` can compose
  above an extracted surface without inventing a second projection model.
- **Clear dependency direction.** The one-way arrow from extracted integrations
  to core contracts is enforceable at the workspace level.

### Tradeoffs

- **Migration cost.** Existing imports of extracted integrations must change.
  This is mechanical but repo-wide.
- **More packages to maintain.** Each extracted integration is a workspace
  package with its own `package.json`, build config, and test suite.
- **The package taxonomy is less mechanical.** There is no single prefix that
  identifies every extracted integration. The payoff is that package names are
  clearer, but the model must be explained in docs.

## Non-decisions

- **Whether `connector()` becomes a framework primitive.** Platform connectors with shared lifecycle might benefit from framework-level support, but the bar for new primitives is high[^2]. This ADR extracts connectors without deciding their runtime shape.
- **How trails subpaths work on connectors.** Connectors that contribute trails
  (health checks, platform-optimized operations) may export them at
  `@ontrails/<connector>/trails`. The design depends on
  [ADR-0030: Contours as First-Class Domain Objects](0030-contours-as-first-class-domain-objects.md)
  and the `deriveTrail()` helper.
- **Connector lifecycle hooks.** How connectors report readiness, perform health checks, and handle graceful shutdown. Resource bundling is addressed by [ADR: Resource Bundles](drafts/20260409-resource-bundles.md) (draft); lifecycle hooks remain deferred.

## References

- [ADR-0009: First-Class Resources](0009-first-class-resources.md) — the `resource()` primitive that connectors produce and trails consume
- [ADR-0016: Schema-Derived Persistence](0016-schema-derived-persistence.md) — the store contract that connectors bind to concrete backends
- [ADR-0022: Drizzle Binds Schema-Derived Stores to SQLite](0022-drizzle-store-connector.md) — the first extracted store binding that motivated the packaging model
- [ADR-0023: Simplifying the Trails Lexicon](0023-simplifying-the-trails-lexicon.md) — the naming heuristic that now favors clear owned-integration names over prefix magic
- [ADR-0035: Surface APIs Render the Graph](0035-surface-apis-render-the-graph.md) — the surface composition ladder that extracted runtime adapters build on
- [ADR-0030: Contours as First-Class Domain Objects](0030-contours-as-first-class-domain-objects.md) — upstream of the `/trails` subpath design on connectors
- [ADR-0031: Backend-Agnostic Store Schemas](0031-backend-agnostic-store-schemas.md) — the store-kind model that makes first-party backends meaningful
- [ADR: Resource Bundles](drafts/20260409-resource-bundles.md) (draft) — the bundling mechanism for connector and pack resources

### Amendment log

- 2026-04-16: In-place vocabulary update per ADR-0035 Cutover 3 — title updated to drop `with-*` prefix convention, naming rules revised for extracted connectors, migration table and composition layer table aligned with surface API grammar.

[^1]: [ADR-0009: First-Class Resources](0009-first-class-resources.md)
[^2]: See the evaluation hierarchy in [Tenets: Primitives](../tenets.md#the-bar-for-new-primitives)
