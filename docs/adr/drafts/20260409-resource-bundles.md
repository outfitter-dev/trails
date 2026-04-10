---
slug: resource-bundles
title: Resource Bundles
status: draft
created: 2026-04-09
updated: 2026-04-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9, 16, 22, connector-extraction-and-the-with-packaging-model, backend-agnostic-store-schemas]
---

# ADR: Resource Bundles

## Context

### Resources are individual, but providers are collective

The `resource()` primitive[^1] is the framework's contract for infrastructure dependencies: typed access, lifecycle, mocks. A trail declares `resources: [db]` and accesses it through `db.from(ctx)`. This works when an app wires resources individually.

But resources rarely arrive alone. A Cloudflare deployment provides D1, R2, and KV from shared platform credentials. A Drizzle setup might back multiple store schemas from one connection. An invoicing pack ships store resources with opinionated connector choices. In each case, the provider produces a *group* of resources from shared configuration, and the consumer wants to accept the group as a unit while retaining the ability to override individual members.

Today there's no intermediate concept between a single resource and the topo's flat resource map. The consumer must wire each resource individually, even when they all come from the same source. Platform connectors call `resource()` three times with copy-pasted credentials. Packs export individual resources that the consumer must discover and register one by one.

### The override story matters for distribution

The progressive persistence story[^2] — JSON files → SQLite → D1 — works because the store schema stays the same and only the resource binding changes. But when a pack distributes trails with default resource bindings, the consumer needs to override *specific* resources without understanding the full bundle. An invoicing pack defaults to Drizzle. A consumer deploying to Cloudflare wants to swap the store resource to D1 but keep everything else. The override must be granular (per resource) while the default must be collective (the bundle).

## Decision

### A resource bundle is a named collection with overridable defaults

A **bundle** groups related resources under a common namespace. Each resource in the bundle has an ID and a default implementation. The consumer accepts the bundle's defaults and overrides what doesn't fit:

```typescript
import { bundle } from '@ontrails/core';

// A connector produces a bundle from shared config
const cf = bundle('cloudflare', (options) => ({
  d1: resource('cloudflare.d1', {
    create: () => createD1Client(options),
    dispose: (client) => client.close(),
    mock: () => createInMemoryDb(),
  }),
  r2: resource('cloudflare.r2', {
    create: () => createR2Client(options),
    dispose: (client) => client.close(),
    mock: () => createInMemoryStorage(),
  }),
  kv: resource('cloudflare.kv', {
    create: () => createKVClient(options),
    dispose: (client) => client.close(),
    mock: () => createInMemoryKV(),
  }),
}));
```

The consumer uses the bundle:

```typescript
const infra = cf({ accountId: '...', apiToken: '...' });

const app = topo('myapp', trails, {
  resources: {
    ...infra.resources,                        // accept all defaults
    [infra.kv.id]: redis({ url: '...' }),      // override just KV
  },
});
```

`infra.resources` spreads the bundle's defaults into the topo's resource map. The override replaces one entry by ID. The other resources keep their Cloudflare implementations. The trail doesn't know or care — it accesses `kv.from(ctx)` either way.

### Bundles work for connectors and packs

The same mechanism serves both distribution patterns:

**Connector bundle** — shared platform config, multiple resources:

```typescript
// @ontrails/with-cloudflare
export const cloudflare = bundle('cloudflare', (options) => ({
  d1: resource('cloudflare.d1', { /* ... */ }),
  r2: resource('cloudflare.r2', { /* ... */ }),
  kv: resource('cloudflare.kv', { /* ... */ }),
}));
```

**Pack bundle** — domain capability with default connector choices:

```typescript
// @someorg/trails-invoicing
export const invoicing = bundle('invoicing', (options) => ({
  invoiceStore: drizzle(invoiceSchema, { url: options.dbUrl }),
  paymentStore: drizzle(paymentSchema, { url: options.dbUrl }),
  emailService: resource('invoicing.email', { /* ... */ }),
}));
```

The consumer of the invoicing pack:

```typescript
const inv = invoicing({ dbUrl: './invoicing.sqlite' });

// Accept defaults — Drizzle backs both stores
const app = topo('myapp', inv.trails, {
  resources: inv.resources,
});

// Or override the store connector for production
const app = topo('myapp', inv.trails, {
  resources: {
    ...inv.resources,
    [inv.invoiceStore.id]: d1(invoiceSchema, { database: 'invoices' }),
    [inv.paymentStore.id]: d1(paymentSchema, { database: 'payments' }),
  },
});
```

The pack author chose Drizzle. The consumer swapped to D1. The trails never changed. The override is per-resource, using the same ID-based mechanism the topo already supports.

### Bundles carry provenance

A bundle knows where its resources came from. The topo can report "invoiceStore backed by Drizzle (default from invoicing pack)" or "invoiceStore backed by D1 (overridden)." This is metadata on the bundle, not a new primitive — the resource itself is unchanged.

Survey can show the full infrastructure picture:

```text
Resources:
  cloudflare.d1     → D1 (from cloudflare bundle)
  cloudflare.r2     → R2 (from cloudflare bundle)
  invoicing.store   → D1 (overridden, default was Drizzle from invoicing bundle)
  invoicing.email   → SendGrid (from invoicing bundle)
```

### Profiles are bundle overrides

The **profile** concept (already in the lexicon for environment config) is a set of resource overrides applied to bundles:

```typescript
// Local development — accept connector defaults
const local = invoicing({ dbUrl: './invoicing.sqlite' });

// Production — override with platform resources
const prod = invoicing({ dbUrl: './invoicing.sqlite' }); // defaults don't matter
const prodResources = {
  ...prod.resources,
  [prod.invoiceStore.id]: d1(invoiceSchema, { database: 'invoices-prod' }),
  [prod.paymentStore.id]: d1(paymentSchema, { database: 'payments-prod' }),
  [prod.emailService.id]: ses({ region: 'us-east-1' }),
};
```

Same trails. Same store schemas. Same bundle structure. Different resource overrides per environment. Profile selection is configuration over the bundle's defaults.

### Bundles can include trails

A bundle may carry trails alongside resources. This is how packs distribute capability — the bundle is trails + resources as a unit:

```typescript
export const invoicing = bundle('invoicing', (options) => {
  const invoiceStore = drizzle(invoiceSchema, { url: options.dbUrl });
  const paymentStore = drizzle(paymentSchema, { url: options.dbUrl });

  return {
    // Resources
    invoiceStore,
    paymentStore,

    // Trails that use those resources
    trails: [
      ...crud(invoiceSchema, invoiceStore),
      ...crud(paymentSchema, paymentStore),
      approvalGate,
    ],
  };
});
```

The consumer gets trails and resources together. Override a resource and the trails that depend on it automatically use the override — because trails reference resources by ID, not by implementation.

### Connectors that contribute trails

A connector bundle can also carry trails — health checks, platform-optimized operations:

```typescript
// @ontrails/with-cloudflare
export const cloudflare = bundle('cloudflare', (options) => ({
  d1: resource('cloudflare.d1', { /* ... */ }),
  r2: resource('cloudflare.r2', { /* ... */ }),
  kv: resource('cloudflare.kv', { /* ... */ }),

  trails: [
    trail('cloudflare.health', {
      intent: 'read',
      resources: [d1, r2, kv],
      blaze: async (input, ctx) => {
        // ping all three, report health
      },
    }),
  ],
}));
```

Register the bundle and you get the resources *and* the health trails. The connector dogfoods the framework's own primitives.

## Non-goals

- **Bundle as a new topo-graph primitive.** A bundle is a factory pattern that produces resources (and optionally trails). It doesn't need its own `kind` in the topo. The topo sees resources and trails — the bundle is how they got there.
- **Runtime bundle swapping.** Bundles are resolved at topo construction time. Resources are fixed for the lifetime of the app. Hot-swapping is not a goal.
- **Bundle dependency management.** How bundles declare peer dependencies, version compatibility, or update paths is a distribution concern — it belongs in the pack distribution story, not the bundle primitive.

## Consequences

### Positive

- **Collective defaults, granular overrides.** Connectors and packs provide resource groups as a unit. Consumers override what doesn't fit without understanding the full bundle.
- **The swap story works end-to-end.** A pack ships with Drizzle defaults. The consumer overrides to D1. The trails never change. The override is a one-line diff per resource.
- **Connectors and packs share the same mechanism.** A Cloudflare connector and an invoicing pack both produce bundles. The consumer's mental model is the same: accept defaults, override what you need.
- **Provenance without a new primitive.** The topo can report where each resource came from (which bundle, whether overridden) using metadata. No new `kind` in the graph.
- **Profiles become simple.** A profile is a set of resource overrides applied to bundles. No new configuration mechanism needed.

### Tradeoffs

- **One more concept.** Bundle sits between resource and topo. The justification: the collective-default + granular-override pattern can't be expressed with individual resources alone. The consumer would have to know every resource ID and wire each one.
- **Bundle API surface.** The factory shape (`bundle(name, (options) => ({ ... }))`) needs careful typing to ensure resource IDs are statically known and overrides are type-safe.

### Risks

- **Bundle sprawl.** If every small group of resources becomes a bundle, the abstraction loses value. The bar: a bundle should provide shared configuration that meaningfully flows to multiple resources. Two resources from unrelated sources don't need a bundle.

## Non-decisions

- **Profile configuration format.** Whether profiles are code-level (conditional imports), config-level (YAML/JSON), or environment-level. The mechanism is deferred; the concept is established.
- **Bundle versioning and compatibility.** How packs declare which connector versions they're tested against, and how consumers know if a resource override is safe.
- **Scaffolding.** A `trails create connector` command that scaffolds a bundle-producing connector package. Desirable tooling, separate from the bundle concept.
- **Test harness.** A shared test utility that validates resources within a bundle satisfy expected interfaces (e.g., store accessor). This is a testing concern that builds on the bundle, not part of the bundle definition.

## References

- [ADR-0009: First-Class Resources](../0009-first-class-resources.md) — the resource primitive that bundles group and distribute
- [ADR-0016: Schema-Derived Persistence](../0016-schema-derived-persistence.md) — the store contract that bundle resources satisfy
- [ADR-0022: Drizzle Binds Schema-Derived Stores to SQLite](../0022-drizzle-store-connector.md) — the first connector, now understood as a single-resource bundle
- [ADR-0029: Connector Extraction and the `with-*` Packaging Model](0029-connector-extraction-and-the-with-packaging-model.md) — the packaging model for connector bundles
- [ADR-0031: Backend-Agnostic Store Schemas](0031-backend-agnostic-store-schemas.md) — the store schemas that bundle resources bind to concrete backends
- [ADR: `deriveTrail()` and Trail Factories](20260409-derivetrail-and-trail-factories.md) (draft) — trail factories that produce trails carried by pack bundles
- [ADR-0030: Contours as First-Class Domain Objects](../0030-contours-as-first-class-domain-objects.md) — contours feed store schemas within bundles
- [Tenets: One write, many reads](../../tenets.md) — bundles distribute authored resources to multiple consumers
- [Tenets: The bar for new primitives](../../tenets.md#the-bar-for-new-primitives) — bundles are a pattern, not a new primitive

[^1]: [ADR-0009: First-Class Resources](../0009-first-class-resources.md)
[^2]: [ADR-0031: Backend-Agnostic Store Schemas](0031-backend-agnostic-store-schemas.md) — progressive persistence section
