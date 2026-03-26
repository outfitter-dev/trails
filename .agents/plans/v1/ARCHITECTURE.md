# Trails — Architecture

## Core Principles

**The trail is the product, not the surface.** CLI commands, MCP tools, and HTTP endpoints are projections of trails onto surfaces. The trail IS the contract.

**Drift is structurally harder than alignment.** One schema, one Result type, one error taxonomy. Consistency is the default.

**Surfaces are peers.** No surface is privileged. CLI, MCP, HTTP, WebSocket — all equal adapters reading from the same topo.

**The framework defines ports. Everything concrete is an adapter.** CLI framework, logging backend, storage engine, telemetry exporter — all pluggable. The framework never imports a concrete implementation.

**Implementations are pure functions.** Input in, `Result` out. No side effects, no surface knowledge, no transport coupling. Authoring may be sync or async; core normalizes execution to one awaitable shape before adapters run.

**The contract is machine-readable at runtime.** Survey and guide make the topo queryable by agents, tooling, and CI.

**Examples are tests.** Add `examples` to a trail and you've written both agent documentation and a test suite. `testExamples(app)` runs every example as an assertion — input validation, implementation execution, output verification. No separate test file for the happy path. Write examples for agents, get tests for free.

**Core is runtime-agnostic. Ecosystem is Bun-first.** `@ontrails/core` is pure TypeScript + Zod — no runtime-specific APIs. It works on Node, Deno, Bun, and edge runtimes. Ecosystem packages (`@ontrails/index-sqlite`, the Trails CLI app) can use Bun-specific APIs where they provide clear advantages. The framework never forces a runtime on consumers.

---

## Hexagonal Architecture

Trails is hexagonal on both sides:

```text
                    LEFT SIDE (inbound)
                    How the world calls in
                    ┌─────────────────────┐
                    │  CLI (commander)     │
                    │  MCP (sdk)           │
                    │  HTTP (framework)    │
                    │  WebSocket           │
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
                    │                     │
                    │   @ontrails/core    │
                    │                     │
                    │  trail() → Trail    │
                    │  hike() → Hike     │
                    │  event() → Event    │
                    │  topo() → Topo     │
                    │  Result, Errors     │
                    │  Layer, Topo        │
                    │                     │
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
                    │  Logging (logtape)  │
                    │  Storage (sqlite)   │
                    │  Telemetry (otel)   │
                    │  Search (meili)     │
                    └─────────────────────┘
                    RIGHT SIDE (outbound)
                    How the framework calls out
```

Core defines **ports** (interfaces). Everything on the edges is an **adapter**.

---

## Package Layers

### Core (`@ontrails/core`)

The foundation. One external dependency: `zod`.

Contains: Result (built-in), error taxonomy, `trail()`/`hike()`/`event()`, `topo()`, TrailContext, validation, patterns, redaction, branded types, type guards, collection utilities, Layer interface, adapter port interfaces, resilience utilities, serialization.

**The test:** If you're building a surface adapter or ecosystem package, you should only need `@ontrails/core`.

### Surface Adapters (left side)

| Package | Exports | External dep |
| --- | --- | --- |
| `@ontrails/cli` | `buildCliCommands()` → `CliCommand[]` model, `output()`, flag derivation | None beyond core |
| `@ontrails/cli/commander` | `toCommander()`, `blaze()` | `commander` (optional peer) |
| `@ontrails/mcp` | `buildMcpTools()`, `blaze()` | `@modelcontextprotocol/sdk` |
| `@ontrails/http` (planned) | `buildHttpRoutes()`, `blaze()` | None beyond core |

### Infrastructure Adapters (right side)

| Package | Exports | External dep |
| --- | --- | --- |
| `@ontrails/logging` | `createLogger()`, sinks, formatters | None beyond core |
| `@ontrails/logging/logtape` | Sink adapter | `@logtape/logtape` (optional peer) |
| `@ontrails/tracks` (planned) | `tracksLayer()`, telemetry | OTel (optional peer) |
| `@ontrails/index-sqlite` (planned) | `IndexAdapter` implementation | `bun:sqlite` |

### Ecosystem

| Package | Purpose |
| --- | --- |
| `@ontrails/testing` | `testExamples()`, contract testing, harnesses |
| `@ontrails/schema` | Surface maps, diffing, lock files |
| `@ontrails/daemon` (planned) | Process hosting for registry lifecycle |
| `@ontrails/state` (planned) | Cursor persistence for CLI pagination |

### Apps

| App                | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `apps/trails`      | The `trails` CLI — init, survey, guide         |
| `apps/trails-demo` | Example app                                   |

---

## Data Flow

### Request Path (CLI example)

```text
CLI input ("myapp entity show --name Alpha")
  → Commander parses args/flags
  → CLI adapter matches to trail via CliCommand model
  → Layers run (auth, rate limit, telemetry)
  → Zod validates input against trail's schema
  → TrailContext created (requestId, logger, signal, permit)
  → normalized implementation(validatedInput, ctx) called
  → Result returned
  → Layers post-process (headers, metrics)
  → Result mapped to exit code + stdout output
```

### The same trail on MCP

```text
MCP tool call ({ name: "myapp_entity_show", arguments: { name: "Alpha" } })
  → MCP adapter matches to trail
  → Zod validates input
  → TrailContext created
  → Same normalized implementation(validatedInput, ctx) called
  → Same Result returned
  → Result mapped to MCP tool response
```

The implementation is identical. Only the edges change. Surfaces still await one normalized runtime shape even when the trail author wrote a synchronous implementation.

---

## Error Taxonomy

13 error classes, 10 categories. Each maps to CLI exit codes, HTTP status, JSON-RPC codes, and retryability:

| Category | Exit | HTTP | Retryable | Classes |
| --- | --- | --- | --- | --- |
| validation | 1 | 400 | No | `ValidationError`, `AmbiguousError`, `AssertionError` |
| not_found | 2 | 404 | No | `NotFoundError` |
| conflict | 3 | 409 | No | `AlreadyExistsError`, `ConflictError` |
| permission | 4 | 403 | No | `PermissionError` |
| timeout | 5 | 504 | Yes | `TimeoutError` |
| rate_limit | 6 | 429 | Yes | `RateLimitError` |
| network | 7 | 502 | Yes | `NetworkError` |
| internal | 8 | 500 | No | `InternalError` |
| auth | 9 | 401 | No | `AuthError` |
| cancelled | 130 | 499 | No | `CancelledError` |

All extend `TrailsError` (direct class inheritance, no factory pattern). Pattern matching uses `instanceof` or `error.category`.

---

## Result Type

Built-in. No external dependency.

```typescript
type Result<T, E = Error> = Ok<T> | Err<E>;

const Result = {
  ok: <T>(value: T): Result<T, never> => new Ok(value),
  err: <E>(error: E): Result<never, E> => new Err(error),
};
```

Default error type is `Error`. Implementations return `Result<T, Error>`, not `Result<T, SpecificError>`. Surface adapters auto-wrap plain `Error` into `InternalError` at the boundary.

---

## Runtime Strategy

**Core is runtime-agnostic. Ecosystem is Bun-first. Development is fully Bun.**

Three layers, different rules:

### Published packages — runtime-agnostic

`@ontrails/core`, `@ontrails/cli`, `@ontrails/mcp`, `@ontrails/logging`, `@ontrails/testing`, `@ontrails/schema` must work on Node, Deno, Bun, and edge runtimes. No `Bun.*` APIs, no `bun:*` imports.

| Instead of | Use |
| --- | --- |
| `Bun.randomUUIDv7()` | `crypto.randomUUID()` (Web Crypto, works everywhere) |
| `Bun.hash()` | Web Crypto `crypto.subtle.digest()` or a pure JS hash |
| `Bun.Glob` | Implement with standard APIs or make glob a separate utility |
| `Bun.stringWidth()` | Pure JS implementation (same approach as `string-width` package) |
| `bun:sqlite` | Not in core — that's `@ontrails/index-sqlite` (ecosystem) |

### Ecosystem packages — Bun-first where it helps

`@ontrails/index-sqlite` uses `bun:sqlite`. `@ontrails/daemon` can use Bun's fast process APIs. These explicitly declare their runtime requirement. Consumers who don't use Bun choose a different adapter.

### Development tooling — fully Bun

The Trails monorepo itself is a Bun workspace. `bun:test` for testing, `bun run` for scripts, `bun.lock` for dependencies. This is how Trails is built and tested. But the published packages don't leak this requirement to consumers.

**The result:** A Trails app built with Node can use `@ontrails/core`, `@ontrails/cli/commander`, `@ontrails/mcp`. They'd use a different index adapter. The framework works. A Trails app on Cloudflare Workers or Deno Deploy works too — core is just TypeScript.

---

## Dependency Graph

```text
@ontrails/core (zod)
     ↑
@ontrails/cli (core)
@ontrails/mcp (core, @modelcontextprotocol/sdk)
@ontrails/logging (core)
@ontrails/testing (core)
@ontrails/schema (core)
     ↑
@ontrails/cli/commander (cli, commander)
@ontrails/logging/logtape (logging, @logtape/logtape)
     ↑
apps/trails (cli/commander, schema, @outfitter/tui, @clack/prompts)
```

Clean DAG. Core at the center. No cycles. Surface adapters depend only on core. Framework adapters (commander, logtape) depend on their parent package. The app layer composes everything.
