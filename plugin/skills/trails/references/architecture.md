# Trails Architecture

## Hexagonal Model

Core defines ports. Everything on the edges is an adapter.

```text
            LEFT SIDE (inbound)             RIGHT SIDE (outbound)
            How the world calls in          How the framework calls out
            +--------------------+          +--------------------+
            |  CLI (commander)   |          |  Resources (core)  |
            |  MCP (sdk)         |          |  Config (config)   |
            |  HTTP (hono/bun)   |          |  Permits (permits) |
            |  Library           |          |  Observe (observe) |
            |  WebSocket (plan.) |          |  Trace state       |
            |                    |          |  (tracing)         |
            |                    |          |  Store (store)     |
            |                    |          |  Drizzle (drizzle) |
            |                    |          |  LogTape/Pino      |
            +---------+----------+          +---------+----------+
                      |                               |
                      +-------> @ontrails/core <------+
                                trail() signal()
                                resource() topo()
                                Result Errors Layers
```

**Core principles:**

- The trail is the product, not the surface. Surfaces are projections.
- Drift is structurally harder than alignment — one schema, one Result type, one error taxonomy.
- Surfaces are peers. CLI, MCP, HTTP, and library are shipped adapters. Adding a surface is a `surface()` call.
- Blazes are surface-agnostic authored implementations: input in, `Result` out.
- The contract is machine-readable at runtime via topo artifacts, Wayfinder, and compatibility survey/guide commands.

## Information Architecture

Every piece of information has a clear ownership model.

### Authored — new information only the developer knows

| What you author | Why |
|----------------|-----|
| Input/output Zod schemas | The shape of your domain |
| Intent and flags: `intent`, `idempotent` | Behavioral assertions |
| Examples (input + expected result or error) | Concrete specifications |
| The `blaze` | Authored implementation that establishes how the trail runs |
| Trail ID (`entity.show`) | Your domain hierarchy |

### Projected — mechanically derived, guaranteed correct

| Authored | Projected to |
|----------|-------------|
| Zod input schema | CLI flags, MCP `inputSchema` (JSON Schema), library input schemas |
| Trail ID | CLI command path (`entity show`), MCP tool name (`app_entity_show`), library export name (`entityShow`) |
| `.describe()` on Zod fields | `--help` text, MCP descriptions |
| `intent: 'read'` | MCP `readOnlyHint`, HTTP GET |
| `intent: 'destroy'` | Auto-add `--dry-run` flag on CLI, MCP `destructiveHint`, HTTP DELETE |
| Error taxonomy class | Exit code, HTTP status, JSON-RPC code, library error class, retryability |
| Examples | Test assertions via `testExamples()`, agent documentation |

### Enforced — constrained by the type system

| Declaration | Constrains |
|------------|-----------|
| `output: z.object({...})` | Blaze return type must match |
| `Result<T, Error>` | Cannot throw — must return `Result.ok()` or `Result.err()` |
| `TrailContext` interface | Blaze receives only framework-provided fields |
| `composes: [...]` on trail | Warden verifies `ctx.compose()` calls match |
| `resources: [...]` on trail | Warden verifies `resource.from(ctx)` / `ctx.resource()` calls match |

### Inferred — detected by static analysis, best-effort

| Inferred | From |
|----------|------|
| Which trails a trail composes | `ctx.compose()` calls in the blaze function |
| Error types returned | `Result.err(new XError(...))` patterns |
| TopoGraph entries and lock hash | All established trails, resources, signals, contours, examples, and derived fields, canonicalized |

Warden uses inference to verify declarations match actual code. Topographer captures the resolved `TopoGraph`, semantic diff, lock manifest, and `topo.lock` artifacts for CI governance. Consumer artifact workflow uses the top-level CLI commands `trails compile`, `trails validate`, and `trails diff`; `trails topo` is for topo-store history and pin management.

Wayfinder is the first agent navigation move over those saved artifacts. For graph questions, start with `trails wayfind overview --root-dir . --json`, then use search, contract, describe, nearby, impact, examples, or diff queries before reconstructing topo facts with raw source search. Use `trails schema <command...>` when you need accepted CLI routes, aliases, flags, and schemas for an operator command. Source reads remain the right fallback for stale or missing artifacts and implementation details Topographer does not project.

## Package Layout

### Foundation

`@ontrails/core` — only external dependency is `zod`. Contains Result, error taxonomy, `trail()`/`signal()`, `topo()`, validation, layers, adapter port interfaces, `executeTrail()` (the shared pipeline), and `run()` (headless execution by trail ID).

### Surface Adapters (left side)

| Package | Purpose | External dep |
|---------|---------|-------------|
| `@ontrails/cli` | Command model, flag derivation, output formatting | None beyond core |
| `@ontrails/commander` | Commander adapter, `surface()` | `commander` |
| `@ontrails/mcp` | MCP tools, annotations, progress bridge, `surface()` | `@modelcontextprotocol/sdk` |
| `@ontrails/http` | HTTP routes, Web Fetch kernel, Bun-native subpath, OpenAPI generation | None beyond core |
| `@ontrails/hono` | Hono adapter, `surface()` | `hono` |
| `@ontrails/library` | Plain TypeScript library projection, runtime-backed package emitter, `surface()` | None beyond core |
| `@ontrails/vite` | Vite dev server adapter | None (node:stream only) |

### Infrastructure Adapters (right side)

| Package | Purpose | External dep |
|---------|---------|-------------|
| `@ontrails/config` | Config resolution, profiles, resource config schemas, diagnostics | None beyond core |
| `@ontrails/permits` | Auth layer, permit model, JWT adapter, scope enforcement | None beyond core |
| `@ontrails/store` | Backend-agnostic schema-derived store definitions | None beyond core |
| `@ontrails/drizzle` | Drizzle SQLite adapter, typed store bindings, read-only bindings | `drizzle-orm` |
| `@ontrails/observe` | Log and trace sink contracts, sink composition, built-in sinks, trace rendering | None beyond core |
| `@ontrails/tracing` | Compatibility tracing exports, SQLite dev store, query/status trails, OTel adapter | None beyond core |
| `@ontrails/logtape` | LogTape sink adapter over `@ontrails/observe` | None (accepts any LogTape-shaped logger via a structural interface) |
| `@ontrails/pino` | Pino sink adapter over `@ontrails/observe` | None (accepts any Pino-shaped logger via a structural interface) |

### Ecosystem

| Package | Purpose |
|---------|---------|
| `@ontrails/testing` | `testAll()`, `testExamples()`, `testTrail()`, contract testing, opt-in surface harness subpaths |
| `@ontrails/topographer` | TopoGraphs, semantic diffing, lock manifest and `topo.lock` helpers, topo-store persistence |
| `@ontrails/warden` | Lint rules, drift detection, CI gating |
| `@ontrails/wayfinder` | Graph-read query trails over saved Topographer artifacts for agent navigation |

### Dependency graph

```text
@ontrails/core (zod)
  <- @ontrails/cli (core)
  <- @ontrails/mcp (core, @modelcontextprotocol/sdk)
  <- @ontrails/http (core)
  <- @ontrails/library (core)
  <- @ontrails/config (core)
  <- @ontrails/permits (core)
  <- @ontrails/tracing (core)
  <- @ontrails/observe (core)
  <- @ontrails/store (core)
  <- @ontrails/drizzle (store, drizzle-orm)
  <- @ontrails/testing (core, observe; optional cli/mcp/http subpaths)
  <- @ontrails/topographer (core)
  <- @ontrails/wayfinder (core, topographer)
     <- @ontrails/commander (cli, commander)
     <- @ontrails/hono (http, hono)
     <- @ontrails/vite (node:stream only)
     <- @ontrails/logtape (observe)
     <- @ontrails/pino (observe)
     <- @ontrails/warden (core, topographer)
```

## Data Flow

### Shared Execution Pipeline

All surfaces delegate to `executeTrail(trail, rawInput, options)` from `@ontrails/core`. It is the single runtime path for validation, context setup, layers, and the blazed trail:

```text
executeTrail(trail, rawInput, options)
  -> Zod validates input against trail's schema  -> Result.err(ValidationError) on failure
  -> TrailContext created (requestId, logger, abortSignal)
  -> Resources resolved (create singletons or retrieve cached)
  -> Layers composed around the blaze (layers can access resources)
  -> blaze(validatedInput, ctx) entered
  -> Result returned (never throws)
```

Surfaces only differ in how they parse inbound requests and map Results to their response format.

### CLI Request Path

```text
CLI input ("myapp entity show --name Alpha")
  -> Commander parses args/flags
  -> CLI adapter matches trail via CliCommand model
  -> Delegates to executeTrail(trail, parsedInput, { layers, ... })
  -> Result mapped to exit code + stdout
```

### MCP Request Path

```text
MCP tool call ({ name: "myapp_entity_show", arguments: { name: "Alpha" } })
  -> MCP adapter matches trail
  -> Delegates to executeTrail(trail, args, { layers, signal, ... })
  -> Result mapped to MCP tool response (content[], isError)
```

### HTTP Request Path

```text
HTTP request (GET /entity/show?name=Alpha)
  -> Hono or Bun-native surface matches route derived from trail ID
  -> Parses input (query params for GET, JSON body for POST/DELETE)
  -> Delegates to executeTrail(trail, parsedInput, { layers, ... })
  -> Result mapped to JSON response with status code from error taxonomy
```

### Headless Execution (no surface)

`run(topo, id, input, options)` from `@ontrails/core` is the "no-surface" path. It resolves a trail by ID from the topo, then delegates to `executeTrail`. Returns `Result.err(NotFoundError)` if the ID is not registered.

```text
run(myTopo, 'entity.show', { name: 'Alpha' })
  -> Resolves trail from topo by ID
  -> Delegates to executeTrail(trail, input, options)
  -> Result returned
```

The blazed trail is identical across all paths. Only the edges change.

## Error Taxonomy

17 fixed-category error classes across 10 categories, plus the dynamic `RetryExhaustedError` wrapper. All extend `TrailsError`. Pattern match with `instanceof` or `error.category`.

| Category | Exit | HTTP | Retryable | Classes |
|----------|------|------|-----------|---------|
| `validation` | 1 | 400 | No | `ValidationError`, `AmbiguousError` |
| `not_found` | 2 | 404 | No | `NotFoundError`, `VersionNotSupportedError` |
| `conflict` | 3 | 409 | No | `AlreadyExistsError`, `ConflictError` |
| `permission` | 4 | 403 | No | `PermissionError`, `PermitError` |
| `timeout` | 5 | 504 | Yes | `TimeoutError` |
| `rate_limit` | 6 | 429 | Yes | `RateLimitError` |
| `network` | 7 | 502 | Yes | `NetworkError` |
| `internal` | 8 | 500 | No | `InternalError`, `DerivationError`, `RecoverableCompletionError`, `AssertionError` |
| `auth` | 9 | 401 | No | `AuthError` |
| `cancelled` | 130 | 499 | No | `CancelledError` |

`RetryExhaustedError` wraps another `TrailsError`, inherits the wrapped error's category for surface mappings, and always reports `retryable: false`.

Use the most specific `TrailsError` subclass available. The error category determines exit code, HTTP status, JSON-RPC code, and retryability across all surfaces automatically.
