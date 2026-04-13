---
slug: derivetrail-and-trail-factories
title: deriveTrail() and Trail Factories
status: draft
created: 2026-04-09
updated: 2026-04-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, 3, 16, 23, contours-as-first-class-domain-objects]
---

# ADR: deriveTrail() and Trail Factories

## Context

### The ceremony problem

Standard operations repeat across every domain object. CRUD for notes, CRUD for users, CRUD for gists — each is a set of trails with the same structural shape, differing only in schema and resource. The developer hand-writes five trails per entity, each with boilerplate: derive the trail ID from a convention, project input/output schemas from the store schema, set intent from the operation type, wire the resource, write a blaze that calls the store accessor.

This ceremony is predictable. Given a schema, an operation name, and a resource, the framework can derive a complete trail. The question is how to express that derivation without hiding what was created.

### The earlier approach and its limits

The entity trail factories draft proposed `mark()` and `toggle()` as opaque generators. This was rejected — generated trails are invisible in source code. The developer can't see what exists without expanding the topo. The framework should reduce ceremony without hiding the result.

### The naming hierarchy

Trails has a clear convention: core primitives are bare nouns (`trail()`, `store()`, `resource()`, `signal()`), and helpers that produce primitives use verb+noun form (`createTrailContext()`, `derivePermit()`). "Derive" is the framework's own verb for mechanical projection[^1] — trail IDs from schemas, CLI flags from fields, exit codes from errors. A function that mechanically projects a trail from a schema belongs in the same category.

## Decision

### `deriveTrail()` is the base helper

`deriveTrail()` takes a store schema, an operation name, and a resource. It derives everything internally — trail ID, input/output schemas, examples from fixtures, pattern metadata, resource wiring, and blaze for standard operations. One call, one trail.

```typescript
import { deriveTrail } from '@ontrails/core/trails';

const createNote = deriveTrail(noteSchema, 'create', db);
```

The output is a regular trail — `kind: 'trail'`, with `pattern` metadata set automatically, blaze, input/output schemas, and resource declarations. Inspectable, testable, governable. The output is always trails.

"Derive" is accurate: contour or schema in, trail out, deterministically. `deriveTrail()` sits one level above `trail()` — useful, powerful, but downstream of the primitive.

### Trail factories compose `deriveTrail()`

A trail factory is a function that calls `deriveTrail()` and returns an array of trails. The `crud` factory is five lines:

```typescript
// Inside @ontrails/store/trails/crud.ts
import { deriveTrail } from '@ontrails/core/trails';

export const crud = (schema, resource) => [
  deriveTrail(schema, 'create', resource),
  deriveTrail(schema, 'read', resource),
  deriveTrail(schema, 'update', resource),
  deriveTrail(schema, 'delete', resource),
  deriveTrail(schema, 'list', resource),
];
```

For operations where the blaze needs domain-specific logic, pass it as an option:

```typescript
export const sync = ({ from, to, on, transform }) =>
  deriveTrail(from.schema, 'sync', [from, to], {
    on,
    blaze: async (input, ctx) => {
      const source = from.resource.from(ctx);
      const target = to.resource.from(ctx);
      const data = await source.get(input.id);
      await target.upsert(transform(data));
      return Result.ok({ synced: input.id });
    },
  });
```

When you provide a `blaze`, `deriveTrail()` uses yours. When you don't (standard CRUD operations), it derives one. Same function, progressive complexity.

The `ingest` factory handles the inverse: external data arriving in a non-trail shape that needs to enter the system as a signal. A Stripe webhook, a GitHub event, a partner API callback — the pattern is always the same: verify the source, validate the payload, transform to the domain shape, emit a signal.

```typescript
import { ingest } from '@ontrails/core/trails';
import { hmac } from '@ontrails/core/layers';

// Stripe webhook → payment signal
const stripePayment = ingest({
  schema: StripePaymentEventSchema,
  verify: hmac({ header: 'Stripe-Signature', algo: 'sha256' }),
  signal: 'payment.completed',
  transform: (payload) => ({
    paymentId: payload.data.object.id,
    amount: payload.data.object.amount,
    currency: payload.data.object.currency,
  }),
});

// GitHub push → code change signal
const githubPush = ingest({
  schema: GitHubPushEventSchema,
  verify: hmac({ header: 'X-Hub-Signature-256', algo: 'sha256' }),
  signal: 'repo.pushed',
  transform: (payload) => ({
    repo: payload.repository.full_name,
    ref: payload.ref,
    commits: payload.commits.length,
  }),
});
```

Each `ingest` call produces one trail. The trail's blaze verifies the source (via a layer derived from `verify`), validates the payload against `schema`, applies `transform`, and calls `ctx.signal()` with the result. Verification uses the existing permit model[^4] — HMAC signature checking is structurally identical to any other credential verification, producing a verified identity. The trail is a regular trail: testable, governable, trailheadable on any surface.

The `verify` option is optional. An internal service posting events to your API doesn't need signature verification — skip it and the trail validates and emits directly. The `transform` option is also optional — if the external payload already matches the signal schema, omit it and the payload passes through.

```typescript
// Minimal ingest — no verification, no transform
const internalEvent = ingest({
  schema: InternalEventSchema,
  signal: 'order.created',
});
```

A connector like `@ontrails/with-stripe` can provide pre-built ingest trails that know Stripe's payload shapes, signature algorithm, and event taxonomy. But the mechanism is core — it works without any connector.

### Trail factories live in `/trails` subpaths

Each domain package exports trail factories via a `/trails` subpath:

```text
packages/
  core/
    src/trails/          deriveTrail() + composition trail factories
      derive-trail.ts     the base factory helper
      fanout.ts           fanout trail factory
      gate.ts             gate trail factory
      ingest.ts           ingest trail factory
  store/
    src/trails/          store trail factories
      crud.ts             CRUD trail factory
      sync.ts             sync trail factory
      reconcile.ts        reconcile trail factory
      projection.ts       projection trail factory
      migration.ts        migration trail factory
connectors/
  cloudflare/
    src/trails/          connector-contributed trails (optional)
      health.ts           health check trail
      d1-crud.ts          D1-optimized CRUD with batch operations
```

**Why this shape:**

- **No new top-level package.** `deriveTrail()` lives in `@ontrails/core/trails`. Store trail factories import it and add store-domain knowledge. No circular dependency.
- **Domain packages own domain trail factories.** `@ontrails/store` knows about store schemas, accessors, and persistence shapes — it's the right home for `crud`, `sync`, `reconcile`. Core knows about composition — it's the right home for `fanout`, `gate`, `ingest`.
- **Connector trails are optional.** A connector like `@ontrails/with-cloudflare` can export trails — both pre-built (health checks) and factories that optimize for platform-specific capabilities (D1 batch writes, KV atomic operations). These live at `@ontrails/with-cloudflare/trails`.
- **Subpath exports are self-describing.** `@ontrails/store/trails` — "the trails that come with the store package." `@ontrails/with-cloudflare/trails` — "the trails that come with the Cloudflare connector." No new concept to learn.

### First-party trail factories

**Store trail factories** (`@ontrails/store/trails`):

| Factory | Input | Output |
| --- | --- | --- |
| `crud` | `(schema, resource)` | 4–5 trails |
| `sync` | `({ from, to, on, transform })` | 1 trail |
| `reconcile` | `({ resource, on, strategy })` | 1 trail |
| `projection` | `({ source, target, derive })` | 1 trail |
| `migration` | `({ from, to })` | 1 trail |

**Composition trail factories** (`@ontrails/core/trails`):

| Factory | Input | Output |
| --- | --- | --- |
| `fanout` | `({ on, targets })` | 1 trail |
| `gate` | `({ checks })` | 1 trail |
| `ingest` | `({ schema, verify?, signal, transform? })` | 1 trail |

### What trail factories replace

| Without trail factories | With trail factories |
| --- | --- |
| Hand-written CRUD for every entity | `crud(noteSchema, db)` |
| Custom sync logic, different every time | `sync({ from, to, on, transform })` |
| Bespoke webhook handlers | `ingest({ schema, verify, signal })` |
| Ad-hoc approval workflows | `gate({ checks })` |
| Copy-paste conflict resolution | `reconcile({ resource, strategy })` |

Each is ceremony the framework can truthfully carry. The tenet: *"Repeated ceremony is a framework smell."*[^2]

### The four-step story

Define your schema. Get your trails. Connect with Drizzle. Trailhead on CLI.

```typescript
// 1. Define your schema
import { store } from '@ontrails/store';
const db = store({
  notes: { schema: noteSchema, identity: 'id', generated: ['id', 'createdAt'] },
});

// 2. Get your trails
import { crud } from '@ontrails/store/trails';
const noteTrails = crud(noteSchema, db);

// 3. Connect with Drizzle
import { drizzle } from '@ontrails/with-drizzle';
const notesDb = drizzle(db, { url: './notes.sqlite' });

// 4. Trailhead on CLI
import { commander } from '@ontrails/with-commander';
const app = topo('notes', noteTrails, { resources: { [db.id]: notesDb } });
commander(app);
```

Four imports. Four statements. A full CRUD app with typed schemas, a real database, and a CLI — testable, governable, trailheadable on any surface.

### Governance integration

- **Trail factories produce trails.** Not a separate system. The output is `kind: 'trail'` with `pattern` metadata set. Testable with `testAll()`. Governable by the warden. Composable via `crosses`.
- **The warden is pattern-aware.** It validates pattern completeness and suggests missing companions: *"You have CRUD trails for notes and `versioned: true`, but no reconcile trail. What happens on conflict?"*
- **Survey shows the shape.** An agent sees: *"12 CRUD trails, 3 sync trails, 1 gate trail, 2 custom trails."* The `pattern` field tells the story — not how the trails were created.

### Community trail factories

Community-contributed trail factories are regular npm packages:

```text
@someorg/trails-audit-log
@someorg/trails-soft-delete
@someorg/trails-approval-workflow
```

Each exports factory functions that produce trails. The consumer calls the factory, gets trails, registers them in their topo. No new system to learn.

A community author writing a new trail factory:

```typescript
import { deriveTrail } from '@ontrails/core/trails';

export const auditLog = (schema, resource) => [
  deriveTrail(schema, 'log', resource),
  deriveTrail(schema, 'query', resource),
  deriveTrail(schema, 'purge', resource),
];
```

One import. One function. The derivation helpers (`deriveTrailId`, `deriveSchemas`, `deriveExamples`, `mapStoreError`) are internals of `deriveTrail()`, not public API. If someone needs lower-level control, they import `trail()` from core and build from scratch — that's the escape hatch, not the default path.

The bar for first-party inclusion: *does this multiply the value of something the developer already authored?* A factory that generates five trails from a store schema — that's multiplication. A factory that only applies to one niche domain — that's a community package. Broadly useful community trail factories can be promoted into first-party domain packages.

### Growth model

Start small. Ship store trail factories and composition trail factories in their domain packages. As the community builds apps, new recurring shapes emerge. Some get contributed back. The ones that prove broadly useful get promoted into the relevant domain package. Growth from actual usage, not speculative design.

## Non-goals

- **`deriveTrail()` as public decomposition API.** The internal helpers (`deriveTrailId`, `deriveSchemas`, `deriveExamples`, `mapStoreError`) stay private. If someone needs that level of control, `trail()` is the escape hatch.
- **Opaque generation.** Trail factories return arrays of trails that are visible in source code. The developer calls `crud(noteSchema, db)` and gets back five trails they can inspect, spread, filter, or override. No magic registry.

## Consequences

### Positive

- **Ceremony reduction that compounds.** One `crud()` call replaces five hand-written trails, each with correct IDs, schemas, examples, patterns, and blaze functions. Multiply by every entity in the app.
- **One write, many reads — applied to trail creation.** The store schema is the single authored artifact. `deriveTrail()` reads it to produce trail IDs, input schemas, output schemas, examples, and blaze functions.
- **No new primitives.** `deriveTrail()` is a verb+noun helper, not a new category. Trail factories are functions that return trails. The `pattern` field on trails already exists[^3]. Nothing in the type system or topo graph changes.
- **Community extensibility.** The factory pattern is simple enough that community authors can write and publish trail factories without framework changes.

### Tradeoffs

- **Implicit blaze.** When `deriveTrail()` derives a blaze for standard operations, the implementation isn't visible in the developer's source code. The tradeoff is accepted because: (a) the operation is standard and well-defined, (b) the developer can always provide their own blaze to override, and (c) the derived trail is inspectable at runtime.
- **API surface on `deriveTrail()`.** How much domain logic `deriveTrail()` absorbs vs. how much stays in the developer's blaze needs careful boundary design. The `transform` function in `sync()` is the seam.

### Risks

- **Derivation rules need precision.** When `deriveTrail()` derives a blaze for `create`, which fields are excluded from input (auto-generated ones)? Convention or annotation? The rules must be explicit and documented, not magical.

## Non-decisions

- **Pattern shapes at 1.0.** Which patterns (`crud`, `toggle`, `sync`, `reconcile`, `fanout`, `gate`, `transition`, `ingest`) ship in the first release. This depends on which ones prove out in the dogfooding app.
- **Contour integration.** How `deriveTrail()` interacts with contour declarations — deriving input schemas from contours rather than store schemas — depends on [ADR: Contours as First-Class Domain Objects](20260409-contours-as-first-class-domain-objects.md) (draft).
- **Connector-contributed factories.** Whether connectors export optimized trail factories (e.g., D1 batch CRUD) via their `/trails` subpath depends on [ADR: Resource Bundles](20260409-resource-bundles.md) (draft) and how bundles carry trails alongside resources.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) — the information architecture and "one write, many reads" principle that `deriveTrail()` operationalizes
- [ADR-0001: Naming Conventions](../0001-naming-conventions.md) — the verb+noun helper convention that `deriveTrail()` follows
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) — the trail primitive that factories produce
- [ADR-0016: Schema-Derived Persistence](../0016-schema-derived-persistence.md) — the store schema that `deriveTrail()` reads from
- [ADR-0023: Simplifying the Trails Lexicon](../0023-simplifying-the-trails-lexicon.md) — the `pattern` field and `derive*` grammar rule
- [ADR: Contours as First-Class Domain Objects](20260409-contours-as-first-class-domain-objects.md) (draft) — the upstream domain noun that feeds `deriveTrail()`
- [ADR-0029: Connector Extraction and the `with-*` Packaging Model](../0029-connector-extraction-and-the-with-packaging-model.md) — the packaging model for connector-contributed `/trails` subpaths
- [ADR: Backend-Agnostic Store Schemas](20260409-backend-agnostic-store-schemas.md) (draft) — the store schema that `deriveTrail()` reads from
- [Tenets: Reduce ceremony, not clarity](../../tenets.md) — the governing principle; trail factories are ceremony reduction that rests on inspectable ground truth
- [Tenets: The bar for new primitives](../../tenets.md#the-bar-for-new-primitives) — `deriveTrail()` passes because it strengthens existing primitives rather than adding new ones

[^1]: [ADR-0023: Simplifying the Trails Lexicon — Grammar rules](../0023-simplifying-the-trails-lexicon.md)
[^2]: [Tenets: Reduce ceremony, not clarity](../../tenets.md)
[^3]: [ADR-0023: Simplifying the Trails Lexicon](../0023-simplifying-the-trails-lexicon.md) — `pattern` as the declared operational shape
[^4]: [ADR-0012: Connector-Agnostic Permits](../0012-connector-agnostic-permits.md) — verification as permit resolution
