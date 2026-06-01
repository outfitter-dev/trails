---
slug: adapter-authoring-as-a-paved-path
title: Adapter authoring as a paved path
status: draft
created: 2026-05-28
updated: 2026-05-30
owners: ['[galligan](https://github.com/galligan)']
depends_on: [29]
---

# ADR: Adapter authoring as a paved path

## Context

Trails already has adapters — and an unwritten, tribal way of authoring them.

The repeated shapes are already in the repo: `@ontrails/store/adapter-support`, `@ontrails/store/testing`, `@ontrails/store/jsonfile`, `@ontrails/http/fetch`, `@ontrails/http/bun`, `@ontrails/permits/testing`. A contributor adding a new adapter has to reverse-engineer all of it — which subpath is support, which is a built-in adapter, which is conformance, whether the package belongs under `adapters/` or as a subpath, and which tests prove it conforms. Correctness lives as a checklist in a maintainer's head, not as something the framework produces. The result is drift: adapters that diverge in shape, exports that don't match their package metadata, conformance that was never wired.

The first pass at this ruled "write the ADR and the conformance suites, but defer the scaffold and the checks." That was too timid. A paved path you can't walk isn't paved — if correctness isn't generated into the adapter from the first command, it stays a checklist, and the drift continues. We have enough prior art (the repeated owner-bundle shapes above) and enough evidence of drift to build the path now, not later.

## Decision

Adapter authoring becomes a first-class Trails capability now — as an **authoring system**, not a runtime primitive.

### No `adapter()` primitive — the capability is the authoring system

An adapter remains a **package or subpath category**, exactly as [ADR-0029](../0029-connector-extraction-and-the-with-packaging-model.md) defines it. We do **not** add an `adapter()` runtime primitive. What becomes first-class is everything *around* authoring an adapter: owner-published support, generated scaffolds, generated conformance, derived cataloging, and shared checks.

The test: can existing primitives and categories already express an adapter? Yes — adapters are already a package/subpath category. The gap is authoring *ergonomics*, which is tooling, not a runtime concept. Solving an authoring problem by adding a runtime abstraction would invert the cost: more public surface to carry, for a problem that lives entirely at author time.

### The owner owes the authoring bundle

> If a package invites adapters, it owes adapter authors an authoring bundle.

The owner package owns the truth an adapter must conform to. It already does — informally. This ADR makes the obligation explicit:

```text
@ontrails/<owner>
@ontrails/<owner>/adapter-support   support helpers an adapter needs
@ontrails/<owner>/testing            conformance cases, as a factory
@ontrails/<owner>/trails             owner-side trails where relevant
package.json trails.adapterTargets   the small facts derivation can't know
```

This is not a new source of truth. It is the owner's existing contract, made explicit and reusable. The owner writes the contract and its conformance cases once; every adapter's scaffold, tests, and checks read from them. One write, many reads — applied to adapter authoring.

### Two placements, both first-class

The choice between an extracted package and a subpath is **`placement`** — not `kind`, which already carries store-domain meaning in the lexicon ([ADR-0023](../0023-simplifying-the-trails-lexicon.md)).

- **Extracted** adapters live under `adapters/` when they earn a dependency or release boundary — `@ontrails/hono`, `@ontrails/drizzle`, `@ontrails/commander`, `@ontrails/vite`.
- **Subpath** adapters live inside the owner package when [ADR-0029](../0029-connector-extraction-and-the-with-packaging-model.md)'s dependency-boundary test says a standalone package would add ceremony without buying a real boundary — `@ontrails/http/bun`, `@ontrails/store/jsonfile`, platform-native and built-in materializers.

The placement choice *is* the dependency-boundary test from ADR-0029. Subpath adapters are a first-class carve-out — they should get the same scaffold and conformance path as extracted ones, not hand-authored exception status. The first implementation scaffolds extracted HTTP adapters and owner-package HTTP subpath adapters from the same catalog facts. The shared check engine still discovers extracted workspace adapter subjects first; subpath subject discovery remains follow-up drift-check coverage, not a reason to block scaffold generation.

```bash
trails create adapter hono --target http  --placement extracted
trails create adapter edge --target http  --placement subpath
```

### Metadata is derived; authors write only what derivation can't know

The drift guard applies: derive everything possible from the export map, dependencies, and workspace path.

**Do not author** the canonical import (the export map says it), the dependency boundary (`package.json` says it), the `adapters/`-vs-`packages/` location (the path says it), or conformance presence (the test import or export map proves it).

**Author only** what derivation cannot know: the adapter target (`http`, `store`, `permit`, `observe`), supported placements, the owner support/conformance imports, any required template families or fixtures, and genuinely freeform human guidance.

The discoverability substrate is the package manifest, which keeps discovery cheap and avoids forcing runtime adapters to import a tooling package:

```json
{
  "trails": {
    "adapterTargets": {
      "http": {
        "placements": ["extracted", "subpath"],
        "supportImport": "@ontrails/http/adapter-support",
        "testingImport": "@ontrails/http/testing",
        "conformance": {
          "adapterType": "HttpAdapterConformanceAdapter",
          "casesFactory": "createHttpAdapterConformanceCases",
          "runner": "runConformance"
        }
      }
    }
  }
}
```

TRL-861 codifies the base metadata shape: `placements` is required, while `supportImport` and `testingImport` are optional until the owner actually exports support or conformance surfaces. TRL-805 adds the `conformance` helper metadata needed by `create.adapter`; optional still means "not available yet," not "tooling should guess."

### The adapter kit consumes facts; it never owns adapter truth

The adapter kit starts as internal `@ontrails/adapter-kit`: it discovers owner targets, scaffolds extracted and owner-package subpath adapters, generates conformance tests, generates package/export skeletons, runs the shared check engine, and reports readiness. It does **not** define an `adapter()` primitive, own HTTP/store/permit/observe semantics, get imported by runtime adapters, or re-author package facts that `package.json` already states.

Two structural rules keep it tooling and not truth:

- **It starts internal, not author-facing.** The CLI and Warden consume it, so it must be publishable with those packages; runtime adapters never import it. Keeping it out of the adapter authoring surface is what makes "tooling, not truth" structural rather than aspirational.
- **The no-import boundary is enforced, not documented.** A Warden rule asserts that runtime adapters do not import the tooling package, and that conformance cases resolve only from owner `/testing` exports — never re-defined in the tooling. This is owner-first authority, made a rule rather than a paragraph.

### Conformance is a thin call into an owner-owned dynamic factory

The owner exports conformance as a factory, not a static suite:

```typescript
createHttpAdapterConformanceCases(...)
createStoreAccessorContractCases(...)
createPermitAdapterConformanceCases(...)
```

The generated adapter test is a **thin call** into that factory — it re-derives the *current* cases at test time:

```typescript
import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';
import { bunHttpAdapter } from './index.js';

test('http adapter conformance', () => {
  runConformance(bunHttpAdapter, createHttpAdapterConformanceCases());
});
```

When the owner adds a case, every adapter's conformance picks it up with no regeneration. This is `testAll`'s property — one write, always-current reads — applied to adapters. **Manual conformance wiring** — making the author remember which suite to import and copy — is rejected: it pushes correctness into documentation, where it rots.

### One check engine, two surfaces

A single check engine lives in the tooling package. Two surfaces consume it:

```text
shared adapter check engine
  -> Warden adapter rules / scoped adapter check   (governance, CI)
  -> trails adapter check                          (local author workflow)
```

Warden owns governance — CI findings, repo drift, severity, scoped checks. `trails adapter check` owns the author workflow — focused readiness, friendly reports, repair hints, fast local iteration. The export-map, dependency-direction, placement, conformance, and metadata checks live **once**. `trails adapter check` is not a second Warden; it's the local surface over the same facts.

The first implementation launches this check loop as **opt-in** for existing adapter packages: malformed `trails.adapter` metadata fails, but packages that have not yet declared adapter metadata are ignored until their migration issue lands. That keeps local and CI checks truthful while TRL-872 migrates the remaining first-party adapters into the metadata model. The steady-state doctrine remains governed adapter drift from one engine.

### Commands are trail-shaped

The user-facing commands are trails, so adapter authoring is queryable without a new runtime primitive: `create.adapter` projects to `trails create adapter`; `adapter.catalog` / `adapter.describe` / `adapter.check` project to `trails adapter catalog | describe | check`.

## Non-goals

- An `adapter()` runtime primitive.
- A central adapter truth source or registry that owns owner semantics.
- An extracted-only model — subpath materializers stay first-class (ADR-0029).
- Warden-only or CLI-only checks.
- A big-bang conversion of every existing adapter — dogfooding is incremental.

## Consequences

### Positive

- Adapter authors get correctness from the first command — scaffold, generated conformance, and checks — instead of a checklist.
- Owners gain a clear, explicit obligation (the authoring bundle) in place of an implicit one.
- Subpath and extracted adapters are both paved — no second-class hand-authored materializers.
- Adapter drift becomes a governed CI finding *and* a local author signal, from
  one engine once packages opt into, or migrate onto, the adapter metadata
  model.
- Adapter authoring is queryable (`catalog` / `describe` / `check`) without adding a runtime primitive.

### Tradeoffs

- Owners take on upfront work: publishing the bundle (support, conformance factory, fixtures, metadata).
- A new internal tooling package to maintain.
- A metadata convention (`package.json` `trails.adapterTargets`) to uphold and derive against.

### Risks

- **The tooling drifts into owning adapter truth** (a primitive by stealth). Mitigation: the package stays internal/tooling-owned, the Warden no-import rule, and the consume-not-own boundary as enforced doctrine.
- **Conformance drifts** from the owner contract. Mitigation: generated tests are thin calls into the owner factory — cases are re-derived, never copied.
- **Over-scoping.** Mitigation: tracer-first sequencing — prove the whole loop on one owner before fanning out.

## Non-decisions

- Whether the adapter kit ever becomes author-facing; the current package stays internal.
- Exact command flags.
- How Warden scopes to a single adapter — build the shared engine first, then expose a scope without a second rule path.

## Implementation sequence

Tracer-first, so the hardest, most-coupled pieces (the owner conformance factory and the check engine) are proven together on one owner before the scaffold and every other owner depend on their shape:

1. This ADR.
2. **Internal substrate** — the adapter-target metadata shape and read-only catalog derivation.
3. **HTTP tracer** — `@ontrails/http` conformance factory + the shared check engine + one hand-authored http adapter, proving the whole loop on a single owner.
4. **`adapter.check` + Warden adapter checks** over the proven engine.
5. **`create.adapter`** extracted-package and owner-subpath scaffolding against
   the proven loop.
6. **Subpath subject discovery** so local checks can discover generated
   owner-package subpath adapters after the scaffold path exists.
7. **Dogfood** — bring existing first-party adapters (`hono`, `commander`, `vite`, `drizzle`, `http/fetch`, `http/bun`, `store/jsonfile`, `permits/jwt`) into the model.
8. **`catalog` / `describe` + docs/fieldguide.**

## References

- [ADR-0029: Adapter Extraction and Composition Around Core Contracts](../0029-connector-extraction-and-the-with-packaging-model.md) — defines the package/subpath adapter categories and the dependency-boundary test that this ADR's `placement` choice rests on.
- [ADR-0023: Simplifying the Trails Lexicon](../0023-simplifying-the-trails-lexicon.md) — why `kind` is reserved (store-domain) and `placement` is the right word for extracted-vs-subpath.
- [ADR-0001: Naming Conventions](../0001-naming-conventions.md) — the vocabulary discipline this follows.
- Existing precedent the path generalizes: `@ontrails/store/adapter-support`, `@ontrails/store/testing`, `@ontrails/store/jsonfile`, `@ontrails/http/fetch`, `@ontrails/http/bun`, `@ontrails/permits/testing`.
- Synthesized from the 2026-05-28 adapter-authoring pathfinding (Matt, Lewis, Clark).
