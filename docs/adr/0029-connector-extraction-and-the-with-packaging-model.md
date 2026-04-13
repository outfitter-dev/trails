---
id: 29
slug: connector-extraction-and-the-with-packaging-model
title: Connector Extraction and the with-* Packaging Model
status: accepted
created: 2026-04-09
updated: 2026-04-13
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9, 16, 22, 23]
---

# ADR-0029: Connector Extraction and the with-* Packaging Model

## Context

### The coupling problem

Connectors currently live as subpaths inside core packages: `@ontrails/store/drizzle`, `@ontrails/cli/commander`, `@ontrails/http/hono`. This means `@ontrails/store` has `drizzle-orm` as a peer dependency. `@ontrails/cli` has `commander`. A developer who wants the store contract but uses a different ORM still pulls Drizzle into their dependency tree.

The coupling runs deeper than dependencies. Connector code lives alongside framework internals, making it harder to reason about the boundary between "what the framework guarantees" and "what a specific integration provides." A bug fix in the Drizzle connector triggers a publish of the entire store package. A new connector means modifying a core package's exports.

### What "connector" means

A connector bridges a Trails app with an external system, library, or platform. The term was underspecified — doing double duty as both the integration bridge and the wiring verb (`connectDrizzle()`). "Adapter" was considered as an alternative. The ecosystem uses "adapter" for thin translation layers (Prisma adapters, NextAuth adapters, SvelteKit adapters) and "connector" for richer platform integrations (Kafka Connect, Airbyte, Fivetran, MuleSoft). Splitting into "adapter" (simple) and "connector" (platform) was rejected — two terms for one concept. "Connector" covers the full range.

## Decision

### External connectors use `with-*` naming

Every external or platform connector gets its own package under the `@ontrails/with-*` namespace:

```text
@ontrails/with-drizzle        Drizzle ORM connector
@ontrails/with-hono           Hono HTTP connector
@ontrails/with-commander      Commander CLI connector
@ontrails/with-cloudflare     Cloudflare platform connector
```

Reads as a sentence: *"My Trails app, with Cloudflare."* The dependency list becomes a description of the app's technology choices:

```json
{
  "dependencies": {
    "@ontrails/core": "^1.0.0",
    "@ontrails/store": "^1.0.0",
    "@ontrails/with-cloudflare": "^1.0.0",
    "@ontrails/with-drizzle": "^1.0.0"
  }
}
```

"This app uses Trails core and store, with Cloudflare and Drizzle."

### First-party built-in store backends stay under `@ontrails/store/*`

`with-*` is the right home for integrations that bridge Trails to an external
library, service, or platform. It is not the right home for every concrete
runtime.

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
- `@ontrails/with-*` is reserved for external adapters and platform bindings.

That preserves the one-way dependency arrow at the root package while still
letting Trails ship "quick win" backends as part of the first-party store
experience.

### Simple and platform connectors

The distinction is scope, not kind:

- **Simple connectors** bridge a single interface: Hono for HTTP, Drizzle for database, Commander for CLI.
- **Platform connectors** provide multiple bridges from shared configuration: Cloudflare (D1 + R2 + KV + Durable Objects), Firebase (Firestore + Storage + Auth), Supabase (Postgres + Storage + Auth + Realtime).

Platform connectors expose sub-capabilities as subpath exports:

```typescript
import { createCloudflare } from '@ontrails/with-cloudflare';
import { d1 } from '@ontrails/with-cloudflare/d1';
import { r2 } from '@ontrails/with-cloudflare/r2';
import { kv } from '@ontrails/with-cloudflare/kv';
```

The developer doesn't need a different mental model. Some connectors provide more capabilities than others.

### `connectors/` as a top-level directory

```text
packages/       framework core (@ontrails/core, @ontrails/store, etc.)
connectors/     integration bridges (@ontrails/with-*)
apps/           applications
```

Each connector is its own workspace package. This provides:

- **Pure core packages.** `@ontrails/store` defines the persistence contract with zero third-party deps. `@ontrails/cli` defines the CLI contract without `commander`.
- **One-way dependency arrow.** Connectors depend on core packages + their third-party library. Core packages never depend on connectors.
- **Independent versioning.** A Hono major version bump doesn't publish the Drizzle connector.
- **Governance boundary.** `packages/` gets tight maintainer review via CODEOWNERS. `connectors/` has a lower contribution bar — community members can own specific connectors without understanding framework internals.

### Migration from subpaths and the store carve-out

| Current | Becomes |
| --- | --- |
| `@ontrails/store/drizzle` | `@ontrails/with-drizzle` |
| `@ontrails/with-jsonfile` | `@ontrails/store/jsonfile` |
| `@ontrails/cli/commander` | `@ontrails/with-commander` |
| `@ontrails/http/hono` | `@ontrails/with-hono` |

This is a breaking change in import paths. External connector subpaths in core
packages are removed. First-party built-in store backends remain available as
opt-in `@ontrails/store/*` subpaths.

### The resource boundary is unchanged

The `resource()` primitive[^1] is the stable seam. Connectors produce resources. Trails consume resources. Nothing about how trails interact with resources changes — only where connector code lives and how it's packaged.

```typescript
// Before: connector lives in store package
import { drizzle } from '@ontrails/store/drizzle';
const notesDb = drizzle(db, { url: './notes.sqlite' });

// After: connector lives in its own package
import { drizzle } from '@ontrails/with-drizzle';
const notesDb = drizzle(db, { url: './notes.sqlite' });
```

The return type is identical. The topo registration is identical. The trail's `resources: [...]` declaration doesn't change.

## Non-goals

- **Defining the connector lifecycle contract.** How a connector declares what it bridges, what lifecycle hooks it supports, and how it reports health — that's a separate decision. This ADR moves the code. Resource bundling is covered by [ADR: Resource Bundles](drafts/20260409-resource-bundles.md) (draft); lifecycle hooks remain open.
- **Connector scaffolding.** A `trails create connector` command is desirable but not part of this decision.
- **Trail factories on connectors.** Connectors may eventually export trails via a `/trails` subpath (e.g., `@ontrails/with-cloudflare/trails` for health checks or platform-optimized CRUD). That's a separate decision that depends on the `deriveTrail()` design.
- **Profile-based connector selection.** How a deployment profile chooses which connector backs which resource is a configuration concern, not a packaging concern.

## Consequences

### Positive

- **Core packages become pure contracts.** `@ontrails/store` is the persistence contract. `@ontrails/core` is the framework contract. No third-party transitive dependencies leak through.
- **Built-in backends stay discoverable.** A developer can start with `@ontrails/store/jsonfile` without learning the external connector catalog first.
- **Independent release cadence.** Connectors version and publish independently. A Drizzle update doesn't block a store feature.
- **Bounded contributions.** A new connector is a self-contained package: implement the interface, write tests against the store accessor contract, provide a mock factory. Contributors don't need to understand framework internals.
- **Clear dependency direction.** The one-way arrow from connectors to core is enforceable at the workspace level. Circular dependencies become structurally impossible.

### Tradeoffs

- **Migration cost.** Every existing import of `@ontrails/store/drizzle`, `@ontrails/cli/commander`, and `@ontrails/http/hono` must change. This is mechanical but touches every app.
- **More packages to maintain.** Each connector is a workspace package with its own `package.json`, build config, and test suite. The repo grows wider.
- **Packaging rules are more nuanced.** `with-*` is no longer the answer for every concrete runtime. The distinction is now architectural: built-in first-party backends vs external adapters.

## Non-decisions

- **Whether `connector()` becomes a framework primitive.** Platform connectors with shared lifecycle might benefit from framework-level support, but the bar for new primitives is high[^2]. This ADR extracts connectors without deciding their runtime shape.
- **How trails subpaths work on connectors.** Connectors that contribute trails (health checks, platform-optimized operations) may export them at `@ontrails/with-*/trails`. The design depends on [ADR-0030: Contours as First-Class Domain Objects](0030-contours-as-first-class-domain-objects.md) and the `deriveTrail()` helper.
- **Connector lifecycle hooks.** How connectors report readiness, perform health checks, and handle graceful shutdown. Resource bundling is addressed by [ADR: Resource Bundles](drafts/20260409-resource-bundles.md) (draft); lifecycle hooks remain deferred.

## References

- [ADR-0009: First-Class Resources](0009-first-class-resources.md) — the `resource()` primitive that connectors produce and trails consume
- [ADR-0016: Schema-Derived Persistence](0016-schema-derived-persistence.md) — the store contract that connectors bind to concrete backends
- [ADR-0022: Drizzle Binds Schema-Derived Stores to SQLite](0022-drizzle-store-connector.md) — the first connector implementation, currently a subpath of `@ontrails/store`
- [ADR-0023: Simplifying the Trails Lexicon](0023-simplifying-the-trails-lexicon.md) — the naming heuristic that `with-*` follows
- [ADR-0030: Contours as First-Class Domain Objects](0030-contours-as-first-class-domain-objects.md) — upstream of the `/trails` subpath design on connectors
- [ADR-0031: Backend-Agnostic Store Schemas](0031-backend-agnostic-store-schemas.md) — the store-kind model that makes first-party backends meaningful
- [ADR: Resource Bundles](drafts/20260409-resource-bundles.md) (draft) — the bundling mechanism for connector and pack resources

[^1]: [ADR-0009: First-Class Resources](0009-first-class-resources.md)
[^2]: See the evaluation hierarchy in [Tenets: Primitives](../tenets.md#the-bar-for-new-primitives)
