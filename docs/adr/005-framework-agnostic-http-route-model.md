---
status: accepted
created: 2026-03-29
updated: 2026-03-29
author: '@galligan'
---

# ADR-005: Framework-Agnostic HTTP Route Model

## Context

Trails needs an HTTP surface. It does not need to become a web framework.

Hono, Express, Fastify, Koa — mature, well-tested HTTP frameworks already exist. They handle routing, middleware, request parsing, and response serialization. Reimplementing any of that inside Trails would be wasted effort and a worse result than what's already available.

But Trails can't couple to any single one of them either. Coupling to Hono means every Trails user becomes a Hono user. Coupling to Express means dragging in a framework whose design predates async/await. Any hard dependency on a specific HTTP framework creates lock-in that limits adoption and constrains how people integrate Trails into their existing stacks.

The HTTP surface also needs to work in three distinct integration patterns:

1. **Standalone.** Trails is the server. You call `blaze()` and it starts listening. No existing app, no existing framework.
2. **Embedded.** Trails mounts into an existing Hono, Express, or Fastify app. The app owns the server lifecycle; Trails provides a subset of the routes.
3. **Full-stack catch-all.** A Next.js, Astro, or SvelteKit app routes `/api/[...slug]` to Trails. The full-stack framework owns the server; Trails handles the API layer behind a single catch-all route.

One route model needs to serve all three patterns. If the route model is framework-specific, the third pattern breaks — you can't easily wire Hono routes into a SvelteKit handler.

This isn't a new problem in the Trails architecture. The same pattern already works on the other surfaces:

- CLI: `buildCliCommands(topo)` produces framework-agnostic command definitions. `toCommander()` wires them to Commander.js.
- MCP: `buildMcpTools(topo)` produces framework-agnostic tool definitions. `connectStdio()` wires them to the MCP SDK transport.

HTTP is the third surface following the same two-step pattern.

## Decision

### `buildHttpRoutes(topo)` produces `HttpRouteDefinition[]`

The core function takes a topo and returns an array of framework-agnostic route descriptions. Each `HttpRouteDefinition` contains:

- **`method`** — `GET`, `POST`, or `DELETE`, derived from the trail's intent
- **`path`** — derived from the trail ID (dots become slashes: `entity.show` becomes `/entity/show`), prepended with a configurable `basePath`
- **`inputSource`** — `query` for reads, `body` for writes, derived from the method
- **`trailId`** — the trail's ID, for debugging and logging
- **`trail`** — the full trail definition, for metadata access
- **`execute(input, requestId?, signal?)`** — validates input, composes layers, runs the implementation, returns `Result`

The `execute` function is the important part. It does everything *except* touch HTTP framework types. It doesn't parse a `Request`. It doesn't construct a `Response`. It doesn't set status codes. It takes validated input, runs the trail, and returns a `Result`. Everything HTTP-specific happens in the adapter.

### Hono is the first adapter at `@ontrails/http/hono`

The Hono adapter lives in a subpath export, not in the main package entry. Two functions:

- **`toHono(routes, options?)`** — takes `HttpRouteDefinition[]` and returns a Hono app with routes registered. The developer owns the app lifecycle.
- **`blaze(topo, options?)`** — collapses the pipeline into one call for the standalone case. Calls `buildHttpRoutes`, then `toHono`, then starts listening.

The adapter handles:

- Parsing query parameters and request bodies from Hono's `Context`
- Mapping `Result.ok()` to `200` responses with the Trails response envelope
- Mapping `Result.err()` to the appropriate HTTP status code via the error taxonomy (`NotFoundError` → 404, `ValidationError` → 400, etc.)
- Setting `Content-Type`, `X-Request-Id`, and other standard headers

The route model handles none of this. It doesn't know what a `200` is.

### Hono is a peer dependency

`hono` is declared as a `peerDependency` on `@ontrails/http`, not a direct dependency. If you only use `buildHttpRoutes()` and write your own adapter, Hono is never imported and tree-shaking removes it entirely.

Adding a new framework adapter means adding a new subpath export (`@ontrails/http/express`, `@ontrails/http/fastify`) with the same peer dependency pattern. Each adapter is thin — mapping route definitions to framework handlers is roughly 100–150 lines of straightforward code.

### Path derivation follows the dot-to-slash convention

Trail IDs use dots as separators (`entity.show`, `billing.invoice.create`). HTTP paths use slashes. The mapping is mechanical:

```text
entity.show           → /entity/show
billing.invoice.create → /billing/invoice/create
```

The `basePath` option prepends a prefix:

```text
basePath: '/api/v1'
entity.show           → /api/v1/entity/show
```

Trails with an explicit `http.path` override in metadata can use custom paths when the derivation doesn't fit — REST-style resource paths like `/users/:id` need per-trail configuration. The default handles the common case; the override handles the rest.

### Method derivation from intent

The trail's `intent` property drives method selection:

- `read` → `GET`
- `write` → `POST`
- `destroy` → `DELETE`

This keeps the trail author out of HTTP vocabulary. They declare what the trail *does*; the framework decides what method that maps to.

## Consequences

### Positive

- **No framework lock-in.** Users choose their HTTP framework. Trails provides the route model; adapters bridge to specific runtimes.
- **Three integration patterns from one model.** Standalone, embedded, and catch-all all work because `HttpRouteDefinition[]` is just data. Wire it however you want.
- **Thin adapters.** Each framework adapter is roughly 100–150 lines. The route model does the heavy lifting; the adapter does the wiring.
- **Consistent surface pattern.** HTTP follows the same `build*` → `to*`/`connect*` → `blaze()` pattern as CLI and MCP. One mental model for all surfaces.
- **Testable without HTTP.** `execute()` on a route definition takes plain input and returns `Result`. You can test every trail's HTTP behavior without starting a server or making HTTP requests.

### Tradeoffs

- **Adapter maintenance.** Each supported framework needs its own adapter subpath. The adapters are small, but they still need to track framework API changes.
- **REST-style paths require overrides.** The dot-to-slash derivation produces action-oriented paths (`/entity/show`), not resource-oriented paths (`/entities/:id`). REST-style APIs need per-trail path overrides.
- **Method vocabulary is limited.** Only `GET`, `POST`, and `DELETE` are derived from intent. `PUT`, `PATCH`, and other methods require explicit configuration if needed.

### What this does NOT decide

- **Which additional framework adapters ship.** Hono is first. Express, Fastify, and others are future work driven by demand.
- **Streaming and SSE support.** The current route model returns a single `Result`. Streaming responses need a different execution model — that's a separate decision.
- **OpenAPI generation.** The route model contains enough information to produce OpenAPI specs, but the generation logic is not part of this decision.

## References

- [ADR-000: Core Premise](000-core-premise.md) — the foundational decisions that require surface-agnosticism
- [ADR-006: Shared Execution Pipeline](006-shared-execution-pipeline.md) — the `executeTrail` function that `HttpRouteDefinition.execute` delegates to
- [ADR-008: Deterministic Surface Derivation](008-deterministic-surface-derivation.md) — the derivation rules that produce paths, methods, and input sources from trail contracts
