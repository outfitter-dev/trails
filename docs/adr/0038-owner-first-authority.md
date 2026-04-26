---
id: 38
slug: owner-first-authority
title: Owner-First Authority
status: accepted
created: 2026-04-25
updated: 2026-04-26
owners: ['[galligan](https://github.com/galligan)']
depends_on: [7, 23, 36, 37]
---

# ADR-0038: Owner-First Authority

## Context

The v1 hardening pass surfaced rules duplicating framework knowledge. `errorNameToCategory` is a parallel table to `TrailsError.category`. `CRUD_OPERATIONS` is identical in two warden rule files. The `TrailsError` class hierarchy is hardcoded inside `unreachable-detour-shadowing`. Story 5 in the hardening tracker named the meta-pattern: *"should be derived but is authored."*

The first design move was to introduce a generic mechanism — a `canonicalSource()` helper, a build-time registry artifact, a typed loader — so rules could discover and consume framework data through one machinery. Walking that direction against the tenets, it came out as the wrong center of gravity. Almost every candidate has a natural owner already: the error class hierarchy owns the error taxonomy, `@ontrails/store` owns CRUD doctrine, `@ontrails/core` owns intent values and detour caps. Building a generic registry on top of those owners adds ceremony without adding capability, and creates an abstraction gravity well — exactly the pattern *"add with intent, not trend"* warns about.

## Decision

Framework authoritative values resolve through their natural owner module. Rules and tooling consume the owner's exports directly via TypeScript imports, runtime reflection on classes, or other native language mechanisms. No generic authority helper, no registry artifact, no loader is shipped in v1.

### Resolution hierarchy

When a rule or tool needs framework-authoritative data:

1. **Natural owner first.** The data lives in the module that conceptually owns the concept. The rule or tool imports from that owner.
2. **Strengthen the owner if needed.** If the owner doesn't expose the data cleanly, refactor the owner. Add typed `as const` arrays alongside type unions for runtime access. Add static or instance fields to classes when class-hierarchy data needs to be readable. Export class registries when reflection alone cannot enumerate subclasses.
3. **Generic fallback only when forced.** A generic mechanism (build-time registry, typed helper, loader) ships only when *all three* of these hold:
   - No natural owner module exists for the value.
   - Two or more independent consumers need it.
   - Drift between consumers has been observed in practice.

Today, no candidate in the v1 hardening backlog clears all three conditions.

### What this looks like in practice

**Error taxonomy.** Each `TrailsError` subclass already declares `readonly category` in source. Codes per category live in a single typed table next to the error classes:

```typescript
export const codesByCategory = {
  validation: { exit: 1, http: 400, jsonRpc: -32602 },
  not_found: { exit: 2, http: 404, jsonRpc: -32601 },
  conflict: { exit: 3, http: 409, jsonRpc: -32603 },
  internal: { exit: 8, http: 500, jsonRpc: -32603 },
} as const;

// Discoverability: explicit metadata for error classes,
// since JavaScript cannot reflect on all subclasses of TrailsError
// and some classes have dynamic runtime categories.
export const errorClasses = [
  { ctor: ValidationError, category: 'validation', retryable: false },
  { ctor: NotFoundError, category: 'not_found', retryable: false },
  { ctor: ConflictError, category: 'conflict', retryable: false },
  {
    ctor: RetryExhaustedError,
    category: 'dynamic',
    retryable: false,
    inheritsCategoryFrom: 'wrapped-error',
  },
  // ...
] as const;
```

The three previous parallel maps (`exitCodeMap`, `statusCodeMap`, `jsonRpcCodeMap`) collapse into one. The `errorNameToCategory` parallel in `packages/schema/src/openapi.ts` retires — OpenAPI generation walks `errorClasses` and reads fixed-category metadata from each entry. Dynamic-category entries such as `RetryExhaustedError`, whose category is inherited from the wrapped error, are modeled explicitly instead of being projected as a single category. Rules that need to walk the hierarchy (`unreachable-detour-shadowing`) import `errorClasses` and iterate.

**Type-union runtime values.** Provide a runtime `as const` array alongside the type:

```typescript
export const intentValues = ['read', 'write', 'destroy'] as const;
export type Intent = typeof intentValues[number];
```

A single declaration is the source of truth for both type and runtime values. Rules import `intentValues` directly.

**Doctrine constants.** The owning package exports them as typed values:

```typescript
// In @ontrails/store
export const crudOperations = ['create', 'read', 'update', 'delete', 'list'] as const;
export type CrudOperation = typeof crudOperations[number];

export const crudAccessorExpectations = { /* ... */ } as const;
```

**Pure constants.** Just typed exports:

```typescript
// In @ontrails/core
export const DETOUR_MAX_ATTEMPTS_CAP = 5;
```

Rules import directly. No metadata, no registration ceremony.

**Curated denylists.** Curated lists are not framework data; they are a rule's own knowledge. They stay co-located with the rule that owns them. The surface-module denylist used by `context-no-surface-types` is an example: `'express'`, `'hono'`, `'fastify'`, etc. are not values the framework owns; they are forbidden imports the rule curates. A rule may export its denylist as a named constant if a second consumer materializes — but that promotion is consumer-driven, not preemptive.

**Interface accessor names.** When a rule needs runtime names of interface accessors (e.g., `Result.value`, `Result.error`, `Result.match`), the owner module exports a typed constant:

```typescript
// In @ontrails/core
export const resultAccessorNames = [
  'value',
  'error',
  'isOk',
  'isErr',
  'map',
  'flatMap',
  'mapErr',
  'match',
  'unwrap',
  'unwrapOr',
] as const;
```

This is cleaner than instructing rules to inspect TypeScript interfaces at lint time, and keeps the source of truth at the owner.

### Why this respects the tenets

The tenet hierarchy biases toward strengthening existing primitives or codifying patterns over introducing new mechanisms. Owner-first resolution lands at *strengthen the existing owners*. Each module already carries the concept it owns; this decision asks owners to expose their data cleanly, then trusts TypeScript and runtime to be the canonical mechanism. No new public surface, no new helper, no new artifact format.

The decision also respects *"few primitives, many derivations"* directly: aggregate maps (`exitCodeMap` etc.) become derived from owner-resident data rather than being separate sources of truth. The framework's own type system and class hierarchy *are* the canonical mechanism — the deepest form of dogfooding the resolved-graph and queryable-contract tenets allow without overreaching their scope.

### Cautions

A few realities the lighter answer must respect:

- **Class-hierarchy walking is not free.** JavaScript cannot enumerate all subclasses of a base class by reflection alone. Owner modules must export an explicit array (e.g., `errorClasses`) for tooling to walk. Strengthening the owner means adding that registry; it is not magical reflection.
- **Some lookups are easier as direct typed exports than introspection.** When a rule needs runtime names that live on a TypeScript interface, a small typed constant in the owner module is cleaner than instructing rules to introspect the interface from lint code. Prefer the constant.
- **Curated lists stay curated.** The surface-module denylist, vocabulary banlists, and similar policy lists are not framework data; they are explicit rule-owned curation. Don't promote them to canonical authority just because the methodology has a category for it.
- **Consumer-local rule data is not framework canonical.** When a consumer app needs to govern its own domain registries (scope lists, feature flags, PII classes), the path is rule configuration or extension-owned exports — not framework authority. Framework authority is for framework concepts.

## Consequences

### Positive

- **The framework dogfoods more deeply.** Each owner module exposes its doctrine directly. Rules read from owners. The framework's type system and class hierarchy become the canonical mechanism — no parallel layer to maintain.
- **No new public surface in v1.** No `canonicalSource()` helper, no registry artifact format, no loader API, no `derivedFrom` declaration shape. The framework's existing typed surface is the mechanism.
- **Story 5 ("authored where derivable") gets a structural fix at the owner-module layer.** When each owner exposes its data cleanly, rules duplicating that data become a lint finding, not a load-bearing pattern.
- **The hardening pass gets materially lighter.** Stage 2 reshapes from "tag canonicals + build registry" to "refactor owner modules to expose doctrine." The audit's top promotions flow through owner refactors.
- **The fallback is preserved as a reserved safety valve.** If a value emerges that has no natural owner, multiple consumers, and demonstrated drift, the framework adds the generic mechanism then. Until those conditions hold, the mechanism doesn't ship.

### Tradeoffs

- **Class hierarchies need explicit class registries.** Adding `errorClasses` (and similar) to owner modules is real authoring work. Mitigated: it is one array per hierarchy, kept current alongside class declarations, and strengthens owner discoverability for any consumer.
- **No machine-discoverable "registry of framework authority" exists.** A future tool that wants to enumerate framework authoritative values must walk known owners explicitly. Mitigated: the consumers we know about (warden rules, oxlint plugin rules) do this naturally by import. Speculative consumers can be designed against their actual needs when they exist.
- **The fallback is reserved but undesigned.** If a real orphaned case ever emerges, design happens then. This is intentional — pre-designing for hypothetical demand creates the abstraction gravity well the tenets warn against.

## Non-decisions

- This ADR does not specify the fallback mechanism's shape. If the fallback is ever needed, that is its own ADR with concrete consumer evidence.
- This ADR does not enumerate every framework module that owns authoritative data. The hardening pass identifies the immediate set; further owners surface as concepts mature.
- This ADR does not define a mechanism for consumer-authored rule data. Consumers needing rule-time configuration use rule-author-provided config, not framework authority.
- This ADR does not amend the resolved-graph tenet. Owner-first resolution operates beneath the topo, not by extending it.

## References

- [ADR-0007: Governance as Trails with AST-Based Analysis](0007-governance-as-trails.md) — warden's foundational model; owner-first resolution is how warden rules read framework data without duplicating it
- [ADR-0023: Simplifying the Trails Lexicon](0023-simplifying-the-trails-lexicon.md) — vocabulary alignment
- [ADR-0036: Warden Rules Ship Only as Trails](0036-warden-rules-ship-only-as-trails.md) — establishes warden's rule shape; this ADR provides the data layer warden rules consume from owner modules
- [Oxlint Plugin and the Warden Boundary](0037-oxlint-plugin-and-warden-boundary.md) — companion ADR; the rule-home split applies regardless of how rules access framework data
- [Rule Design](../rule-design.md) — rule-design methodology; the survival heuristic operates on owner-module imports
