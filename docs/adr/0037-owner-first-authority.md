---
id: 37
slug: owner-first-authority
title: Owner-First Authority
status: accepted
created: 2026-04-30
updated: 2026-04-30
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 7, 26, 35, 36]
---

# ADR-0037: Owner-First Authority

## Context

### Drift moved inward

Trails already treats the trail contract as the public source of truth for
apps. Schemas feed flags and tool parameters. Intent feeds surface behavior.
Errors feed surface-specific failure codes. The model works because one
authored value is read many ways.

The hardening pass exposed the same drift problem inside the framework itself.
Warden rules, OpenAPI generation, surface helpers, and package barrels were
starting to carry local copies of framework facts:

- error class names repeated in OpenAPI tables
- error categories and code mappings restated away from the error taxonomy
- intent literals copied into rules or projection helpers
- CRUD operation and accessor expectations duplicated outside the store package
- detour retry caps and Result accessor names inferred from nearby code instead
  of exported by the module that owns the concept

Each copy looked harmless. Together, they weakened the main Trails promise:
author once, project everywhere. If a framework value has to be updated in two
places, the framework has become one of the apps it was built to protect.

### Warden made the question sharper

[ADR-0007](0007-governance-as-trails.md) made governance part of the Trails
model. [ADR-0036](0036-warden-rules-ship-only-as-trails.md) made Warden rules
public as trails. That means Warden cannot be a pile of hand-maintained trivia.
It has to read the same owner-held framework facts the runtime and surfaces
read.

This does not mean every list belongs in a universal registry. Some rule-local
lists are policy. A rule that bans surface request types from trail logic owns a
curated denylist until another independent consumer needs the same list. The
problem is not "a list exists in a rule." The problem is a rule or projection
copying framework data that already has a natural owner.

### Consumer topo data is not framework authority

The resolved topo is the source of truth for a consumer app. It tells tools
which trails, resources, signals, schemas, examples, and relationships that app
authored.

It is not where framework doctrine should live. The topo can say "this app has
a `user.create` trail with `intent: 'write'`." It should not be the canonical
place that defines the legal intent values, the error taxonomy, or the store
accessor expectations. Those are framework facts. They belong to the modules
that own those concepts.

## Decision

### Framework facts live with natural owners

When a framework value is read by more than one consumer, its natural owner
exports the value in a typed runtime shape.

This means:

| Framework fact | Natural owner |
| --- | --- |
| Error classes, categories, retryability, and surface code mappings | `@ontrails/core` error taxonomy |
| Intent values | `@ontrails/core` trail intent type owner |
| CRUD operation names and accessor expectations | `@ontrails/store` |
| Result accessor names used for static assumptions | `@ontrails/core` Result owner |
| Detour retry attempt cap | `@ontrails/core` detour execution owner |
| Reserved framework vocabulary | the lexicon and the package that enforces the rule |
| Connector descriptors | the connector package or descriptor owner once the descriptor model lands |

The export is boring on purpose. Prefer an `as const` array, a typed object, or
a small mapper that directly represents the owner's knowledge. Do not introduce
a generic authority system before the natural owner has been tested.

### Consumers import owner data instead of copying it

Framework consumers read owner exports.

Bad:

```typescript
const errorNameToCategory = {
  ValidationError: 'validation',
  NotFoundError: 'not_found',
  ConflictError: 'conflict',
};
```

Good:

```typescript
import { errorClasses } from '@ontrails/core';

const errorNameToCategory = Object.fromEntries(
  errorClasses.map((errorClass) => [errorClass.name, errorClass.category])
);
```

The exact exported shape can differ by owner. The rule is stable: if the fact is
framework doctrine, the consumer reads it from the module that owns it.

### Rule-local lists are allowed when the list is policy

A Warden rule may keep a curated local list when the list expresses the rule's
own policy rather than a projection of framework data.

Allowed:

```typescript
const forbiddenSurfaceTypeNames = [
  'Request',
  'Response',
  'McpSession',
] as const;
```

That list belongs to a rule whose policy is "trail logic stays surface-agnostic."
It is not copied from a core framework table. If a second independent consumer
later needs the same denylist, the owner can move or export it then.

Not allowed:

```typescript
const intentValues = ['read', 'write', 'destroy'] as const;
```

Intent is framework doctrine. A rule checking intent propagation should import
the owner-held intent values instead of carrying its own copy.

The test: if changing the framework value should update the rule without
touching the rule, the data belongs with the owner. If changing the rule policy
should update the list, the rule can own it.

### Generic authority machinery is not the v1 default

Trails does not introduce a generic `canonicalSource()` helper, TSDoc
`@canonical` tags, topo-resident canonical tables, loader APIs, or
`derivedFrom` metadata as the default answer to duplicated framework facts.

Those systems are more abstract than the current problem. They add a second
place to consult before the natural owner has been given a chance to carry its
own data.

Generic machinery can be reconsidered only when all three are true:

- no natural owner can export the data without distorting its package
  responsibility
- multiple independent consumers need the same data
- drift has been demonstrated or is structurally likely without a shared
  mechanism

Until then, owner exports win.

### Owner data and topo data answer different questions

Use owner exports to answer framework questions:

- What error classes exist?
- Which categories map to which CLI, HTTP, or JSON-RPC codes?
- Which intent values are legal?
- Which CRUD operations does the store pattern define?
- What is the detour retry cap?

Use the topo to answer app questions:

- Which trails does this app expose?
- Which resources does a trail declare?
- Which signals can activate this trail?
- Which examples, schemas, and metadata did this app author?
- Which surface projections exist for this graph?

Mixing those questions creates blurry authority. A topo is queryable consumer
state. Owner exports are framework doctrine.

## Consequences

### Positive

- Warden rules can enforce framework doctrine without becoming a second copy of
  that doctrine.
- Surface projections read the same values the runtime owns, reducing drift
  between CLI, MCP, HTTP, JSON-RPC, OpenAPI, and future surfaces.
- Stage 2 owner-export work has a concrete rubric: export from the owner first,
  then rewire consumers.
- Public package APIs become more deliberate. If an internal helper is being
  exported only because another package needs owner data, the fix is an owner
  API, not an `./internal/*` pressure valve.

### Tradeoffs

- Owners gain a small public-data burden. A package that owns a concept must
  expose enough typed data for governance and projections to avoid copying it.
- Some consumers will need minor rewrites from local arrays or maps to imported
  owner data.
- Owner exports can become public contract. In the pre-v1 window this is
  acceptable; after v1, these exports need the same compatibility discipline as
  other supported APIs.

### Risks

- Over-exporting is possible. Not every private helper deserves to become a
  public owner API. The deciding question is whether the exported value is
  framework doctrine with multiple consumers, not whether another package would
  find the helper convenient.
- A rule-local policy list can masquerade as owner data, or owner data can be
  prematurely centralized as policy. The policy-vs-projection test above is the
  guardrail.

## Non-goals

- Rewriting every Warden rule in this ADR. This decision tells later rewires
  where their data should come from.
- Renaming public `transport*` symbols to `surface*`. That compatibility plan
  belongs with the surface error-projection and public-boundary cleanup work.
- Defining connector descriptors. Connector owner data belongs with the
  connector-discovery decision once that model lands.
- Creating a universal metadata registry for all framework facts.

## Non-decisions

- The exact exported shapes for each owner module. The immediate work items can
  choose the smallest typed shape that satisfies their consumers.
- Whether owner exports live on root package barrels, narrower subpaths, or
  both. Public-boundary cleanup decides supported import paths.
- Whether future advisory skills consume owner exports directly or through a
  Warden report. Both are compatible with this decision.

## References

- [Tenets: One write, many reads](../tenets.md#one-write-many-reads) - the
  governing principle this ADR applies to framework internals
- [Tenets: The information architecture](../tenets.md#the-information-architecture) -
  distinguishes authored, projected, enforced, inferred, observed, and
  overridden data
- [ADR-0000: Core Premise](0000-core-premise.md) - establishes contract-first,
  surface-agnostic design
- [ADR-0007: Governance as Trails with AST-Based Analysis](0007-governance-as-trails.md) -
  makes governance part of the Trails model
- [ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract](0026-error-taxonomy-as-transport-independent-behavior-contract.md) -
  provides the current error-taxonomy example of owner-held behavior data
- [ADR-0035: Surface APIs Render the Graph](0035-surface-apis-render-the-graph.md) -
  frames surfaces as graph projections
- [ADR-0036: Warden rules ship only as trails](0036-warden-rules-ship-only-as-trails.md) -
  keeps Warden's public rule shape aligned with Trails primitives
