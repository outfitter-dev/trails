# Horizons

> Directions, not commitments. These capabilities follow naturally from the Trails architecture but are not part of v1.

## Shipped

**HTTP surface (`@ontrails/http`).** The third surface adapter. `intent: 'read'` maps to GET, mutations to POST, `'destroy'` to DELETE. Route paths derived from trail IDs. Error taxonomy maps to HTTP status codes. One `blaze()` call, same pattern as CLI and MCP. Built on Hono.

**OpenAPI generation (`@ontrails/schema`).** `generateOpenApiSpec()` produces a complete OpenAPI 3.1 spec from the topo. The topo already carries everything OpenAPI needs.

**Services (`service()` and trail `services: [...]`).** Trails now declare infrastructure dependencies explicitly. `executeTrail()` resolves app-scoped singletons before layers and implementations run. Testing can auto-resolve `mock` factories, and survey / schema tooling exposes the full service graph.

## Near-term (v1.1–v1.2)

**Auth and permit model.** The `permit` field on TrailContext gets a full design: scopes, roles, per-surface resolution (bearer tokens for HTTP, session tokens for MCP, local keyring for CLI). Scope enforcement as a layer. Resource-level auth stays in the implementation — the framework provides identity, the app provides policy.

## Mid-term (v1.3+)

**Derived dependency graphs.** Instead of hand-maintaining `follow` declarations, the framework infers them from `ctx.follow()` calls in the implementation via static analysis. The same idea could eventually extend beyond today's declared `services: [...]` model to richer service capability inference. The surface lock captures the graph. Changes show up in diffs.

**Implementation synthesis from examples.** For trails with comprehensive examples that fully specify behavior (pure transformations, mapping logic, validation rules), an agent could synthesize the implementation from the examples alone. The examples become the source of truth; the code becomes the derived artifact.

**Cross-app composition (mount).** One Trails app consumes another's trails over a transport boundary. Contract compatibility verified at startup — input schemas match, expected errors exist, required trails are present. Version compatibility becomes structural, not documentary.

**Packs.** Distributable capability bundles. A pack carries trails, services, events, and config for a domain. The unit of sharing and reuse across apps.

## Long-term (v2+)

**Progressive contract tightening.** A new trail starts loose — minimal schema, no examples. As it matures, the contract tightens: output schema added, examples written, error types specified. The framework tracks progression and suggests next steps.

**Behavioral types from runtime observation.** The tracks (telemetry) system records what actually happens. Over time, runtime data validates or challenges authored declarations. A trail declared `intent: 'read'` that triggers database writes has a contract violation. The framework surfaces the discrepancy.

**SDK generation via guide.** Typed TypeScript clients generated from the topo. Each trail becomes a method with typed input/output. Working over HTTP or WebSocket.

**Derived documentation sites.** A live site that reads the topo and renders it. Examples become interactive widgets. Error taxonomy becomes a searchable reference. The `follow` graph becomes a visual diagram. Always accurate because it reads the same data the framework uses at runtime.

**Cross-app contract negotiation (junction).** Two Trails apps negotiate compatibility at connection time. "I need `entity.show` with at least `{ name: string }` input." The mounted app confirms or rejects.

---

Each horizon follows the same principle: **author what's new, derive what's known, override what's wrong.** If the information exists in the system, don't ask the developer to restate it.

See [Architecture](./architecture.md) for how the current v1 implements this principle across projections, enforcement, inference, and overrides.
