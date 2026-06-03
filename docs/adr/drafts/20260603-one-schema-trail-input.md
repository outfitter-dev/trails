---
slug: one-schema-trail-input
title: One-Schema Trail Input
status: draft
created: 2026-06-03
updated: 2026-06-03
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 6, 20, 24, 48]
description: "Records proposed doctrine for deriving caller-side and blaze-side TypeScript input projections from one authored trail input schema without adding public callInput/blazeInput fields."
references:
  - docs/adr/0000-core-premise.md
  - docs/adr/0006-shared-execution-pipeline.md
  - docs/adr/0020-flags-for-fields-structured-input-on-the-cli.md
  - docs/adr/0024-typed-trail-composition.md
  - docs/adr/0048-trail-versioning-v3.md
linear:
  - TRL-881
  - TRL-883
  - TRL-884
impl_status: proposed
---

# ADR: One-Schema Trail Input

## Status

This doctrine is proposed, not accepted. It records the Lewis/Clark input-shape convergence from TRL-881 so implementation can stay oriented, but ratification depends on TRL-884 proving the schema-owned typing model affordable under the TRL-882 consumer type-cost guard.

## Context

Trails already promises one input schema per trail. That schema feeds validation, surface derivation, examples, composition, guide output, survey output, and the resolved graph. Almanac adoption exposed a TypeScript pressure point inside that promise: a schema with defaults naturally has two TypeScript views.

Callers may omit defaulted fields. The blaze receives the parsed value after validation/defaulting and can rely on those fields being present. Splitting the public authoring API into `callInput` and `blazeInput` would make that difference explicit, but it would also create a second authored contract and a new place for drift.

The framework should absorb that distinction internally. The author writes one schema. Trails reads it as caller-side input at public boundaries and as materialized input at the blaze boundary.

## Decision

### One authored input schema, two internal reads

> A trail has one authored input schema. The framework reads it two ways — what a caller may send, and what the blaze receives — but only the first is ever public. We do not author the split; we derive it. Contract schemas validate and default; they never transform.

Internally, the framework may use `z.input<S>` and `z.output<S>` to derive the caller-side and blaze-side TypeScript projections from the authored schema. Those are implementation projections, not public ontology. Guide, survey, and resolved graph output continue to expose one input contract.

### Validation matrix

| Schema feature | Proposed treatment |
| --- | --- |
| Optionality and defaults | Allowed. Defaults are the sanctioned source of visible caller/blaze divergence: callers may omit defaulted fields; blazes receive materialized values. |
| Standard type-preserving refinements | Allowed and queryable where Zod and Trails projection support them. Examples include common string, number, array, and enum constraints. |
| Type-preserving custom `.refine()` | Allowed but opaque. Prefer standard refinements when the contract should be queryable. |
| Type-changing `.transform()` | Deferred to a future adapter/codec ADR. Contract schemas validate/default only in v1. |
| `.pipe()` to a new type | Deferred to the same adapter/codec story as transforms. |
| `.coerce()` | Deferred. Coercion belongs to surfaces and materialization, not trail contract schemas. |
| Codecs | Deferred to an explicit future adapter/codec story. |
| `.catch()` | Discouraged because it converts boundary failure into silent fallback. |

Coercion is a surface/materialization concern. For example, a CLI surface may parse argv strings into booleans or numbers before validation. The trail schema then validates and defaults that materialized boundary input; it does not own transport-specific coercion.

### Public contract shape

Public surfaces expose caller-side input:

- CLI flags and args derive from the authored input schema.
- HTTP request bodies and query parameters derive from the authored input schema.
- MCP `inputSchema` derives from the authored input schema.
- `ctx.compose()` accepts caller-side input for the target trail, plus any explicitly declared composition-only fields.
- `examples[].input` is caller-side input and must not be forced into post-default or materialized shape.

Blazes receive materialized input after validation/defaults. That is a type system guarantee and an execution-pipeline guarantee, not a second public contract.

Historical version transpose stays materialized-to-materialized: a historical revision validates the historical caller input, materializes it through that historical schema, transposes into the current materialized input shape, runs the current blazed trail, then transposes current materialized output into the historical output shape.

### Resolved graph and guidance

Guide, survey, and resolved graph output continue to expose one input contract with field metadata such as `type`, `optional`, `default`, and `describe`. They must not expose separate public `accepted` or `materialized` contracts.

If tooling needs to explain defaults, it should say that fields with defaults may be omitted by callers and are present when the blaze runs. It should not ask authors or consumers to learn a second input-contract vocabulary.

### Non-goals

- Do not introduce public `callInput`, `blazeInput`, `accepted`, or `materialized` authoring fields.
- Do not create the future adapter/codec API here.
- Do not ban defaults.
- Do not make examples post-default/materialized input.
- Do not expose internal projection names as published graph vocabulary.

### Ratification bar

This draft becomes acceptable only if TRL-884 proves that schema-owned typing can make the TRL-882 guard pass under default heap and the current allowed Zod range while preserving schema precision. If the guard shows the causal variable is not the current free-generic input inversion, this doctrine should be revisited before implementation is ratified.

## Consequences

### Positive

- Trail authors keep one public input schema and do not author a `callInput`/`blazeInput` split.
- Defaults become an explicit, sanctioned way for caller-side and blaze-side TypeScript shapes to differ without creating contract drift.
- Examples stay caller-facing and continue to serve documentation, testing, and agent guidance.
- Surface and graph projections stay aligned with the Tenets: one input contract, many reads.

### Tradeoffs

- Trails must reject or defer schema features that change the TypeScript type between input and output until an adapter/codec model exists.
- Some Zod custom refinements remain opaque to guide/survey output even when they are type-preserving.
- The type system carries more responsibility: it must preserve schema precision while avoiding the consumer type-cost cliff that motivated this draft.

### Open until TRL-884

The doctrine is not ratified until the implementation proves affordable under the guard from TRL-882. If preserving precision requires a public two-input API or a topo-wide string-id input map, this draft should stay unaccepted.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md)
- [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md)
- [ADR-0020: Flags for Fields, Structured Input on the CLI](../0020-flags-for-fields-structured-input-on-the-cli.md)
- [ADR-0024: Typed Trail Composition](../0024-typed-trail-composition.md)
- [ADR-0048: Trail Versioning v3](../0048-trail-versioning-v3.md)
- [TRL-881: Stabilize the one-schema trail input model for Almanac adoption](https://linear.app/outfitter/issue/TRL-881/stabilize-the-one-schema-trail-input-model-for-almanac-adoption)
