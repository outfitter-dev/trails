# Trails — Horizon

> **Status:** Design direction — not committed, not scheduled
> **Purpose:** Capture concepts that are coming but aren't v1. Inform architecture decisions now so these aren't blocked later.

---

## Included in v1

These could change the core `trail()` spec or `TrailContext` shape. Rather than designing now and building later, we build them into v1 so the spec is complete from day one — no "this doesn't handle async yet" or "file uploads aren't supported" caveats.

### Background Jobs / Async Trails

The first pattern that doesn't fit synchronous `Result<T, Error>`. A job trail returns immediately with a handle. The handle has status, progress, eventual result, and cancellation.

**How each surface handles it:**
- CLI: polls and shows a progress bar
- HTTP: returns 202 with `Location` header for polling
- WebSocket: subscribes to progress events via the event system
- MCP: uses notifications for progress updates

**The question for v1:** Does `trail()` need a `kind` field (`"query" | "mutation" | "job"`)? Or can jobs be expressed as a normal trail that returns `Result<JobHandle, Error>` where `JobHandle` has `statusFields()` + `progressFields()` in its output schema?

If the latter works, then:
- `trail()` spec doesn't change
- Surface adapters detect the job pattern from the output shape (has `status`, `progress`, `cursor` for polling)
- Layers handle the surface-specific behavior (CLI progress bar layer, HTTP 202 layer)
- The event system delivers progress updates

If it doesn't work — if we need `kind: "job"` to change the return type contract — that's a v1-breaking decision. **Verify with a proof-of-concept before v1 ships.**

**Trails vocabulary:** Not yet named. Could be a variant of `trail()` or a new primitive. `task()` is too generic. `expedition()` is too dramatic. Most likely it's just `trail()` with the right output pattern — which means no new primitive needed, just patterns that surface adapters recognize.

**v1: ship the job pattern.** Prove that `statusFields()` + `progressFields()` in the output schema is sufficient. Build the surface adapter behavior (CLI progress polling, HTTP 202) as layers. If the proof-of-concept reveals a need for `kind: "job"`, add it to the spec before v1 ships.

---

### Binary / File / Blob Flows

File uploads, artifact downloads, binary payloads. Doesn't fit the JSON body model.

**The question for v1:** Does `@ontrails/http` need to handle `multipart/form-data` from day one? Or can file operations live outside the trail contract initially (standard Hono/Express file handling alongside Trails routes)?

**Design direction:** A `BlobRef` type that surfaces handle differently:
- HTTP: `multipart/form-data` upload, `Content-Disposition` download
- CLI: file path argument
- MCP: base64 content or URI reference
- WebSocket: chunked binary frames

The `BlobRef` would be a Zod type that trail input/output schemas can use:

```typescript
import { BlobRef } from "@ontrails/core";

const upload = trail("file.upload", {
  input: z.object({
    file: BlobRef,  // Surface adapter handles the actual transport
    name: z.string(),
  }),
  implementation: async (input, ctx) => {
    // input.file is a resolved blob — stream, buffer, or path depending on surface
    await ctx.services.storage.save(input.name, input.file);
    return Result.ok({ saved: true });
  },
});
```

**v1: ship `BlobRef` in core.** The type is small (~50-100 lines). Per-surface handling ships with each surface adapter. Having it from day one means trail input schemas can accept files without workarounds.

---

## Ships with HTTP (v1.2)

### Webhooks (`@ontrails/webhooks`)

The simplest event delivery surface: POST typed event payloads to registered URLs when state changes. No connection lifecycle, no replay buffer. Subscription persistence, retry policies, payload signing.

Webhooks are the most common integration pattern in SaaS — most tools use webhooks, not WebSocket. They share event definitions with SSE and WebSocket — same `event()` contracts, different delivery.

```typescript
import { createWebhookDispatcher } from "@ontrails/webhooks";

const webhooks = createWebhookDispatcher({
  events: ["entity.updated", "entity.deleted"],
  store: webhookStore,       // Subscription persistence
  signing: { secret: env.WEBHOOK_SECRET },
  retry: { maxAttempts: 3, backoff: "exponential" },
});
```

**Why it ships with HTTP:** Webhooks ARE HTTP — they POST to URLs. The webhook dispatcher uses the same HTTP primitives, error taxonomy, and event contracts. They're a natural companion to `@ontrails/http`.

---

### Auth / Permit Model (Needs PRD)

The `permit` vocabulary is reserved, `authLayer` is designed in the layers PRD, and `ctx.permit` is on `TrailContext`. But the actual auth design is scattered and incomplete.

**What needs design:**

```typescript
// What IS a Permit?
interface Permit {
  id: string;                    // Caller identity
  scopes: string[];              // What they're allowed to do
  roles?: string[];              // Role membership
  tenantId?: string;             // Multi-tenant isolation
  metadata?: Record<string, unknown>;  // Custom claims
}

// How do scopes compose?
trail("entity.delete", {
  destructive: true,
  permit: {
    scopes: ["entity:write"],           // Required scopes
    // Or derived: destructive trail in entity domain → entity:write
  },
});

// How does RBAC work?
const roles = defineRoles({
  viewer: ["entity:read", "search:read"],
  editor: ["entity:read", "entity:write", "search:read"],
  admin: ["*"],  // All scopes
});
```

**What each surface does with permits:**

| Surface | Auth Resolution | Scope Enforcement |
|---------|----------------|-------------------|
| CLI | Local keyring, env var, or no auth | Optional — CLI is often admin |
| MCP | Session token from MCP config or OAuth | Filter tool list — agents don't see trails they can't call |
| HTTP | Bearer token from `Authorization` header | 401 (no token) or 403 (insufficient scopes) |
| WebSocket | Token from connection handshake | Filter available trails per connection |

**What propagates across `ctx.follow()` and `mount()`:**
- Within a route: the parent's permit propagates to inner trail calls
- Across a mount: the mounting app's permit is forwarded as a header/metadata. The mounted app may have its own auth that validates it.

**Resource-level auth:** "Can edit their own entities but not others" is implementation logic, not framework enforcement. The permit provides identity (`ctx.permit.id`); the implementation checks ownership. The framework provides the port; the app provides the policy.

**This needs a dedicated PRD.** The `Permit` type ships in v1 core (it's on `TrailContext`), but the full scope system, RBAC port, scope derivation, and surface-specific enforcement need design before v1.2.

---

## Build When Ready

These are well-understood, don't change the core spec, and ship when their prerequisites land.

### MCP Apps Surface

Schema-driven interactive UIs rendered in chat clients (Claude, ChatGPT, VS Code) via the MCP Apps protocol (SEP-1865).

**What the topo provides:**
- Input schema → auto-generate form fields (string → text input, enum → dropdown, boolean → toggle)
- Output schema → auto-generate result visualization (array → table, object → detail view)
- Trail markers → UI behavior (`destructive` → red button with confirmation, `readOnly` → query-only display)
- Examples → pre-fill form values
- Detours → actionable error recovery buttons ("Try searching instead")

**Why it matters:** This is the most visually impressive demo of the framework. "Your trail definitions render as interactive forms in Claude." It proves that the contract IS the product — the UI is derived, not hand-built.

**Prerequisites:** MCP Apps protocol stability, `@ontrails/mcp` shipped, output schemas on trails.

**Timeline:** v1.2-v1.3, dependent on MCP Apps protocol.

---

### SDK Generation (via Guide)

Typed TypeScript client generated from the topo. Each trail becomes a method with typed input/output, working over HTTP or WebSocket.

```typescript
// Generated by: trails guide generate --typescript
import { createClient } from "./guide/client";

const client = createClient({ baseUrl: "https://api.example.com" });
const results = await client.search({ query: "auth", limit: 10 });
//    ^? SearchResult[] — typed from the trail's output schema
```

**Prerequisites:** `@ontrails/http` shipped, output schemas on trails, the guide system designed.

**Timeline:** v1.2, alongside or shortly after HTTP.

---

### OpenAPI Generation

`trails survey --openapi` generates a complete OpenAPI 3.1 spec from the topo. Read-only trails become GET operations, mutations become POST. Nearly free once HTTP surfaces exist — the topo already has everything OpenAPI needs.

**Prerequisites:** `@ontrails/http` shipped, output schemas on trails.

**Timeline:** v1.2, ships with HTTP or immediately after.

---

### Packs

Distributable capability bundles. A pack carries trails, services, events, markers, and config fragments for a domain. The unit of sharing and reuse.

```typescript
import { entityPack } from "@mylib/entity-pack";
const app = trailhead("myapp", entityPack, searchTrails);
```

**Prerequisites:** The core loop (trail → trailhead → blaze) proven in real apps. Services and events shipped.

**Timeline:** v1.3+, after services and events.

---

### Mount (Cross-App Composition)

One app consumes another app's trails. One-directional, transport-agnostic.

```typescript
const app = trailhead("dispatch", dispatchTrails)
  .mount("patch", patchApp, { transport: "http", baseUrl: "http://localhost:3000" });

// Dispatch follows PatchOS trails
await ctx.follow("patch.search", { query: "priorities" });
```

**Prerequisites:** `ctx.follow()` runtime dispatch, HTTP surface, the guide for typed cross-app contracts.

**Timeline:** v2+, after the core is proven across multiple real apps.

---

### GraphQL Surface

Zod schemas contain enough type info to generate a GraphQL schema. Read-only trails become queries, mutations become mutations.

**Why it could be community-built:** Trails defines the port (the topo). A `@ontrails/graphql` adapter reads the topo and generates the schema. The framework doesn't need to own this — the adapter pattern makes it possible for anyone to build.

**Timeline:** v2+ or community contribution.

---

### WebSocket Surface Details (not yet in a PRD)

The production prototype proved:
- Request/response framing (JSON-RPC style: `{ type: "request", requestId, method, params }`)
- Connection state machine: `connecting → authenticating → ready → draining` with validated transitions
- Backpressure management: per-connection send queue depth monitoring
- Event replay: circular buffer with sequence numbers, `lastSeenSeq` on reconnect

These implementation details belong in a `@ontrails/ws` PRD when WebSocket ships. The patterns are proven — they just need to be documented in Trails vocabulary.

---

### SDK Adapter for Consuming External SDKs

Different from guide (which generates SDKs FROM the topo). This is wrapping an existing SDK AS trails — e.g., wrapping Stripe's SDK so its operations become trails in your app.

```typescript
// Wrap an existing SDK's methods as trails
const stripeTrails = adaptSdk(stripe, {
  "charges.create": { id: "stripe.charge", destructive: false },
  "charges.retrieve": { id: "stripe.charge.show", readOnly: true },
});
```

Not v1. Useful when Trails apps integrate with third-party services.

---

### Guide: `--allowed-tools` / Skill Frontmatter Generation

The guide should generate Claude Code skill frontmatter and `allowed-tools` patterns from the topo:

```bash
# What tools should a read-only entity agent have?
trails guide --allowed-tools --read-only
Bash(myapp entity show *), mcp__myapp__entity_show

# Generate skill frontmatter
trails guide --skill-frontmatter --domain entity --read-only
---
allowed-tools: Bash(myapp entity show *), mcp__myapp__entity_show
---
```

This is a guide feature. Track for when guide ships.

---

## Defer Genuinely

### Multi-Tenancy

The `permit` model gives caller identity. Multi-tenant apps need tenant isolation — data scoping, config per tenant, rate limits per tenant. Mostly an implementation concern (`ctx.permit.tenantId` scopes queries). May eventually need framework-level support for tenant-scoped permits and per-tenant service instances.

**Not v1. Not v2. Build when there's a concrete multi-tenant app pulling it forward.**

---

### Web UI Surface

Full web UI generated from the topo — admin panels, dashboards, interactive tools. React with TanStack Start, Next.js, or standalone. Component library extracted from MCP Apps patterns. shadcn-compatible.

**Not before MCP Apps proves the component patterns.** The iframe sandbox constraint teaches which components work. Extract and generalize after that.

---

### Internal IR / Standard Schema

Whether Trails should eventually support validators beyond Zod through Standard Schema (the pattern ts-rest and Hono use). Would require a normalized internal representation that's validator-agnostic.

**Not until Zod hits a real limitation.** Zod is the right choice today — mature, ecosystem support, good TypeScript inference. The escape hatch exists if needed later.

---

### Batch Operations

Running N different trails in one request. Different from bulk (one trail on N items — already covered by `bulkOutput()` in patterns). Batch is "call search, then entity.add, then entity.relate in one round-trip."

**Design direction:** The surface adapter handles batching — the trail contract doesn't need to know. HTTP could accept a JSON-RPC batch array. MCP already has tool batching. CLI doesn't need it (each command is a separate invocation).

The interesting question is whether `ctx.follow()` within a route should support parallel dispatch:

```typescript
// Sequential (v1)
const a = await ctx.follow("search", searchInput);
const b = await ctx.follow("entity.add", addInput);

// Parallel (batch)
const [a, b] = await ctx.followAll([
  ["search", searchInput],
  ["entity.add", addInput],
]);
```

`followAll` dispatches in parallel and returns all results. Useful for routes that follow independent trails.

**Prerequisites:** `ctx.follow()` shipped, route system proven.

**Timeline:** v1.3, alongside routes and composition.

---

## Selective Service Dependencies

Not every trail needs every service. Only 3 of 30 trails need a database transaction.

**Already designed:** `transactionLayer({ filter: (trail) => !trail.readOnly })` from the layers PRD. The layer wraps only the trails that need it. No additional design needed.
