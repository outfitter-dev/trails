---
slug: store-accessor-contract-refinement-lessons-from-two-backends
title: "Store Accessor Contract Refinement: Lessons from Two Backends"
status: draft
created: 2026-04-12
updated: 2026-04-12
owners: ['[galligan](https://github.com/galligan)']
depends_on: [31]
---

# ADR: Store Accessor Contract Refinement: Lessons from Two Backends

## Context

[ADR-0031: Backend-Agnostic Store Schemas](../0031-backend-agnostic-store-schemas.md) established the store as a backend-agnostic persistence domain. It defined the kind taxonomy (tabular, document, file, kv, cache) and promised that one store schema could project into different backends via connectors. At the time, only the Drizzle connector existed.

Building the first-party jsonfile backend (`@ontrails/store/jsonfile`) provided the second data point. Two concrete implementations — one SQL-backed (Drizzle/SQLite), one file-backed (JSON arrays on disk) — reveal which parts of the accessor contract are truly universal and which are tabular-specific. This ADR captures those findings and tightens the contract accordingly.

### What changed since ADR-0031

ADR-0031 listed "Store accessor interface" as a non-decision, noting that the accessor was tabular-shaped and needed design per kind. Since then:

- `StoreAccessor` and `StoreTableAccessor` were split into two interfaces in `packages/store/src/types.ts`.
- `StoreAccessorProtocol` was introduced in `packages/core/src/store/accessor-protocol.ts` as a type-only structural protocol that `deriveTrail()` uses without depending on `@ontrails/store`.
- A compile-time assertion in `packages/store/src/types.ts` pins the relationship between `StoreAccessor` and `StoreAccessorProtocol`.
- The jsonfile backend was built implementing only `StoreAccessor` — no `insert` or `update` methods — and is fully functional.

## Decision

### Two-tier accessor is normative

`StoreAccessor` is the universal contract. Every connector MUST implement it:

- `get(id)` — retrieve by identity
- `list(filters?, options?)` — filtered enumeration
- `upsert(input)` — create-or-replace
- `remove(id)` — delete by identity

`StoreTableAccessor` extends `StoreAccessor` with operations that only make sense when the backend distinguishes create from update natively:

- `insert(input)` — create-only (throws `AlreadyExistsError` on collision)
- `update(id, patch)` — patch-only (returns `null` when not found)

Connectors and built-in backends MAY implement `StoreTableAccessor`. The jsonfile backend validates that `StoreAccessor` alone is sufficient for a complete store, including CRUD trail factories, sync factories, and reconcile factories — all compose against the universal tier.

`StoreAccessorProtocol` in core mirrors this split: `get`, `list`, `upsert`, and `remove` are required; `insert` and `update` are optional. `deriveTrail()` synthesizes default blazes using the required methods and falls back gracefully when optional methods are absent (`get` + merge + `upsert` replaces `update`).

### Filter semantics: equality on top-level fields is the portable guarantee

`FiltersOf<TTable>` is typed as `Partial<EntityOf<TTable>>` — a partial match on the entity shape. The portable guarantee across all connectors is equality matching on top-level scalar fields.

Drizzle translates filters to SQL `WHERE` clauses with full relational power. Jsonfile does in-memory iteration with strict equality comparison. Both satisfy the typed contract, but their expressive power differs.

For v1, equality-on-top-level-fields is what the protocol promises. Connectors may offer richer filtering (range queries, full-text search, nested field matching) through connector-specific APIs, but portable trail code should rely only on the equality guarantee.

### Identity generation is connector-owned

The protocol does not prescribe how identity values are created. Each connector owns its strategy:

- **Drizzle** delegates to SQLite auto-increment for integer primary keys and uses `Bun.randomUUIDv7()` for text ID fields.
- **Jsonfile** uses `Bun.randomUUIDv7()` by default, with a `generateIdentity` hook in connector options for custom strategies.

The `generateIdentity` hook on jsonfile options is a backend-specific affordance, not a protocol-level concept. Other connectors will have their own strategies (e.g., database-generated UUIDs, Firestore document IDs). The protocol only requires that after `upsert` returns, the entity has a populated identity field.

### Version semantics are protocol-level

Optimistic concurrency via version tracking is a contract guarantee, not a connector choice. When a store table declares `versioned: true`:

1. The connector auto-increments the `version` field on every successful write.
2. When `upsert` receives a payload with a `version` value and a matching entity already exists, the connector compares versions. On mismatch, it throws `ConflictError`.
3. When `upsert` receives a payload without a `version` value, no conflict check occurs — the write proceeds unconditionally.
4. The version field name (`version`) is a framework constant exported as `versionFieldName` from `@ontrails/store`.

Both Drizzle and jsonfile implement this identically. Drizzle does it with SQL `WHERE version = ?` guards. Jsonfile does it with in-memory comparison before write. The mechanism differs; the contract is the same.

### `list` pagination accepts options but does not guarantee performance

`StoreListOptions` (limit/offset) is accepted by `list` across all connectors. SQL connectors push pagination to the database engine. Jsonfile slices an in-memory array. The protocol guarantees correct results for any valid limit/offset combination but does not guarantee performance characteristics. Large datasets on non-indexed backends will be slow — that is a connector selection concern, not a protocol bug.

### Generated fields are a connector concern

The `generated` array on a store table declares which fields the connector manages. The protocol says "these fields are optional on write input and populated on the returned entity." How they are populated — database defaults, application-level synthesis, or external ID services — is connector business.

Both connectors validate this: Drizzle uses SQL defaults and application-side materialization. Jsonfile synthesizes values in `buildUpsertPayload`. The `returning()` pattern (SQL `RETURNING` clause) is Drizzle-specific. Jsonfile returns the in-memory result after read-modify-write. The accessor contract says "upsert returns `EntityOf<TTable>`" — how the connector produces that entity is an implementation detail.

### What stays the same

- `StoreAccessorProtocol` in core remains type-only with no runtime edge. Core does not depend on `@ontrails/store`.
- `deriveTrail()` works against the protocol, not concrete accessor types. Trail factories are connector-agnostic.
- The compile-time assertion in `packages/store/src/types.ts` continues to pin the structural relationship between `StoreAccessor` and `StoreAccessorProtocol`.

## Consequences

### Positive

- **Clear connector implementation bar.** Implement four methods (`get`, `list`, `upsert`, `remove`) and you have a working store. The optional `insert`/`update` pair is a progressive enhancement, not a prerequisite.
- **Trail factories are truly portable.** CRUD, sync, and reconcile factories all compose against `StoreAccessor`. A trail built against Drizzle works against jsonfile without changes. The jsonfile backend is the proof.
- **Version semantics are testable without a database.** Jsonfile implements the same conflict detection as Drizzle. Tests can validate optimistic concurrency behavior against a file-backed store, which is faster to set up and tear down.

### Tradeoffs

- **Filter expressiveness varies.** Portable code is limited to equality matching. Developers who need range queries or full-text search must either use connector-specific APIs (breaking portability) or build filtering logic in trail implementations (moving work from the store to the trail). This is acceptable for v1 — the filter contract can be enriched later without breaking existing code.
- **No protocol-level identity generation hook.** Connectors handle identity differently enough that a unified hook would be either too abstract to be useful or too opinionated to be universal. The cost is that switching connectors may require adjusting identity strategies. The benefit is that each connector can use the most natural identity mechanism for its backend.

### Risks

- **Pagination performance expectations.** Developers may write `list` calls with large offsets expecting database-level efficiency and be surprised by in-memory backends. Documentation should be clear that `StoreListOptions` is a correctness contract, not a performance contract.

## References

- [ADR-0031: Backend-Agnostic Store Schemas](../0031-backend-agnostic-store-schemas.md) — the parent ADR this refines
- [ADR-0032: `deriveTrail()` and Trail Factories](../0032-derivetrail-and-trail-factories.md) — trail factories that compose against the accessor protocol
- `packages/store/src/types.ts` — `StoreAccessor`, `StoreTableAccessor`, and the compile-time assertion
- `packages/core/src/store/accessor-protocol.ts` — `StoreAccessorProtocol` type-only protocol
- `packages/store/src/jsonfile/runtime.ts` — jsonfile backend implementing `StoreAccessor`
- `connectors/drizzle/src/runtime.ts` — Drizzle connector implementing `StoreTableAccessor`
- [Tenets: One write, many reads](../../tenets.md) — the governing principle that accessor tiers operationalize
