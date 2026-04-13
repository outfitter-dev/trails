---
slug: contours-as-first-class-domain-objects
title: Contours as First-Class Domain Objects
status: draft
created: 2026-04-09
updated: 2026-04-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, 3, 9, 16, 23]
---

# ADR: Contours as First-Class Domain Objects

## Context

### Trails has verbs but no nouns

A trail is a unit of work — create, star, delete, search. These are actions. But the things those actions operate on — a gist, a user, a file, an invoice — have no first-class representation in the framework. They exist only as Zod schemas scattered across trail definitions, store declarations, and application code.

This creates three concrete problems:

1. **Redundant authoring.** The same schema gets partially restated across every trail that touches the same domain object. A gist's shape appears in the create trail's input, the show trail's output, the update trail's input, the list trail's output. Each is a slightly different slice of the same thing, hand-authored independently.

2. **Invisible relationships.** The topo doesn't know that `gist.create`, `gist.show`, `gist.star`, and `gist.delete` are all operations on the same thing. It sees four unrelated trails that happen to share a prefix. The warden can't check completeness. Survey can't group meaningfully. An agent reading the topo can't reconstruct the domain model.

3. **No reuse across domain objects.** Star is the same operation whether applied to gists, posts, or users. Toggle on, toggle off, check state. But today the developer writes structurally identical trails for each — four trails for gist stars, four more for user stars. The framework doesn't know these are the same pattern applied to different subjects.

### How we got here

The initial framing (from the entity trail factories draft) proposed `mark()` and `toggle()` as factory functions that generate trails from declarations. This was rejected — generated trails are invisible in source code, violating the principle that authored code should be readable code.

The next iteration separated the domain object (entity) from the operations (marks). "Entity" carried JPA/DDD baggage that didn't fit the Trails vocabulary. Stripping to fundamentals, we worked from first principles:

- A **noun** is a thing in the domain with a known shape. Gist, user, file.
- A **verb** is an action. A trail is already a verb.
- A **verb set** is a bundle of related verbs that commonly travel together. CRUD is five verbs. Toggle is two complementary verbs.

The key realization: a verb set isn't a new category. CRUD, toggle, and transition are *known shapes of trail* — trails where the schema, intent, and default behavior are predictable enough that the framework can derive more if you declare the shape. This is what the lexicon already calls a **pattern**[^1].

The deeper insight came when considering node-based visual tools where objects are discrete nodes and connections are wires between them. A trail was never just "a verb." It was always a connection between things. Create gist connects a user's intent to a new gist. Star connects a user to a gist through a relationship. We just weren't declaring which nodes it connects.

## Decision

### `contour()` is a new primitive

A **contour** is a domain object with a schema, identity, and examples. In cartography, contour lines define the shape of the terrain — the authoritative description of what's there. You read contours to understand the landscape before you plan trails.

A contour promotes a Zod schema the developer already wrote into something the framework can reason about: identity, graph membership, typed references, example data, store derivation, warden completeness.

```typescript
const user = contour('user', {
  id: uuid(),
  name: z.string(),
  email: z.string(),
});

const gist = contour('gist', {
  id: shortId(),
  description: z.string(),
  content: z.string(),
  owner: user.id(),
  createdAt: z.date(),
});
```

### Two primitives, two roles

**Contour** — a node. A named domain object with a schema, identity, and examples. The single source of truth for the shape of a thing.

**Trail** — an edge. A unit of work that may connect contours together. Gains optional `contours` and `pattern` properties. Fully backward-compatible — a trail without contours works exactly as today.

We tested whether contour and trail should merge (as trail and hike merged in ADR-0003[^2]). The conclusion: no. ADR-0003 merged hike into trail because the distinction was confusing — they were too similar. Here the risk is the opposite. A contour and a trail are different enough in purpose that merging creates ambiguity. Contours are nodes, trails are edges. The vocabulary does the work.

### Declared references with `.id()`

The `.id()` accessor declares references between contours. It does two things:

1. Returns a Zod type — the branded ID type of the referenced contour.
2. Tags that type with metadata — "this field references that contour."

At runtime, the value is just a string. But the declaration carries the connection. When the topo is built, it reads contour definitions, finds every `.id()` reference, and draws edges in the domain graph.

Nothing is "live." Nothing auto-fetches. The developer's blaze function still loads the referenced object by ID if it needs the full data. The framework just knows the map — which things reference which other things, through which fields.

**It's a map, not a pipeline.** The contour declarations draw the map. The trails are the paths you take on it.

### Type safety through branded IDs

Branded types make `.id()` references safe at the compiler level. Each contour declares its own ID type (`uuid()`, `shortId()`), and the framework derives distinct branded types:

```typescript
const account = contour('account', {
  id: uuid(),
  owner: user.id(),
  balance: z.number(),
});

const transfer = contour('transfer', {
  id: uuid(),
  from: account.id(),   // type: AccountId (branded)
  to: account.id(),     // type: AccountId (branded)
  amount: z.number(),
});
```

If a developer accidentally puts a `UserId` into the `from` field, the compiler catches it. Not the warden, not a test, not production — the compiler. This is entirely derived. The developer wrote `id: uuid()` on each contour. The framework derived distinct branded types from each contour's identity. That's the "enforced" information category[^3].

### Only `.id()` — everything else is just Zod

There are only two kinds of fields on a contour:

- **Native** — `z.string()`, `z.number()`, etc. This contour owns the field. No connection.
- **Reference** — `org.id()`. A declared reference to another contour. The framework tracks this.

Denormalized fields (freezing a billing address onto an invoice) are native fields. The developer copies the value in the blaze function. One accessor. Everything else is plain schema authoring.

### Trails declare contours with `contours: [...]`

A single property, always an array. The number of contours tells the framework the relationship shape:

```typescript
// One contour — trail operates on gist
trail('gist.create', {
  pattern: 'crud.create',
  contours: [gist],
  blaze: async (input, ctx) => { /* ... */ },
});

// Two contours — trail connects user and gist
trail('gist.star', {
  pattern: 'toggle',
  contours: [user, gist],
});

// Two contours — trail connects user and org with its own data
trail('org.member', {
  pattern: 'crud',
  contours: [user, org],
  input: z.object({
    role: z.enum(['admin', 'member', 'viewer']),
  }),
});

// No contours — standalone trail
trail('health.check', {
  intent: 'read',
  blaze: async (input, ctx) => { /* ... */ },
});
```

No separate `contour:` vs `between:` properties. The trail involves these contours — that's all the framework needs to know.

### Two kinds of edges in the topo graph

| Edge type | Declared by | Example | Meaning |
| --- | --- | --- | --- |
| Schema reference | `.id()` in contour field | user has `org: org.id()` | Structural, always present |
| Trail connection | `contours:` on trail | `gist.star` involves `[user, gist]` | Operational, action-based |

Both are visible in the topo graph. Survey shows the full domain model — structural references as solid lines, operational connections as action-labeled edges.

### Contours and schema reuse

Trails reference contour schemas directly using standard Zod operations:

```typescript
trail('gist.show', {
  input: z.object({ id: gist.shape.id }),
  output: gist,
  intent: 'read',
  contours: [gist],
  blaze: async (input, ctx) => { /* ... */ },
});

trail('gist.create', {
  input: gist.pick({ description: true, content: true }),
  contours: [gist],
  blaze: async (input, ctx) => { /* ... */ },
});
```

No special framework mechanism. The contour behaves like the Zod object it wraps. Standard operations (`.pick()`, `.extend()`, `z.array()`) just work. The contour is the single write that many trails read from.

### Contour examples as source data

Examples on contours are noun examples — "here's what a valid gist looks like":

```typescript
const gist = contour('gist', {
  id: shortId(),
  description: z.string(),
  content: z.string(),
  owner: user.id(),
  createdAt: z.date(),
  examples: [
    { id: 'g1', description: 'Hello world', content: '# Hello', owner: 'u1', createdAt: new Date() },
  ],
});
```

Everything downstream feeds from these:

- **Trail examples derived.** A `crud.create` trail on gist can derive its input/output examples from the contour's example data.
- **Store fixtures derived.** Contour examples become test fixtures. `testAll(app)` seeds the database with contour examples before running trail examples.
- **Warden validation.** Examples are validated against the contour schema — if the schema changes and an example becomes invalid, the warden catches it.

### Contours and resources

A contour is a shape — data, not infrastructure. A contour doesn't "need a database." A contour *is stored in* a database. The store binds the contour to infrastructure:

```text
contour (shape) → store (persistence) → resource (infrastructure) → trail (execution)
```

The contour doesn't declare resources. The store does. When a trail references a contour that has a store binding, the framework can derive the resource dependency. The trail's resource list becomes something the framework can infer from the contour-store relationship rather than something the developer hand-declares.

### Contour file organization

Contours live in their own files. The import graph between contour files IS the structural relationship graph:

```text
src/
  contours/
    user.ts
    org.ts
    gist.ts
    product.ts
    order.ts
```

```typescript
// contours/user.ts
import { org } from './org';

export const user = contour('user', {
  id: uuid(),
  name: z.string(),
  org: org.id(),
});
```

You can look at the imports in `order.ts` and see that orders relate to products. The code structure mirrors the domain structure.

### Declaration-time, not runtime

Contour is a declaration-time concept. By the time a trail executes, the contour has done its job — the input schema is resolved, the topo graph is built. The execution pipeline sees a trail with a schema, same as always. The blast radius is limited to the declaration and introspection layers.

## Non-goals

- **Contour as ORM entity.** Contours declare shapes and references. They don't manage relationships at runtime, auto-fetch related objects, or cascade deletes. An ORM's domain graph answers "how are these things related?" The Trails topo answers "what can you do between these things, who's allowed to do it, and what does the contract look like on every trailhead?"
- **Automatic schema derivation in 1.0.** When a trail declares `contours: [gist]` and `pattern: 'crud.create'`, the framework *could* derive the input schema (gist fields minus generated fields). The derivation rules need careful design. Manual schema slicing with Zod operations works now and is explicitly supported.
- **`.id()` semantics beyond references.** Whether `.id()` implies a foreign key constraint in store, whether it can express optional references, and how it handles one-to-many vs. one-to-one at the declaration level — these are design decisions for the store integration, not the contour primitive itself.

## Consequences

### Positive

- **One write, many reads — extended to domain objects.** A contour schema feeds trail input/output schemas, store table derivation, branded ID types, test fixtures, warden completeness checks, survey grouping, and agent guidance. One authored artifact, seven consumers.
- **Domain model visible in the topo.** An agent can read the topo and reconstruct the full domain model — nouns, their shapes, and every operation between them — without reading source code.
- **Compiler-enforced reference safety.** Branded IDs derived from contour identity make ID misuse a compile error, not a runtime bug.
- **Progressive adoption.** A trail without contours works exactly as today. Contours are additive. The developer adds structure incrementally as domain objects emerge.

### Tradeoffs

- **New primitive.** Contour is the first new primitive since `resource()`. The bar for new primitives is high[^4]. The justification: typed domain objects with graph membership, identity, branded IDs, and example derivation cannot be expressed through any existing primitive. A contour is not a trail, not a resource, not a signal.
- **Concept count.** The framework gains one concept. The tradeoff is that the concept *removes* hidden complexity — schemas restated across trails, relationships inferred from naming conventions, domain knowledge trapped in developers' heads.
- **Naming.** "Contour" fits the cartographic vocabulary and the concept. It hasn't been stress-tested against real usage, documentation, or newcomer explanation.

### Risks

- **Circular contour references.** User has `org: org.id()` and org may reference user. TypeScript handles circular imports, but the `.id()` accessor only needs the referenced contour's ID type, not its full schema, which should keep resolution lightweight. Needs validation.
- **Contour ordering in `contours: []`.** When a trail declares `contours: [user, gist]`, does the order carry meaning? For a toggle like star, the first contour could be the actor and the second the subject. Or order could be irrelevant and directionality inferred from the pattern. Needs a decision.

## Non-decisions

- **Pattern shapes at 1.0.** Toggle and CRUD are clear candidates. Transition, collection, and counter can follow. Which patterns ship initially is a separate design decision — see [ADR: `deriveTrail()` and Trail Factories](20260409-derivetrail-and-trail-factories.md) (draft).
- **Schema derivation rules.** When and how the framework derives input/output schemas from contours + patterns. Deferred until `deriveTrail()` design lands.
- **1.0 scope.** Contour is shippable for 1.0. Whether patterns also need to ship, or whether contour alone is the 1.0 primitive and patterns follow, is a sequencing question.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) — the information architecture categories (authored, projected, enforced) that contour leverages
- [ADR-0001: Naming Conventions](../0001-naming-conventions.md) — the vocabulary rules that `contour()` follows as a bare-noun primitive
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) — the merge test applied to contour vs. trail (conclusion: they're different enough to stay separate)
- [ADR-0009: First-Class Resources](../0009-first-class-resources.md) — the resource primitive that contours relate to through the store binding
- [ADR-0016: Schema-Derived Persistence](../0016-schema-derived-persistence.md) — the store contract that can derive from contours instead of standalone schemas
- [ADR-0023: Simplifying the Trails Lexicon](../0023-simplifying-the-trails-lexicon.md) — the naming heuristic and `pattern` as the trail's declared operational shape
- [ADR: `deriveTrail()` and Trail Factories](20260409-derivetrail-and-trail-factories.md) (draft) — the derivation helper that composes with contours
- [ADR-0029: Connector Extraction and the `with-*` Packaging Model](../0029-connector-extraction-and-the-with-packaging-model.md) — the connector extraction that contour-derived stores will bind through
- [Tenets: The trail is the product](../../tenets.md) — contours make trails smarter without changing what trails are
- [Tenets: One write, many reads](../../tenets.md) — the governing principle contours extend to domain objects
- [Tenets: The bar for new primitives](../../tenets.md#the-bar-for-new-primitives) — the justification standard contour must meet

[^1]: [ADR-0023: Simplifying the Trails Lexicon](../0023-simplifying-the-trails-lexicon.md) — `pattern` as the declared operational shape on a trail
[^2]: [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md)
[^3]: [ADR-0000: Core Premise — The information architecture](../0000-core-premise.md)
[^4]: See the evaluation hierarchy in [Tenets: Primitives](../../tenets.md#the-bar-for-new-primitives)
