---
slug: library-surface-and-compiler
title: Library Surface and Compiler
status: draft
created: 2026-06-13
updated: 2026-06-14
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 6, 8, 9, 26, 46]
---

# ADR: Library Surface and Compiler

> Draft authored overnight 2026-06-13 by Clark from the co-signed decision packet
> (`.agents/notes/2026-06-12-library-surface-compiler-decision-packet.md`). Flagged for
> Matt/Lewis review. Replaces the retired compiled-pack draft, which is
> deleted when this lands.

## Context

Trails has surfaces for CLI, MCP, and HTTP. Each takes the trail contract and renders it for a consumption context: CLI into argv and exit codes, MCP into JSON-RPC tools, HTTP into routes and status codes. One consumption context has no surface yet: **plain TypeScript**.

Today, the only way to consume a set of trails from another TypeScript project is through a transport — spin up an MCP client, make HTTP requests, or shell out to the CLI. A project can't just `import { checkThing } from '@acme/thing'` and call a function. That friction discourages reuse and draws an artificial line between "Trails projects" and "everything else."

The motivating consumer is Skillset, which wants a plain `@skillset/core` library boundary — but Skillset is a *future* consumer, not the design center. The design center is the framework's own promise: if the information exists in the contract, don't ask the developer to restate it. Everything a well-built TypeScript library needs — typed schemas, validation, examples, error taxonomy, intent, docs — already lives in the topo. The framework just doesn't emit it in library shape yet. A hand-maintained wrapper around a topo is a drift machine: names, schemas, and error behavior diverge from the contract with nothing catching it.

This ADR adds the **library surface**: a peer of CLI, MCP, and HTTP that renders a topo as an idiomatic TypeScript package. The framing that governs every decision below:

> **Consumer fluency at the root, contract fidelity at the subpath.**

The generated package should feel handwritten, idiomatic, and boring in the best way. Trails stays visible through provenance, schema exports, a result envelope, testing parity, and a Trails-native entrypoint — for adopters who want it, never imposed on those who don't.

## Decision

### The library is a real surface

The library surface sits alongside CLI, MCP, and HTTP with the same derivation posture and the same `surface()` shape. `@ontrails/library` follows peer grammar:

```typescript
import { compile, deriveLibraryApi, surface } from '@ontrails/library';

// Pure projection — what would this topo look like as a library?
const projection = deriveLibraryApi(graph, options); // LibraryProjection

// In-memory materialization — a callable client, executed through the shared pipeline
const client = await surface(graph, options);

// Emitter - a package-shaped TypeScript source tree from the same projection
const result = compile(graph, {
  appImportPath: '@acme/app',
  packageName: '@acme/core',
});
```

Three responsibilities, one resolved projection feeding all of them:

- **`deriveLibraryApi(graph, options)`** — pure projection (no fs/network/db reads), returns the `LibraryProjection` domain noun. The single semantic authority for trail selection, export naming, and collision resolution. The surface and the emitter both consume it; neither reinvents it.
- **`surface(graph, options)`** — materializes the callable library in-process, executing through the shared pipeline (`executeTrail`, per ADR-0006). Peer grammar with `@ontrails/commander`/`mcp`/`hono`.
- **`compile(graph, options)`** — returns a package-shaped TypeScript file plan from the resolved projection. Writing files is a thin apply step outside the compiler.

Public `createLibrary` is **not** part of this ladder. The `createX()` factory (e.g. `createAcmeCore()`) survives only as a *generated consumer-library idiom* — a projected export name recorded in the projection and governed like every other export, never a Trails package helper.

**Library is the first surface whose `surface()` returns a held client** rather than opening a long-running endpoint (a server, a CLI parse). This is not a doctrine exception: same contract, same pipeline, different rendering. The consumption context is "typed function calls in a TypeScript project," and a held client is what that context renders to.

### Naming note: `compile` and the relationship to `trails compile`

The library emitter is `compile` (bare, matching bare `surface`) on `@ontrails/library`. This is distinct from the `trails compile` CLI command that generates the topo artifact family. They share a verb because they share a meaning — *materialize a derived artifact from the resolved graph* — but operate on different outputs (one emits a package, one emits/verifies the lockfile). The ADR names the distinction so the shared verb does not read as a collision.

### Root API: return values and thrown errors are surface error mapping

The root API returns successful output directly and throws on failure. **This is not a violation of "implementations return Result, never throw."** Implementations still return `Result`. The library surface unwraps `Result.ok` to a return value and maps `Result.err` to a thrown package-facing typed error — exactly as HTTP maps `Result.err(NotFoundError)` to a 404 and CLI maps it to exit code 2. The thrown error is the library surface's *representation* of the taxonomy, derived mechanically.

| Surface | `Result.ok` | `Result.err` |
| --- | --- | --- |
| CLI | stdout + exit 0 | stderr + exit code |
| HTTP | body + 2xx | error body + status |
| MCP | JSON-RPC result | JSON-RPC error |
| **Library** | **return value** | **throw typed Error** |

Three layers, three audiences:

```text
shared pipeline  -> Result envelope
root API         -> unwrap ok, throw mapped package-facing error
/result API      -> return the package-facing envelope (no throw)
/trails API      -> Trails-native graph and contracts
```

Domain-negative outcomes that are part of the output schema stay **returned values**, not throws — a check returning `status: 'fail'` is a successful execution with a negative result, not an error.

The library error mapper is a registered surface mapper built with `createSurfaceErrorMapper` and is therefore covered by the `error-mapping-completeness` Warden rule. It inherits future taxonomy categories automatically (e.g. `shift`, when TRL-956 lands). No hand-rolled per-package taxonomy can drift from the contract. The mapper maps category → a package-facing error *class* (not a numeric code), so it uses the generic mapper factory without joining the numeric `surfaceErrorMap` registry that CLI/HTTP/MCP share.

### What crosses the boundary, and what does not

Harvested from the prior draft and still correct:

| Crosses the boundary | Does not cross |
| --- | --- |
| TypeScript types (input, output) | `Result` (unwrapped to return/throw) |
| Error classes (as standard `Error` subclasses) | `TrailContext` (dissolved into the client / constructor) |
| JSDoc (from descriptions, meta, examples, intent) | `composes` declarations (internal wiring) |
| `dispose()` when the topo owns disposable resources | Warden rules (compile-time only) |
| Schemas (opt-in, `./schemas`) | Layers (internal pipeline concern; their *inputs* still project — see below) |

The principle: **the framework disappears, the contract survives.** An ordinary consumer never imports `TrailsError`, sees `Result`, or learns a Trails concept. They get typed functions, typed errors, and (when needed) a typed client with a disposal hook.

### Projected input includes layer inputs

`deriveLibraryApi` projects each trail's input schema into the generated method signature — and that input is not only the trail's own schema. Typed layers can declare input schemas (ADR-0043), and surfaces already project them (the `layer-field-name-drift` Warden rule exists for this). The library surface must project layer-declared input fields alongside trail input, or generated methods will ask for trail fields while silently dropping layer fields. One resolved input, trail and layers together.

### Default inclusion

`deriveLibraryApi` projects, by default:

- established public trails only; `internal` visibility excluded; `_draft.` IDs excluded;
- current-version projection for versioned trails;
- public surface contract rules apply (output schema required where the trail is exposed).

An explicit `include` list narrows; it never widens internal or draft trails into the surface. Selection reuses the established trail-filter grammar (`filterSurfaceTrails`, `matchesTrailPattern`): exact IDs, explicit lists, `*` (one segment), `**` (multi-segment). The library does not invent a second selector grammar.

### The normalization test

Every library export must answer one question:

> Can this export be normalized into the same trail contract without lying?

If yes, the export is a surface rendering of that trail. It may use a consumer-native name, return/throw at the library boundary, and appear in different subpaths, but it still resolves to one trail contract. If no, it is not an export accommodation. It is a different capability and should be modeled as a different trail.

### The runtime kernel: the path to standalone

The v0 generated library is **runtime-backed**, not standalone: execution delegates to a Trails runtime layer. But "runtime-backed first, standalone later" is only safe if standalone is reachable as a *delivery swap* rather than a rewrite. The mechanism is a **runtime kernel**.

A compiled library's irreducible framework runtime is small: `Result` (a pure ~90-line value type), the error classes (the taxonomy is data), a context shim, the `compose` dispatcher, layer ordering, and the `executeTrail` orchestration. Stripped of the authored implementation and Zod, that set is a few hundred dependency-free lines. The blocker to standalone has never been size — it is *entanglement*, because those primitives live throughout `@ontrails/core`.

The decision:

- Define a minimal, dependency-free **runtime kernel** — the smallest execute surface a compiled library needs.
- v0 generated packages **import** the kernel: a tiny, named, stable dependency, not all of `@ontrails/core`.
- Standalone (deferred) **vendors/inlines** the kernel into the generated package: same code, import becomes inlined, consumer code and package derivation unchanged.

This extends the surface's stability invariant to a third axis — the public API holds across **in-process, binary-backed, and standalone** execution. The load-bearing discipline, enforced from the first commit: the in-memory surface and the generated package route every framework need through the **named kernel surface**, never through ad hoc `@ontrails/core` deep imports. That single rule is what keeps standalone a vendoring step.

**Scope of the standalone claim.** "No `@ontrails/*` runtime dependency" is the realistic target. Zod remains a peer dependency (already true for the `/schemas` path; it is the validation engine). "Zero runtime dependencies including Zod" is a further reach requiring precompiled validator functions — a named stretch goal, gated and deferred. This ADR supersedes the prior draft's "inline/generate everything, no runtime dependency" headline with the staged kernel path: the prior draft had the right destination and an over-eager v0.

### Schemas and JSON Schema as opt-in projections

The root API is function-first and requires no schema-library knowledge. For consumers who want more:

```typescript
import { checkThing } from '@acme/core';            // primary: no Zod required
import { schemas } from '@acme/core/schemas';        // opt-in: authored Zod schemas
schemas.checkThing.input.parse({ ... });
// @acme/core/schema.json                            // opt-in: zero-runtime JSON Schema
```

The schemas come from the authored trail contract, never regenerated approximations. The current emitter writes named Zod schema exports in `./schemas` and a `schemas` object keyed by generated export name. JSON Schema is a *projection* from the authored Zod, designed up front even if implementation slips a slice. It serves editor tooling, CI, config validation, and non-TypeScript consumers, and Trails itself benefits from cheap publishable contract artifacts. JSON Schema is never a competing source of truth; the Zod schema (via `./schemas`) is authoritative. Packaging shape (single `schema.json` vs per-trail vs both) is a deferred detail.

### v0 package shape: subpaths

The generated package is one package with subpath exports — no sibling packages in v0:

```json
{
  "name": "@acme/core",
  "exports": {
    ".": "./src/index.ts",
    "./result": "./src/result.ts",
    "./schemas": "./src/schemas.ts",
    "./trails": "./src/trails.ts",
    "./package.json": "./package.json"
  }
}
```

`.` is the consumer-fluent root (named exports / emitted `createX()` factories). `./result` is the no-throw envelope. `./schemas` is the opt-in Zod. `./trails` is the full-fidelity Trails-native entrypoint for composition, contract tests, and graph inspection. Sibling-package separation and a standalone CLI companion (both in the prior draft) are real futures, deferred past v0.

### The resolved projection lives in the artifact family

The resolved `LibraryProjection` — every export name, its source (derived / trail-owned hint / package config), its target trail ID, and every collision decision — is graph content, governed like the rest of the resolved topo artifact family (ADR-0046): manifest-verified, CI-diffable, queryable by Topography, Wayfinder, and Warden. The emitter consumes it; it does not privately invent it.

The projection embeds in `topo.lock` as part of `TopoGraph`. That follows the existing precedent for resolved surface projections rather than introducing a separate hashed artifact role for one surface. Topography serializes the durable facts (exports, exclusions, collisions, schemas, resources, version, and source metadata); `@ontrails/library` keeps the richer runtime Zod references for in-memory calls and package emission.

### Current governance and dogfood proof

The first implementation slices intentionally prove the surface through both artifact governance and a real generated-package consumer:

- Topography embeds durable `TopoGraph.library` facts.
- Warden's `library-projection-coherence` rule checks that serialized library exports still target known trails and that export-name collisions stay visible.
- `bun run library:smoke` typechecks and dry-run packs a generated fixture package.
- `bun run library:dogfood:warden` compiles the Warden topo into a generated package, typechecks it, runs root/result/schemas/trails subpath consumer assertions, and dry-run packs it.

That dogfood intentionally exercises a repo-owned topo with many rule trails. It also exercises explicit source trail type bindings for generated public signatures, rather than pretending `topo.lock` preserves erased TypeScript generic information.

### The binary runtime, designed not built

Generated libraries must never require a globally installed runner. Trails provides the reusable runner engine and a stable machine protocol, specified **once**; the compiled package owns its binary's name, artifact, version, and distribution. The protocol carries taxonomy behavior data (category, `retryable`, the established jsonRpc codes) — it is transport #5 under the ADR-0026 behavior contract, not a new error format. One-shot execution comes first; a long-lived stdio session is an architectural commitment (the protocol must not assume one process spawn per call forever); watch/streaming is a later addition that must not require a redesign. v0 designs the protocol; the first code slice need not fully implement the binary path.

## Non-goals

- Standalone dependency-free runtime output (the kernel makes it reachable; v0 does not ship it).
- Pack/depot semantics as the library boundary (topo-first; packs remain future doctrine).
- Signal subscription projection.
- Compiled-library semver / breaking-change governance.
- Non-TypeScript targets (Python, Go).
- Docs-site generation; source-TSDoc harvesting (the compiler reads the resolved contract).
- A full Skillset port — Skillset is a future consumer, not this work's planning center.

## Consequences

### Positive

- A topo becomes a publishable, idiomatic TypeScript library with zero additional authoring — schemas, types, validation, docs, and error handling are already on the contract.
- One authored contract feeds the library the same way it feeds CLI/MCP/HTTP: define once, surface everywhere, now including plain TypeScript.
- `testExamples(app)` already validates every trail against every example; the library surface is tested by the same examples through a parity suite — generated exports must produce results identical to `run()`.
- The kernel makes "runtime-backed now, standalone later" a promise the framework can actually keep, instead of a deferral that becomes a rewrite.
- A hand-maintained wrapper's drift is replaced by a derived, CI-diffable projection.

### Tradeoffs

- Zod as a peer dependency for the `/schemas` path (and, in v0, for root validation). The primary path stays Zod-free for the consumer; the schema path is explicitly opt-in.
- JSON Schema fidelity: refinements, transforms, and complex unions may convert lossily. The Zod schema remains the source of truth; JSON Schema is a convenience projection.
- Resource→constructor projection is genuinely hard to make idiomatic across the range of resource shapes (injected instance vs config-created). v0 may implement the simple cases but must not bake in a no-resource assumption.
- Compiler complexity: declaration flattening for clean `.d.ts` without leaking `@ontrails/*` types, and extracting just enough execution runtime, are the hardest engineering parts — concentrated, deliberately, in the kernel.

### What this does not decide

- The exact kernel module boundary and whether it ships as a published `@ontrails/runtime`-style package or stays internal until standalone work begins.
- Standalone kernel vendoring and binary-backed package execution.
- Package-facing error class naming (package-prefixed vs plain).
- Long-lived session protocol details.
- Resource mock re-export across the library boundary for consumer testing.
- Whether precompiled validators (Zod elimination) are pursued for the zero-dependency stretch goal.

## References

- [ADR-0000: Core Premise][adr-0000] — "define once, surface everywhere"; the information architecture this surface derives from.
- [ADR-0006: Shared Execution Pipeline][adr-0006] — `executeTrail`; the library surface delegates to the same pipeline, and the kernel is its minimal extract.
- ADR-0008: Deterministic Surface Derivation — the derivation properties
  (pure, deterministic, overridable) `deriveLibraryApi` follows.
- [ADR-0009: First-Class Resources][adr-0009] — lifecycle/dispose/mock the library projects into the client.
- [ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract][adr-0026] — the library error mapping is one more transport reading the same contract.
- [ADR-0043: Layer Evolution][adr-0043] — layer input schemas; the library projects them alongside trail input.
- [ADR-0046: Lock v3 Artifact Family][adr-0046] — where the resolved library projection is governed.
- Replaces the retired compiled-pack draft. Its reusable substance was
  harvested here; the old draft file is deleted by this change.

[adr-0000]: ../0000-core-premise.md
[adr-0006]: ../0006-shared-execution-pipeline.md
[adr-0009]: ../0009-first-class-resources.md
[adr-0026]: ../0026-error-taxonomy-as-transport-independent-behavior-contract.md
[adr-0043]: ../0043-layer-evolution.md
[adr-0046]: ../0046-lock-v3-artifact-family.md
