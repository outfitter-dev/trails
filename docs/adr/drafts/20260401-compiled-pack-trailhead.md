---
slug: compiled-pack-trailhead
title: Compiled Pack Trailhead
status: draft
created: 2026-04-01
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [6, 8, 9, 23]
---

# ADR: Compiled Pack Trailhead

## Context

Trails has three trailheads today: CLI, MCP, and HTTP. Each one takes the trail contract and projects it into a consumption context. CLI projects into process.argv and stdout. MCP projects into JSON-RPC tool definitions. HTTP projects into request/response with route derivation. The pattern is consistent: the trail is the product, the trailhead is the rendering.

But there's a consumption context that doesn't have a trailhead yet: plain TypeScript.

When a developer builds a set of trails, the only way to consume them is through a trailhead protocol. Another TypeScript project can't just `import { validate }` and call a function. It has to spin up an MCP client, make HTTP requests, or shell out to the CLI. That's friction that discourages reuse and creates an artificial boundary between "Trails projects" and "everything else."

Meanwhile, library authors in the broader TypeScript ecosystem face a different version of the same problem. They hand-maintain types, write validation logic, build a CLI separately from the programmatic API, write docs that drift from the code, and copy schema information across package boundaries. Every library is an exercise in keeping multiple representations of the same contract in sync.

Trails already solves this. The pack graph already carries typed schemas, validation, examples, error taxonomy, intent, and meta (`meta`). It carries everything a well-built library needs. The framework just doesn't emit it in that shape yet.

The core principle says: if the information exists in the system, don't ask the developer to restate it. The information for a publishable library already exists in the pack graph. The framework should derive the library trailhead the same way it derives CLI commands and MCP tools.

### Why the pack is the right compilation unit

A trail is too granular for a library boundary. A single `validate` function doesn't form a useful package. The pack is the natural module: it owns the resource graph, the signal topology, the namespace, and the configuration trailhead. It's the unit of coherence.

Compiling at the pack level means resources resolve once at construction (not per-call), internal composition via crosses stays hidden behind the public API, and the pack's namespace maps directly to the library's API trailhead. This matches how every real library works: you instantiate a client, then call methods.

A topo without pack structure can still compile, but the pack is where this design wants to go. If a pack doesn't make sense as a library, that's useful feedback on the pack design.

### The library trailhead is not "exporting internals"

A library is not a window into Trails. It is a trailhead projection for in-process consumption, the same way CLI is a trailhead projection for terminal consumption. The contract layer sits above implementations and below trailheads. The library trailhead sits alongside CLI, MCP, and HTTP as a peer, with the same derivation posture and the same `build*` wiring shape.

## Decision

### Part 1: Programmatic consumption is a first-class trailhead

The library trailhead compiles a pack (or topo) into a publishable npm package. Like CLI, MCP, and HTTP, it is a projection of the trail contract into a consumption context. The consumption context is "typed function calls in a TypeScript/JavaScript project."

The compile step walks the pack and signals:

- A **factory function** (when the pack declares resources or config) or **bare exports** (when it doesn't)
- A **method per trail**, typed from input/output schemas, with JSDoc derived from meta and examples
- **TypeScript declarations** (`.d.ts`)
- **Error classes** re-exported from the error taxonomy, mapped to standard throws

The library trailhead follows the same derivation properties as every other trailhead (per ADR-008): pure, deterministic, explicit lookup tables, overridable. Trail IDs become method names. Intent informs JSDoc annotations. Examples become documentation. Error taxonomy maps to thrown Error subclasses instead of exit codes or HTTP status codes.

### Part 2: The runtime shape

#### Factory pattern (packs with resources or config)

When a pack declares resources or config, the compiled library exports a factory function. The factory projects pack-level dependencies into consumer-supplied inputs. Config schemas become configuration parameters. The exact projection shape for resources is intentionally left flexible so the compiler can map resource declarations into the most idiomatic constructor interface (concrete connector instances, config-driven creation, or some mix).

```typescript
import { createEmailKit } from '@acme/email-kit'

const email = createEmailKit({
  smtp: mySmtpClient,
  templates: myTemplateDir,
})

await email.validate({ address: 'test@foo.com' })
await email.send({ to: '...', body: '...' })
```

The factory name follows the `create*` convention from ADR-001. Method names come from trail IDs. The returned instance is a **runtime instance** with lifecycle ownership, not just a bag of functions.

#### Bare exports (packs with no resources or config)

When a pack has no resource or config declarations, the compiled library exports bare async functions. No factory, no construction step. Just import and call.

```typescript
import { validate, normalize } from '@acme/email-utils'

const result = await validate({ address: 'test@foo.com' })
```

The compiler determines which pattern to use from the pack's declarations. No configuration needed.

#### Lifecycle ownership

When a pack declares resources with disposal, the generated runtime instance owns their lifecycle. This means:

- The factory (`createEmailKit(...)`) initializes resources
- The instance exposes `dispose()` for teardown
- Resource health and startup failures surface as thrown errors from the factory (consistent with how `trailhead()` handles builder failures on other trailheads)

```typescript
const email = createEmailKit({ smtp, db })

// Use it
await email.send({ to: '...', body: '...' })

// Clean up
await email.dispose()
```

This makes the compiled library instance effectively a generated connector runtime. That's okay. The consumer sees a client with typed methods and a disposal hook. Internally, it's a pack with trailheads stripped away and resources wired through.

When the compiled pack owns disposable resources, the generated instance exposes `dispose()`. Packs with no owned disposal do not project lifecycle they do not need.

### Part 3: What crosses the boundary, and what doesn't

| Crosses the boundary | Does not cross the boundary |
| --- | --- |
| TypeScript types (input, output) | Result type (unwrapped to return/throw) |
| Error classes (as standard Error subclasses) | TrailContext (dissolved into constructor params) |
| JSDoc (from meta, descriptions, examples) | Cross declarations (internal wiring) |
| `dispose()` when pack owns disposable resources | Warden rules (compile-time only) |
| | Layers (internal pipeline concern) |

The principle: **the framework disappears, the contract survives.** The primary library trailhead does not require consumers to know Zod, Trails, or any framework concept. They get typed functions, typed errors, and lifecycle management. That's a complete library.

#### Strong preference: no `@ontrails/*` runtime dependency

The compiled library should not require consumers to install `@ontrails/*` packages. Error classes, type utilities, and any runtime shims needed should be generated or inlined into the compiled output.

This is a strong preference, not a sacred law. There may be value in a tiny stable runtime shim for error base classes or signal subscription primitives in the future. But the default posture is: the compiler output stands alone.

### Part 4: Schema exports as opt-in secondary paths

The primary library contract is typed methods and typed errors. No schema library knowledge required.

For consumers who want deeper access, the compiled package exposes optional subpath exports:

```typescript
// Primary: just call methods (no Zod required)
import { createEmailKit } from '@acme/email-kit'

// Secondary: raw Zod schemas for advanced use
import { schemas } from '@acme/email-kit/schemas'
schemas.send.input          // z.object({ to: z.string(), body: z.string() })
schemas.send.output         // z.object({ messageId: z.string() })

// Secondary: pre-built JSON Schema (zero runtime)
// Available at @acme/email-kit/schema.json
```

This is progressive disclosure at the package level:

**Primary path** (no Zod dependency): Import the library. Call methods. Catch typed errors. Done.

**Zod path** (Zod as peer dependency): Import from `./schemas`. Get raw Zod objects for form validation, test data generation, OpenAPI derivation, or any Zod ecosystem tool. Zod becomes a peer dependency only when this subpath is imported.

**JSON Schema path** (zero runtime): Reference `schema.json` for cross-language validation, IDE integration, CI pipelines. Any tool that understands JSON Schema can consume it without executing JavaScript.

The Zod schemas are the raw objects the developer authored. No wrapper, no abstraction. But they're a secondary export, not the headline contract. Consumers who don't use Zod never encounter it.

#### Why Zod is secondary, not primary

Trails is explicit that Zod is the schema **authoring** language, but Trails owns validation, type extraction, and reuse semantics. Making raw Zod the primary library trailhead would quietly invert this: the compiled output would be "a Trails app that leaks its schema substrate" rather than "a library derived from a trail contract."

Raw Zod is useful. It should be available. But the primary trailhead should stand on its own without requiring Zod familiarity.

### Part 5: JSON Schema as a derived artifact

The compiled package can include a pre-built `schema.json` derived from the Zod schemas at compile time. This artifact enables consumption contexts that don't run JavaScript:

**IDE integration.** Editors that understand JSON Schema can autocomplete and validate against the library's contract. Config files, fixtures, test data: all schema-aware, no runtime needed.

**CI without runtime.** Validate payloads with `ajv`, `check-jsonschema`, or any JSON Schema validator in any language.

**Cross-language consumption.** A Python or Go service reads `schema.json` and generates its own types and validators. The Trails developer writes TypeScript. The contract reaches everywhere.

The JSON Schema is always in sync with the Zod schemas by construction. It's derived at compile time from the same source.

**Fidelity caveat.** Not all Zod features map cleanly to JSON Schema. Refinements, transforms, and complex discriminated unions may produce lossy conversions. The source of truth is always the Zod schema (available via the `./schemas` subpath). JSON Schema is a convenience projection.

### Part 6: Error handling at the trailhead boundary

The library trailhead unwraps `Result` at the boundary, just as every trailhead translates Results into its native idiom:

| Trailhead | Result.ok mapping | Result.err mapping |
| --- | --- | --- |
| CLI | stdout + exit 0 | stderr + exit code |
| HTTP | response body + 2xx | error body + status code |
| MCP | JSON-RPC result | JSON-RPC error |
| **Library** | **return value** | **throw typed Error** |

Error classes from the error taxonomy are re-exported as standard Error subclasses. Each error has a predictable `.code`, `.message`, and class identity. `instanceof` checks work. TypeScript narrows correctly.

```typescript
import { createEmailKit, NotFoundError } from '@acme/email-kit'

try {
  await email.send({ to: '...', body: '...' })
} catch (err) {
  if (err instanceof NotFoundError) {
    // typed, predictable, documented
  }
}
```

Internally, the trail implementation still returns `Result`. The library trailhead connector unwraps it. This is the same pattern as HTTP mapping `Result.err(NotFoundError)` to a 404 response.

### Part 7: Packaging and publication

#### Default: single package with subpath exports

The compiled output is one package by default. Subpath exports provide tree-shakeable access to optional capabilities:

```json
{
  "name": "@acme/email-kit",
  "main": "./index.js",
  "types": "./index.d.ts",
  "exports": {
    ".": "./index.js",
    "./schemas": "./schemas.js",
    "./schema.json": "./schema.json"
  }
}
```

One install, one package, progressive access. Consumers who just call methods get no Zod in their bundle. Consumers who import `./schemas` pull in Zod as a peer. Consumers who reference `./schema.json` get a static file. Tree-shaking handles the rest.

#### Override: explicit package separation

When the developer wants separate publication (e.g., the CLI is a standalone `npx` tool, or the schema package needs independent versioning for cross-language consumers), they override the packaging strategy:

```typescript
compile(app, { packaging: 'separate' })
```

This produces distinct packages:

```text
@acme/email-kit             # library: factory, methods, types
@acme/email-kit-schemas     # Zod schemas + schema.json
@acme/email-kit-cli         # npx companion
```

This is the third tenet doing its job. Author what's new, derive what's known, **override what's wrong**. The framework derives a single package because that's correct for most cases. The developer overrides to separate publication when it isn't.

#### The CLI companion

Whether bundled (as a `./cli` subpath and `bin` entry) or published separately, the CLI companion is the same trails compiled to the CLI trailhead. Same validation, same errors, same behavior as the programmatic API. The consumer can `npx @acme/email-kit-cli validate --address test@foo.com` without installing the library.

Conventionally, libraries and their CLIs are maintained as separate codebases that inevitably drift. Both trailheads reading the same contract makes drift structurally impossible.

### Part 8: The derived package.json

The `package.json` is itself a projection of the pack:

- Pack name gives the package name
- Trail IDs give the method names
- Resource declarations inform the types (and potential peer dependencies)
- Zod version constraint flows from the framework
- The `exports` map is deterministic from the compile configuration
- If CLI is bundled, `bin` is derived from the pack name

All derived. The developer authored trails. The framework emitted a package.

## Consequences

### For developers who build with Trails

**Zero-cost library publishing.** A developer who builds a pack for their own use can publish it as a library with no additional authoring. The schemas, types, validation, documentation, and error handling are already on the trail definitions. The compile step projects them into a package.

**The CLI companion is free.** Every Trails project can ship a CLI alongside the library. Same validation, same errors, same behavior. No separate Commander setup, no duplicated flag definitions, no maintenance burden. The two trailheads read the same contract.

**Schema propagation as a bonus.** Library authors who use Trails can ship schemas that their consumers use for form validation, test data generation, OpenAPI spec derivation, and more. This is value the library author gets for free because they already wrote the Zod schemas for their own input validation. And it's opt-in for consumers.

**Standalone output.** The published artifact is designed to stand on its own at runtime. Consumers use a normal typed package and do not need Trails knowledge to consume it. The framework is a compiler, not a runtime dependency.

**Testing flows through.** `testExamples(app)` already validates every trail against every example. The library trailhead is tested by the same examples. The warden already checks the contract. Library consumers get the same quality guarantees without a separate test suite.

### For developers who consume Trails-built libraries

**Typed methods, typed errors, nothing else to learn.** The consumer imports functions, calls them, catches typed errors. No framework concepts, no schema library knowledge, no special patterns. Just a well-typed library.

**Full schemas when they want them.** Consumers who want deeper access import from `./schemas` and get raw Zod objects. Form validation, mock generation, OpenAPI derivation. All from the library's own exports, all opt-in.

**Pre-built JSON Schema for cross-language use.** The `schema.json` is a static file. Any language, any tool, any CI pipeline that understands JSON Schema can validate against it. The library's contract is accessible without running JavaScript.

**A CLI they didn't have to build.** If the library ships a CLI companion, the consumer can use it from scripts, CI, or the terminal. No installation required. Same contract, different trailhead.

**They don't need to know about Trails.** The consumer never sees `Result`, `TrailContext`, `crosses` declarations, or warden rules. The framework is invisible.

### What this sharpens about packs

This decision gives a stronger definition to the pack concept. A pack is not just "a scoped group of trails for organization." A pack is a **compilable capability boundary.** This creates useful design pressure:

- **Pack scope = API trailhead.** Which trails are public? The pack boundary answers this.
- **Pack resources = constructor dependencies.** Are resources scoped coherently? The factory signature reveals whether the dependency graph makes sense to an outsider.
- **Pack config = configuration parameters.** Does the config schema produce a reasonable constructor interface?
- **Pack signals = future observable interface.** Which signals are part of the external contract vs. internal announcements?

If a pack doesn't make sense as a library, that's feedback on the pack design, not on the library trailhead.

### Tradeoffs

**Zod as a peer dependency (for schema consumers).** Consumers who import from `./schemas` need Zod. Consumers who only use the primary API don't. This is the right tradeoff: the primary path has zero schema-library overhead, and the secondary path is explicitly opt-in.

**JSON Schema fidelity.** Not all Zod features map cleanly to JSON Schema. Refinements, transforms, and complex discriminated unions may produce lossy conversions. The Zod schema (via `./schemas`) remains the source of truth. JSON Schema is a convenience projection.

**Resource-to-constructor mapping.** The factory needs to project resource declarations into something the consumer can provide. The right mapping depends on the resource: some are best supplied as concrete instances, others as config that the factory uses to create them internally. The compiler needs to make this idiomatic, and the exact shape will emerge as the implementation matures. The consumer still needs to understand what each resource expects, which is inherent to any library with infrastructure dependencies. Trails makes it explicit rather than hidden.

**Lifecycle responsibility.** When a compiled pack owns disposable resources, the generated runtime instance is more than a function bundle. The consumer takes on the responsibility of calling `dispose()`. The alternative (not owning lifecycle) would push disposal back onto the consumer in a less structured way. Packs without disposable resources don't carry this weight.

**Compiler complexity.** The conceptual model is straightforward. The engineering difficulty lies in flattening a rich pack graph into a standalone package without leaking internal types, runtime assumptions, or framework dependencies. In practice, declaration flattening for clean `.d.ts` output, shared-type resolution so internal types don't trailhead awkwardly, extracting just enough execution runtime for the validate-resolve-compose-run pipeline, and lifecycle behavior in short-lived or serverless environments are likely to be the hardest parts of the compiler. Generated code also has a maintenance cost even when the generation is automated: the output needs to be correct, readable, and debuggable.

### What this does NOT decide

- The specific CLI command or API for triggering compilation (e.g., `trails compile`, a `blaze` variant, or a separate tool)
- Whether the library trailhead ships as a new `@ontrails/library` package or extends an existing package
- How versioning (post-v1.2) interacts with compiled library semver. Schema changes are detectable, so breaking-change detection is feasible, but the mechanism is not specified here
- **Signal subscription semantics.** The current `signal()` primitive defines payload schemas and provenance. Whether the compiled library exposes an `.on()` subscription interface depends on the runtime signal model, which is being designed in a separate ADR. This ADR does not promise signal subscriptions at the library trailhead. Once that ADR lands, this decision should be revisited to determine how (and whether) signals project through the library trailhead as an additive capability
- Whether `depot` (the pack registry concept) plays a role in library discovery or distribution
- How resource mocking works across the library boundary. The mock factory exists on the resource definition, but whether it's re-exported for consumer testing is a separate question
- The exact JSON Schema format (single schema vs. per-trail schemas, OpenAPI vs. plain JSON Schema)
- Whether non-TypeScript compilation targets (Python stubs, Go interfaces) are feasible as future trailheads
- Whether a tiny `@ontrails/runtime` package eventually becomes worthwhile for shared error base classes or signal primitives. The current decision is to inline/generate everything, but this may evolve

## References

- [ADR-0000: Core Premise](../0000-core-premise.md): "define once, trailhead everywhere" and the information architecture categories (authored, projected, overridden)
- [ADR-0001: Naming Conventions](../0001-naming-conventions.md): `create*` factory convention, `derive*` prefix for framework derivations, `build*`/`to*` trailhead wiring pattern
- [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md): `executeTrail` as the single implementation of validate-context-layers-run; the library trailhead delegates to the same pipeline
- [ADR-0008: Deterministic Trailhead Derivation](../0008-deterministic-trailhead-derivation.md): the derivation properties (pure, deterministic, explicit lookup tables, overridable) that the library trailhead must also follow
- [ADR-0009: First-Class Resources](../0009-first-class-resources.md): resource lifecycle, factory/dispose/health/mock, and the execution model the library trailhead must project into consumer-facing runtime inputs
- [ADR-0023: Simplifying the Trails Lexicon](../0023-simplifying-the-trails-lexicon.md): the lexicon renames that apply here (`services` → `resources`, `follow` → `cross`, `events` → `signals`)
- ADR: Typed Signal Emission (draft) -- signal payload schemas and provenance model; the library trailhead's signal projection depends on where that ADR lands
- [ADR: Connector Extraction and the `with-*` Packaging Model](0029-connector-extraction-and-the-with-packaging-model.md) (draft) -- connectors as `@ontrails/with-*` packages; compiled packs may depend on connectors
- [ADR: Resource Bundles](20260409-resource-bundles.md) (draft) -- the bundling mechanism for resources; compiled packs project bundles into constructor parameters
- [ADR: Contours as First-Class Domain Objects](20260409-contours-as-first-class-domain-objects.md) (draft) -- contours as the domain objects pack trails operate on; schema reuse feeds the compiled library's type exports
- [ADR: Layer Evolution](20260409-layer-evolution.md) (draft) -- layers gain input schemas; the compiled library trailhead must project layer inputs alongside trail inputs
- [Lexicon: `pack`](../../lexicon.md): the distributable capability bundle concept, sharpened here as a compilable library boundary
- [Horizons: Packs](../../horizons.md): the mid-term direction for packs as a distributable unit
