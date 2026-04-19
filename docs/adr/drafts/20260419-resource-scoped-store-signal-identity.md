---
slug: resource-scoped-store-signal-identity
title: Resource-Scoped Store Signal Identity
status: draft
created: 2026-04-19
updated: 2026-04-19
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9, 16, 22, 23]
---

# ADR: Resource-Scoped Store Signal Identity

## Context

Store-derived change signals currently start life as bare ids like `users.created`, `users.updated`, and `users.removed`. That works only as long as one store resource owns a given table name. The first time two bound resources both contribute `users`, the topo rejects them as duplicate signals even when they are different resources with different responsibilities.

That collision is a symptom of the deeper mismatch: the framework has been pretending store signal identity exists before binding. It does not. A store declaration knows table shape and change kinds, but it does not know which resource will own those signals until a connector binds the store into the graph.

The fix needs to do more than stop one duplicate-id exception. It needs to make signal identity derive from information the framework already has, keep the canonical form readable, and avoid asking authors to hand-namespace store signals just to keep two resources in the same topo.

## Decision

Store signal identity is **resource-scoped and derived at binding**.

The canonical form is always:

```text
<scope>:<table>.<event>
```

Examples:

- `store:users.created`
- `identity:users.created`
- `db.main:users.created`

Scope resolves in a fixed order:

1. User-authored resource id, used as-is.
2. Role-based default when the author did not supply an id.
3. Connector-prefix fallback when the framework has no canonical role yet.

For `TRL-270`, the framework commits only to the first canonical role: `store`.

This means:

- A store declaration exposes **signal shape**, not final globally meaningful signal identity.
- Binding composes the canonical id from the bound resource scope plus the table-local event.
- The canonical scoped id is the only external form used by topo, runtime, docs, diagnostics, and persisted graph projections.
- Resource ids may not contain `:` so the scope boundary stays unambiguous.

Pre-bind store signal handles are still useful. They preserve payload shape and give authors a typed reference they can put in `on:` or `fires:`. But those handles are **late-bound references**, not final ids. The final id materializes when topo assembly can see which resource owns the signal.

```typescript
const definition = store({
  users: {
    identity: 'id',
    schema: userSchema,
  },
});

const identity = connectDrizzle(definition, {
  id: 'identity',
  url: ':memory:',
});

identity.store.tables.users.signals.created.id;
// "identity:users.created"
```

If the same store definition is bound more than once, pre-bind signal handles become ambiguous. In that case the framework rejects the unresolved reference and asks the author to use the canonical scoped id explicitly.

## Consequences

### Positive

- Duplicate signal ids across store resources disappear because topo now operates on resource-scoped ids instead of bare table-event ids.
- Connector swaps inside the same logical role stay stable when the resource id stays stable.
- The canonical signal form is readable and grep-able instead of opaque.
- Bound store resources expose the same canonical ids the rest of the graph sees, so runtime fire paths and topo registration stop disagreeing.

### Tradeoffs

- Pre-bind `table.signals.*.id` is no longer a canonical external identity. It is only a shape-level handle before binding.
- The framework needs a late-bound resolution path during topo assembly so authored signal handles can resolve to bound resource signals.
- A store definition bound multiple times cannot resolve a pre-bind signal handle implicitly. The ambiguity is real, so the framework surfaces it instead of inventing a guess.

### Non-decisions

- This ADR does not define the full canonical role vocabulary beyond `store`.
- This ADR does not define the general connector role-declaration API.
- This ADR does not define migration tooling for promoting connector-prefix ids into canonical role ids later.

## References

- [ADR-0009: First-Class Resources](../0009-first-class-resources.md) — resources provide the stable binding identity store signals now derive from
- [ADR-0016: Schema-Derived Persistence](../0016-schema-derived-persistence.md) — store tables and their reactive surfaces are derived from one authored schema
- [ADR-0022: Drizzle Binds Schema-Derived Stores to SQLite](../0022-drizzle-store-connector.md) — Drizzle is the first binding surface that needs the scoped signal form
- [ADR-0023: Simplifying the Trails Lexicon](../0023-simplifying-the-trails-lexicon.md) — keeps the signal vocabulary aligned with the current framework grammar
