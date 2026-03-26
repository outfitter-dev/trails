# Trails Vocabulary and Language Guide

> **Status:** Living document **Last updated:** 2026-03-25

---

## What Trails Is

**Trails is an agent-native, contract-first framework for building software.** Define your logic once as typed trails with Zod schemas. Surface them on CLI, MCP, HTTP, or WebSocket — one line each. The rest is on Trails.

Agent-native means two things. Agents building with Trails produce correct, consistent software by default — the architecture makes drift structurally harder than alignment. Agents consuming Trails apps get queryable contracts, typed schemas, structured errors, and examples — everything they need to plan, execute, and recover without guessing.

**Tagline:** Agent-native, contract-first TypeScript framework. Define once, surface everywhere. The rest is on Trails.

**One-liner (npm/GitHub):** Agent-native, contract-first TypeScript framework. Define once, surface on CLI, MCP, HTTP, and WebSocket. The rest is on Trails.

### Core Operating Principles

**The trail is the product, not the surface.** A trail is a typed function with a Zod schema, error taxonomy, examples, and metadata. CLI commands, MCP tools, and HTTP endpoints are projections of that trail onto surfaces. The trail IS the contract. Surfaces are renderings.

**Drift is structurally harder than alignment.** You can't have different parameter names across surfaces because there's only one schema. You can't have different error handling because there's only one `Result` type. You can't have different validation because Zod runs at the boundary for every surface. Consistency is the default; inconsistency requires effort.

**Surfaces are peers, not primary and secondary.** No surface is privileged. CLI, MCP, HTTP, and WebSocket are all equal adapters reading from the same topo. Adding a surface is a `blaze()` call, not an architecture change.

**The framework defines ports. Everything concrete is an adapter.** CLI framework (Commander, yargs), logging backend (logtape, pino), storage engine (SQLite, MeiliSearch), telemetry exporter (OTel, Datadog) — all pluggable. The framework never imports a concrete implementation.

**Implementations are pure functions.** Input in, `Result` out. No `process.exit()`, no `console.log()`, no `req.headers`. The implementation doesn't know which surface invoked it, which adapter backs the storage, or which exporter records the tracks. Authoring can be sync or async; runtime execution is always awaitable.

**One schema, every surface.** You can't have different parameter names across surfaces because there's only one Zod schema. CLI flags, MCP tool definitions, HTTP query params, and `--help` text are all generated from it. The schema IS the contract.

**Errors are data, not side effects.** `Result<T, Error>` replaces throw/catch. Every implementation returns a Result. Every call site branches on `isOk()` / `isErr()`. No uncaught exceptions, no `process.exit()`, no silent failures. Errors carry structured metadata (category, exit code, HTTP status, retryability) across every surface.

**Validate at the boundary, trust internally.** Zod validates input before the implementation sees it. Every surface, every time. The implementation receives typed, validated data — no defensive checks, no manual parsing. Same principle applies to config: validate at startup, trust internally.

**Examples are tests.** Add `examples` to a trail and you've written both agent documentation and a test suite. `testExamples(app)` runs every example as an assertion. No separate test files for the happy path. Write examples for agent fluency — get test coverage for free.

**Derive the default, override when it's wrong.** CLI command names, MCP tool names, HTTP routes, flag names — all derived from the trail ID and Zod schema. Surface blocks are pure override mechanisms for when the derivation doesn't fit. The most common trail definition has zero surface configuration.

**The contract is readable by machines at runtime.** The topo, survey, and guide make the trail system queryable — by agents, by tooling, by CI. The contract isn't documentation someone wrote separately. It's derived from the trail definitions themselves.

**Agent-native for building AND consuming.** Trails makes agents that build tools produce consistent results by default (structural constraints). Trails makes agents that consume tools effective by default (queryable contracts, typed schemas, error taxonomy, examples).

---

## Naming Principle

**Brand the framework primitives. Use plain language for everything else.**

Trails-branded terms are reserved for concepts unique to the framework — the things that make Trails feel like Trails. Infrastructure concepts that exist in every framework (config, services, health checks, events) keep their standard names. The test: if a developer already knows what the word means from other frameworks, don't rename it.

---

## Locked Terms (shipped in v0.1)

These are final. They appear in the public API, documentation, and code.

### `trail`

**What:** The atomic unit of work. A defined path from typed input to `Result` output.

**API:** `trail(id, spec)` — define a trail.

**Type:** `Trail<I, O>` — the spec type.

**Usage in prose:**

- "Define a trail" — yes
- "Create a trail" — yes
- "The `entity.show` trail" — yes
- "The trail returns a Result" — yes
- "Call the trail" — no, use "follow the trail" for composites, or "invoke" for surfaces

**Usage in code:**

```typescript
export const show = trail('entity.show', {
  input: z.object({ name: z.string() }),
  readOnly: true,
  implementation: (input, ctx) => Result.ok(entity),
});
```

---

### `hike`

**What:** A composite trail that follows other trails. Has its own input/output schema but delegates to other trails via `ctx.follow()`.

**API:** `hike(id, spec)` — define a hike. The spec includes `follows: string[]`.

**Type:** `Hike<I, O>` — the spec type (extends `Trail`).

**Usage in prose:**

- "Define a hike" — yes
- "The `entity.onboard` hike follows `entity.add`, `entity.relate`, and `search`" — yes
- "A hike is a trail that follows other trails" — yes
- "Hikes and trails" — yes, when distinguishing composites from atomics
- "Trails" — yes, when referring to both collectively (a hike IS a trail)

**Usage in code:**

```typescript
export const onboard = hike('entity.onboard', {
  follows: ['entity.add', 'entity.relate', 'search'],
  input: z.object({ name: z.string(), type: z.string() }),
  implementation: async (input, ctx) => {
    const added = await ctx.follow('entity.add', {
      name: input.name,
      type: input.type,
    });
    if (added.isErr()) return added;
    return Result.ok({ entity: added.value });
  },
});
```

---

### `topo`

**What:** Collect trail modules into a topo. Scans module exports for `Trail` shapes and builds the internal collection.

**API:** `topo(name, ...modules)` — create a topo from trail modules.

**Usage in prose:**

- "Create a Trails app" — yes
- "The topo collects trails from modules" — yes
- "Pass your trail modules to `topo()`" — yes

**Usage in code:**

```typescript
import * as entity from './trails/entity';
import * as search from './trails/search';

const app = topo('myapp', entity, search);
```

---

### `blaze`

**What:** Open an app's trails on a surface. The one-liner that wires everything up.

**API:** `blaze(app, options?)` — exported from each surface adapter subpath.

**Usage in prose:**

- "Blaze the app on CLI" — yes
- "Blaze on MCP" — yes
- "Adding a surface is one `blaze()` call" — yes
- "Blazed trails are available to callers" — yes

**Usage in code:**

```typescript
import { blaze } from '@ontrails/cli/commander';
blaze(app);
```

**Do not use** "blaze" as a general verb for "start" or "run." It specifically means "open trails on a surface."

---

### `follow`

**What:** Call another trail from within a hike's implementation. Goes through the topo with full validation and tracing.

**API:** `ctx.follow(id, input)` — returns `Promise<Result<T, Error>>`.

**Usage in prose:**

- "The hike follows `entity.add`" — yes
- "Follow a trail from within a hike" — yes
- "`ctx.follow()` validates input and propagates tracing" — yes

**Usage in code:**

```typescript
const result = await ctx.follow('entity.add', {
  name: 'Alpha',
  type: 'concept',
});
```

---

### `follows`

**What:** The declaration on a `hike()` spec listing which trails the hike follows.

**API:** `follows: string[]` — field on hike spec.

**Usage in prose:**

- "This hike follows three trails" — yes
- "The `follows` declaration is verified by the linter" — yes

---

### `topo` (collection)

**What:** The internal collection of all trails — the topography. The data structure that surfaces read, schema tools inspect, and `ctx.follow()` dispatches through.

**API:** `app.topo` — access the raw collection for power-user scenarios.

**Type:** `Topo` — the collection type.

**Usage in prose:**

- "The topo contains all registered trails" — yes
- "Surface adapters read from the topo" — yes
- "The surface map is generated from the topo" — yes

**Avoid in beginner-facing docs.** Most developers never interact with the topo directly. Use "the app" or "the trail collection" in introductory material. Reserve "topo" for advanced docs, internals, and API reference.

---

### `implementation`

**What:** The pure function inside a trail or hike that does the domain work. Input in, `Result` out. Knows nothing about surfaces.

**API:** `implementation: (input, ctx) => Result | Promise<Result>` — field on trail/hike spec.

**Type:** `Implementation<I, O>` — the function type (almost always inferred).

**Usage in prose:**

- "The implementation receives validated input" — yes
- "Implementations return `Result`, never throw" — yes
- "The implementation doesn't know which surface invoked it" — yes
- "Write the implementation, the framework handles the rest" — yes

**Execution shape:** Authors can return `Result` directly for pure, synchronous work or `Promise<Result>` when the trail awaits I/O or follows other trails. Trails normalizes both forms to one async runtime shape before layers and surfaces execute them.

**Do not abbreviate** to "impl" in prose or public API. The full word is intentional — it reinforces that this function is the contract's implementation, inside the hexagon, not at the edge.

---

## Reserved Terms (designed, not yet shipped)

These are reserved for planned features. They may appear in PRDs and design docs but are not yet in the public API. The naming is directional — it may evolve during implementation.

### `scout` (collapsed)

**Status:** Collapsed into `survey --brief`. The `scout` command and trail no longer exist as separate entities. Quick discovery is now a flag on the `survey` command.

**Previous intent:** Quick discovery and capability detection. What an agent does on first contact — a fast check of what's available without the full survey.

**Current usage:**

```bash
trails survey --brief            # Capabilities summary — surfaces, feature flags, trail count
trails survey --brief --surfaces # What's blazed where
trails survey --brief --permits  # What scopes are required
```

**In prose:** "Run `survey --brief` for a quick capabilities check." "The brief survey tells you what's available without the full detail."

---

### `permit`

**Reserved for:** Auth and principal model. Who is allowed on which trails.

**Intended usage:**

```typescript
export const deleteEntity = trail('entity.delete', {
  destructive: true,
  permit: { scopes: ['entity:write'] },
  implementation: async (input, ctx) => {
    // ctx.permit is the resolved principal — who's calling
    const caller = ctx.permit;
    // ...
  },
});
```

**In prose:** "The `entity.delete` trail requires an `entity:write` permit." "The surface resolves the permit from the auth mechanism."

**Replaces:** `principal` on `ActionContext`, `auth` on `ActionSpec`.

**Note:** `ctx.permit` replaces `ctx.principal`. The permit IS the caller's identity and scopes — what they're allowed to do. "Does this caller have a permit for this trail?" is the auth question Trails answers.

---

### `mount`

**Reserved for:** One app consuming another app's trails. One-directional — the mounting app calls the mounted app's trails; the mounted app doesn't know about the mounter.

**Intended usage:**

```typescript
const app = topo('dispatch', dispatch)
  .mount('patch', patchApp, {
    transport: 'http',
    baseUrl: 'http://localhost:3000',
  })
  .mount('hass', hassApp, { transport: 'local' });

// Dispatch can follow PatchOS trails
await ctx.follow('patch.search', { query: 'priorities' });
// PatchOS doesn't know Dispatch exists
```

**In prose:** "Dispatch mounts PatchOS to access its trails." "Mounted trails are namespaced: `patch.search`, `patch.entity.show`." "A mount can use any transport — local, HTTP, MCP, WebSocket."

**Replaces:** `registry.mount()` from the cross-app PRD.

---

### `junction`

**Reserved for (future):** Bidirectional peer connection between two Trails apps. Both can follow each other's trails, emit events to each other, share permit context. Full typed context in both directions.

**Intended usage (speculative):**

```typescript
// Both apps are aware of each other
const app = topo('dispatch', dispatch).junction('patch', patchApp, {
  transport: 'ws',
  // Bidirectional: Dispatch follows PatchOS trails, PatchOS can emit events to Dispatch
  // Shared permit context — PatchOS sees Dispatch's caller identity
});
```

**In prose:** "A junction is a bidirectional connection — both apps can follow each other's trails." "Mounts are one-way; junctions are peer-to-peer."

**Distinction from `mount`:** Mount is client-server (one app consumes another). Junction is peer-to-peer (both apps share full typed context). Junction is a longer-horizon concept — it requires event subscriptions, permit propagation, and bidirectional transport.

---

### `survey`

**Reserved for:** Full schema introspection. The comprehensive, structured report of everything the app can do.

**Intended usage:**

```bash
trails survey                      # Full topo introspection
trails survey entity.show          # Single trail detail
trails survey --events             # Event definitions
trails survey --config             # Effective configuration
trails survey --graph              # Trail relationships
trails survey --diff main          # Contract changes since main
trails survey --diff v1.0 --impact # With downstream analysis
```

**In prose:** "Survey the app to see the full trail system." "The survey shows every trail, its schema, examples, and relationships."

**Brief vs full:** `survey --brief` provides a quick capabilities check. The full `survey` is comprehensive and structured.

---

### `tracks`

**Reserved for:** Observability, telemetry, audit logs, execution history. The evidence of what happened on the trails.

**Intended usage:**

```typescript
// Package
import { tracksLayer } from '@ontrails/tracks';

// Layer that records execution tracks
blaze(app, { layers: [tracksLayer({ exporter: otelExporter })] });

// In the telemetry system
// Tracks record: trail ID, surface, duration, error category, permit, parent track
```

```bash
# CLI
trails tracks                      # Recent execution history
trails tracks entity.onboard       # Tracks for a specific trail
trails tracks --errors             # Failed executions
```

**In prose:** "The tracks show the agent followed `entity.add` → `entity.relate` → `search`." "Check the tracks to see why the request failed." "Tracks propagate across junctions."

**Replaces:** Telemetry, audit logs, execution traces. `@ontrails/tracks` replaces `@ontrails/telemetry` as the package name.

---

### `traverse`

**Reserved for:** Execution, graph traversal, planner behavior, cross-boundary workflow movement. The runtime verb for moving through the trail system.

**Intended usage:**

```typescript
// Graph traversal API
const path = topo.traverse('search', 'entity.show'); // Find connected path
const plan = topo.traverse.plan('entity.onboard'); // Execution plan for a hike

// In prose about composites
// "The hike traverses entity.add, then entity.relate, then search"

// In prose about cross-app
// "The request traversed a junction into PatchOS"
```

**In prose:** "The planner traverses the topo to find the shortest path." "The composite traverses three trails in sequence." "Traverse the junction to reach PatchOS trails."

**Note:** `traverse` is the planning/execution verb. `follow` is the implementation verb (`ctx.follow()`). You "follow" a specific trail from within code. The system "traverses" the graph at a higher level.

---

### `marker`

**Reserved for:** Annotations, metadata, enrichment. Information attached to trails that describes them beyond their schema.

**Intended usage:**

```typescript
export const show = trail("entity.show", {
  input: z.object({ name: z.string() }),
  readOnly: true,
  markers: {
    owner: "data-team",
    sla: "99.9%",
    piiFields: ["name", "email"],
    deprecated: false,
  },
  relations: [
    { trail: "search", type: "feeds-into", description: "Search results contain entity names" },
  ],
  implementation: async (input, ctx) => { ... },
});
```

**In prose:** "Add markers to describe ownership, SLA, and PII fields." "The `deprecated` marker signals that a trail will be closed." "Markers are visible in the survey output."

**Replaces:** `metadata` field on `ActionSpec`. `markers` is more descriptive — trail markers are annotations that provide context about the trail without changing its behavior.

**Note:** `.describe()` `@see` tags are inline markers on individual fields. The `markers` object is trail-level metadata. `relations` are structural markers that create graph edges. Three levels of annotation, consistent metaphor.

---

### `guide`

**Reserved for:** The runtime guidance layer. Reads the topo (trails, markers, detours, relations, examples) and translates it into usable guidance for agents and humans. Not a docs generator — a knowledge interpreter.

**Intended usage:**

```bash
# CLI: human asks "how do I use this?"
trails guide entity              # Entity trails, inputs, examples, detours
trails guide entity.onboard      # Deep dive: what it follows, what can go wrong

# Agent: structured guidance for context
trails guide --json              # Full guidance as structured data
trails guide --for-agent         # Optimized for LLM consumption
```

**As an MCP tool:**

```text
guide_entity_show → returns guidance for the entity.show trail
```

**In prose:** "Check the guide for entity operations." "The guide translates markers, detours, and examples into actionable guidance." "An agent that's stuck can consult the guide."

**Distinction from other introspection:**

| Command          | What it answers                                          |
| ---------------- | -------------------------------------------------------- |
| `survey --brief` | "What can this app do?" (capabilities)                   |
| `survey`         | "Show me everything about this trail" (raw schema/types) |
| `guide`          | "How do I use this trail?" (guidance, examples, gotchas) |

Survey gives you the data. Guide gives you the understanding.

**Runtime or build time.** The guide works both ways:

- **Runtime:** `trails guide entity.show` in the terminal. An MCP tool returning guidance. An agent querying mid-session.
- **Build time:** `trails guide generate` outputting `llms.txt`, markdown, OpenAPI specs, agent skill frontmatter. Artifacts you commit or deploy.

Same source (the topo). Same interpreter (the guide). Different moments. The developer's effort goes into writing good trail definitions with examples and markers. The guide synthesizes that into guidance — whether served live or generated into files.

**Not the same as `@ontrails/docs`.** Docs assembles documentation from files you wrote (READMEs, guides, hand-authored markdown). Guide generates guidance from what you *defined* (trails, markers, detours, examples, relations). You never write guide content directly — you write good trail definitions and the guide derives everything from them.

---

### `pack`

**Reserved for:** Capability bundles. A distributable unit that carries trails, services, events, markers, and config fragments for a domain. The unit of sharing and reuse.

**Intended usage:**

```typescript
// A pack bundles everything for a domain
import { entityPack } from '@mylib/entity-pack';
import { searchPack } from '@mylib/search-pack';

const app = topo('myapp', entityPack, searchPack);
// entityPack brings:
//   - trails: entity.show, entity.add, entity.delete
//   - services: entity database adapter
//   - events: entity.updated, entity.deleted
//   - markers: PII fields, ownership
//   - config fragment: entity storage settings
```

**In prose:** "Install the entity pack to get CRUD trails, events, and the service definition." "Packs are the unit of distribution — publish one, install one, get everything for a domain." "A pack is more than a module of trails — it carries the full capability."

**Distinction from modules:** A module is a file that exports trail definitions. A pack is a distributable bundle that carries trails, services, events, markers, and config — everything needed for a domain to work. Modules are code organization. Packs are capability distribution.

---

## Standard Terms (not branded)

These use plain language because the concepts are universal. Don't rename them.

| Term | Concept | Why it's not branded |
| --- | --- | --- |
| `config` | Configuration | Every framework has config. `defineConfig()` stays. |
| `services` | Service definitions | Universal infrastructure concept. `defineService()` stays. |
| `health` | Health checks | Standard ops terminology. |
| `event()` | Server-originated events | Universal pub/sub concept. |
| `Result` | Success/failure return | Standard in Rust, Haskell, Swift, etc. |
| `Layer` | Cross-cutting surface wrapper | Standard middleware concept (renamed from middleware, but not branded). |
| `Surface` | Transport type | Could be branded but it's already clear and distinctive enough. |
| `Implementation` | The pure function | Descriptive, self-explanatory. Full word, not abbreviated. |
| `Error` | Error types | Universal. |

---

## Writing Style for Trails

### In documentation

- **Lead with code.** Show the `trail()` → `topo()` → `blaze()` flow before explaining it.
- **Use branded terms naturally.** "Define a trail" not "define an action." "Blaze on CLI" not "serve via CLI." "The hike follows three trails" not "the composite calls three actions."
- **Don't overdo the metaphor.** "Trails is a contract-first framework" is fine. "Trails blazes a path through the wilderness of transport-agnostic design" is not.
- **Standard terms stay standard.** "Configure the app" not "set up camp." "Define a service" not "pack your gear."
- **The framework is "Trails" (capitalized). The primitive is "trail" (lowercase).**

### In code comments

```typescript
// Good: uses branded terms naturally
// Follow entity.add to create the entity, then relate it
const entity = await ctx.follow('entity.add', input);

// Bad: forces the metaphor
// Blaze a new path through the entity creation wilderness
const entity = await ctx.follow('entity.add', input);

// Good: standard terms for standard concepts
// Validate config before starting services
const config = resolveConfig(schema, sources);

// Bad: branded terms for standard concepts
// Scout the basecamp provisions before gearing up
const config = resolveConfig(schema, sources);
```

### In error messages

```text
// Good: clear and direct
Trail "entity.show" not found in topo
Hike "entity.onboard" follows "entity.relate" which does not exist
Permit denied: missing scope "entity:write" for trail "entity.delete"

// Bad: too themed
The hiker could not find the trail "entity.show" on the mountain
```

### In marketing/README

The branded terms earn their keep here. This is where the vocabulary creates identity:

> **Define trails. Blaze on any surface.**
>
> Trails is a contract-first framework for TypeScript. Define your logic once with `trail()`. Blaze it on CLI, MCP, HTTP, or WebSocket with one line per surface.

### In conversation

When talking about Trails, use the branded terms for framework concepts:

- "I defined a trail for entity creation" — natural
- "The hike follows three trails" — natural
- "We blazed it on MCP and CLI" — natural
- "`survey --brief` shows what's available" — natural

Don't use them for general programming:

- "I blazed the database connection" — no
- "Follow the config file" — no
- "The junction between the API and the frontend" — no (junction is specifically cross-app trail composition)

---

## Term Hierarchy

When introducing Trails to someone new, introduce terms in this order:

**Beginner (all you need to ship):**

1. **`trail()`** — "a trail is a typed function with a schema"
2. **`Result`** — "trails return Result, not exceptions"
3. **`topo()`** — "collect your trails into a topo"
4. **`blaze()`** — "open the app on CLI, MCP, or HTTP"

**Intermediate (composition and enrichment):** 5. **`hike()`** — "a hike follows multiple trails" 6. **`ctx.follow()`** — "call another trail from within a hike" 7. **`event()`** — "define events the app can emit" 8. **`markers`** — "annotate trails with metadata" 9. **`detours`** — "define fallback paths when a trail fails" 10. **`pack`** — "a distributable capability bundle"

**Advanced (introspection and observability):** 11. **`topo`** — "the internal trail collection" 12. **`survey`** — "full introspection of the trail system" 13. **`survey --brief`** — "quick discovery and capability detection (was `scout`)" 14. **`guide`** — "runtime guidance — how to use these trails" 15. **`tracks`** — "observability, telemetry, execution history" 16. **`leg`** — "one segment of a hike's execution" 17. **`traverse`** — "graph traversal and execution planning" 18. **`loadout`** — "deployment/environment config profile"

**Ecosystem (multi-app and governance):** 19. **`permit`** — "auth and scopes" 20. **`mount`** — "consume another app's trails" 21. **`junction`** — "bidirectional peer connection (future)" 22. **`warden`** — "governance and contract enforcement" 23. **`depot`** — "pack registry and marketplace"

## Complete Vocabulary Reference

### Locked (final, shipped in v0.1)

| Term | Concept | API |
| --- | --- | --- |
| `trail` | Atomic action definition | `trail(id, spec)` |
| `hike` | Composite following multiple trails | `hike(id, spec)` with `follows: [...]` |
| `event` | Server-originated push | `event(id, spec)` |
| `topo` | Collect trails into a topo | `topo(name, ...modules)` |
| `blaze` | Open app on a surface | `blaze(app, options?)` |
| `follow` | Call another trail from within | `ctx.follow(id, input)` |
| `follows` | What a hike traverses | `follows: string[]` on hike spec |
| `topo` | The trail collection | `app.topo` |
| `implementation` | The pure function | Field on trail/hike spec |

### Reserved (designed, not yet shipped)

| Term | Concept | Planned API |
| --- | --- | --- |
| `survey` | Full schema introspection | `trails survey`, `trails survey --diff` |
| `scout` | Collapsed into `survey --brief` | Was `trails scout`, now `trails survey --brief` |
| `tracks` | Observability / telemetry / audit | `@ontrails/tracks`, `tracksLayer()` |
| `traverse` | Graph traversal / execution planning | `topo.traverse()`, planner API |
| `marker` | Annotations / metadata / enrichment | `markers: {}` on trail spec |
| `permit` | Auth / principal model | `ctx.permit`, `permit: { scopes }` on spec |
| `mount` | One-directional cross-app connection | `app.mount(name, remoteApp, transport)` |
| `junction` | Bidirectional peer connection (future) | `app.junction(name, peerApp, transport)` |
| `guide` | Runtime guidance layer | `trails guide`, MCP tool, agent context |
| `detour` | Error recovery / fallback paths | `detours: { NotFoundError: ["search"] }` |
| `pack` | Capability bundle (trails + services + events + markers) | `topo("myapp", entityPack, searchPack)` |
| `loadout` | Deployment/environment config profile | `topo("myapp", entity).loadout(production)` |
| `leg` | One segment of a hike's execution | Span hierarchy in tracks |
| `warden` | Governance / contract enforcement tooling | `trails warden`, `@ontrails/warden` |
| `depot` | Pack registry / marketplace | Where packs are published and discovered |
| `spur` | Side effect branching (future) | Event emission as a spur off a trail |
| `itinerary` | Execution plan from traverse (future) | What traverse.plan() returns |

### Standard (not branded)

| Term | Concept | Why not branded |
| --- | --- | --- |
| `config` | Configuration | Universal — every framework has it |
| `services` | Service definitions | Universal infrastructure concept |
| `health` | Health checks | Standard ops terminology |
| `Result` | Success/failure return | Standard in Rust, Haskell, Swift |
| `Layer` | Cross-cutting surface wrapper | Standard concept (renamed from middleware) |
| `Surface` | Transport type | Already clear and distinctive |
| `Implementation` | The pure function | Descriptive, self-explanatory |
| `Error` | Error types | Universal |
| `dry-run` | Execute without side effects | Universal CLI convention — don't rename to `--recon` |
| `dispatch` | Programmatic full-pipeline invocation | Standard term. `app.dispatch(id, input, opts)` — runs layers, validation, permit checks, tracks. Three levels: direct call (unit test), `follow` (through topo, no layers), `dispatch` (full pipeline). |

The first four are all a beginner needs. You can build and ship a working CLI + MCP tool with just `trail`, `Result`, `topo`, `blaze`. Everything else is progressive — you learn it when you need it.
