# Architecture

Trails uses a hexagonal architecture. Core defines ports. Everything on the edges is a connector.

## The Hexagonal Model

```text
                LEFT SIDE (inbound)
                How the world calls in
                +-----------------------+
                |  CLI (commander)      |
                |  MCP (sdk)            |
                |  HTTP (hono)          |
                |  WebSocket (planned)  |
                +---------+-------------+
                          |
                +---------v-------------+
                |                       |
                |    @ontrails/core     |
                |                       |
                |  trail() -> Trail     |
                |  signal() -> Signal   |
                |  topo() -> Topo       |
                |  Result, Errors       |
                |  Layer, Topo           |
                |                       |
                +---------+-------------+
                          |
                +---------v-------------+
                |  Config (config)      |
                |  Permits (permits)    |
                |  Store (store/drizzle)|
                |  Tracker (tracker)    |
                |  Logging (logtape)    |
                +-----------------------+
                RIGHT SIDE (outbound)
                How the framework calls out
```

The left side is where the world calls in -- CLI commands, MCP tool calls, HTTP requests. The right side is where the framework calls out -- config, auth permits, telemetry tracking, and logging. Core sits in the middle and defines the contracts for both sides.

## Core Principles

**The trail is the product, not the trailhead.** A trail is a typed function with a Zod schema, error taxonomy, examples, and metadata. CLI commands, MCP tools, and HTTP endpoints are projections of that trail onto trailheads.

**Drift is structurally harder than alignment.** One schema, one `Result` type, one error taxonomy. You cannot have different parameter names across trailheads because there is only one schema.

**Trailheads are peers.** No trailhead is privileged. CLI, MCP, HTTP, and WebSocket are all equal connectors reading from the same topo. Adding a trailhead is a `trailhead()` call, not an architecture change.

**Implementations are pure functions.** Input in, `Result` out. No `process.exit()`, no `console.log()`, no `req.headers`. The implementation does not know which trailhead invoked it. Authoring can be sync or async; runtime execution is normalized to one awaitable shape before layers and trailheads run.

**The framework defines ports -- everything concrete is a connector.** CLI framework (Commander, yargs), logging backend (LogTape, pino), storage engine, telemetry exporter -- all pluggable. The framework never imports a concrete implementation.

**The contract is machine-readable at runtime.** The topo, survey, guide, and committed lock artifacts make the trail system queryable by agents, tooling, and CI.

## Information Architecture

Every piece of information in a Trails app has a clear ownership model. Understanding these categories is key to understanding the framework.

### Authored — new information only the developer knows

These are the creative contributions. They can't be derived because they don't exist until someone authors them.

| What you author | Why it can't be derived |
| --- | --- |
| Input and output Zod schemas | The shape of your domain data |
| Safety properties: `intent`, `idempotent` | Behavioral assertions about intent |
| Examples (input plus expected result or error) | Concrete specifications of behavior |
| The implementation function | Your business logic |
| Trail ID (`entity.show`) | Your domain hierarchy and naming |

### Projected — mechanically derived, guaranteed correct

These are deterministic transformations from authored information. If the input exists, the output is unambiguous.

| Authored | Projected |
| --- | --- |
| Zod input schema | CLI flags (types, defaults, descriptions), MCP `inputSchema` (JSON Schema) |
| Trail ID | Full CLI command path (`entity show`, `topo pin`, `topo pin remove`), MCP tool name (`myapp_entity_show`) |
| `.describe()` on Zod fields | `--help` text, MCP tool descriptions |
| `intent: 'read'` | MCP `readOnlyHint`, HTTP GET, skip CLI confirmation |
| `intent: 'destroy'` | Auto-add `--dry-run` flag on CLI, HTTP DELETE |
| Error taxonomy class | Exit code, HTTP status, JSON-RPC code, retryability |
| Examples | Test assertions via `testExamples()`, agent documentation |

### Enforced — constrained by the type system

These are boundaries the compiler enforces on the implementation at development time.

| Declaration | What it constrains |
| --- | --- |
| `output: z.object({...})` | Implementation return type must match the schema shape |
| `Result<T, Error>` | Implementation cannot throw — must return `Result.ok()` or `Result.err()` |
| `TrailContext` interface | Implementation receives only the fields the framework provides |
| `crosses: [...]` on trails | Declares the composition graph; warden verifies `ctx.cross()` calls match |
| `resources: [...]` on trails | Declares infrastructure dependencies; warden verifies `resource.from(ctx)` / `ctx.resource()` usage match |

### Inferred — detected by static analysis, best-effort

These are derived from the implementation code itself. Useful for governance and documentation, but not compiler-guaranteed.

| Inferred                     | From                                       |
| ---------------------------- | ------------------------------------------ |
| Which trails a trail crosses | `ctx.cross()` calls in the implementation |
| Error types returned | `Result.err(new XError(...))` patterns |
| Trailhead map entries and lock metadata | All of the above, canonicalized |

Warden uses inference to verify that declarations match actual code. The trailhead map captures inferred information for CI governance.

### Observed — learned from runtime

The tracker (`@ontrails/tracker`) system captures what actually happens at runtime: execution duration, error distributions, trace context propagation. Observations close the loop -- declarations define intent, observations verify reality.

### Overridden — when derivation doesn't fit

Any derived value can be overridden when the default is wrong for your case:

| Override | When you'd use it |
| --- | --- |
| CLI command name | Default derivation from trail ID doesn't read well |
| MCP tool name | Need to match an external convention |
| Flag name or description | Zod field name doesn't make a good flag |
| `crosses` list | Lock the composition boundary tighter than the code implies |

Overrides are escape hatches. They're visible in the trailhead map as explicit deviations from derivation. They should be rare — if you're overriding everything, the derivation rules are wrong.

**The design heuristic:** when evaluating any new feature, ask "does this require the developer to author information the framework already has?" If yes, derive it. If it genuinely can't be derived, it earns a place on the trail spec. If it can be derived but might be wrong sometimes, derive it with an override.

---

## Package Layers

### Foundation

`@ontrails/core` is the only package with an external dependency: `zod`. It contains Result, error taxonomy, `trail()`/`signal()`, `topo()`, validation, patterns, redaction, branded types, guards, collections, layers, and connector port interfaces.

**The test:** if you are building a trailhead connector or ecosystem package, you should only need `@ontrails/core`.

### Trailhead Connectors (left side)

| Package | What it does | External dep |
| --- | --- | --- |
| `@ontrails/cli` | Framework-agnostic command model, flag derivation, output formatting | None beyond core |
| `@ontrails/cli/commander` | Commander connector, `trailhead()` | `commander` (optional peer) |
| `@ontrails/mcp` | MCP tools, annotations, progress bridge, `trailhead()` | `@modelcontextprotocol/sdk` |
| `@ontrails/http` | HTTP routes, error mapping, `trailhead()` | `hono` |

### Infrastructure Connectors (right side)

| Package | What it does | External dep |
| --- | --- | --- |
| `@ontrails/config` | Config resolution, profiles, resource config schemas, diagnostics | None beyond core |
| `@ontrails/permits` | Auth layer, permit model, JWT connector, scope enforcement | None beyond core |
| `@ontrails/store` | Connector-agnostic schema-derived store definitions | None beyond core |
| `@ontrails/store/drizzle` | Drizzle SQLite connector, typed store bindings, read-only bindings | `drizzle-orm` (optional peer) |
| `@ontrails/tracker` | Telemetry recording, trace context, `trails.db` dev-state sinks | None beyond core |
| `@ontrails/logging` | Structured logging, sinks, formatters | None beyond core |
| `@ontrails/logging/logtape` | LogTape sink connector | `@logtape/logtape` (optional peer) |

### Ecosystem

| Package | What it does |
| --- | --- |
| `@ontrails/testing` | `testAll()`, `testExamples()`, `testTrail()`, contract testing, trailhead harnesses |
| `@ontrails/schema` | Trailhead maps, semantic diffing, OpenAPI generation, lock helpers |
| `@ontrails/warden` | Lint rules, drift detection, CI gating |

### Apps

| App                | What it does                                           |
| ------------------ | ------------------------------------------------------ |
| `apps/trails`      | The `trails` CLI -- create, survey, topo/dev workflows, draft promotion, guide, warden |
| `apps/trails-demo` | Example app demonstrating the framework                |

## Dependency Graph

```text
@ontrails/core (zod)
     ^
@ontrails/cli (core)
@ontrails/mcp (core, @modelcontextprotocol/sdk)
@ontrails/http (core, hono)
@ontrails/config (core)
@ontrails/permits (core)
@ontrails/store (core)
@ontrails/store/drizzle (store, drizzle-orm)
@ontrails/tracker (core)
@ontrails/logging (core)
@ontrails/testing (core, cli, mcp, logging)
@ontrails/schema (core)
     ^
@ontrails/cli/commander (cli, commander)
@ontrails/logging/logtape (logging, @logtape/logtape)
@ontrails/warden (core, schema)
     ^
apps/trails (cli/commander, schema, tracker)
```

Clean DAG. Core at the center. No cycles. Trailhead connectors depend only on core. Framework connectors depend on their parent package.

## Data Flow

### Request Path (CLI)

```text
CLI input ("myapp entity show --name Alpha")
  -> Commander parses args/flags
  -> CLI connector matches to trail via CliCommand model
  -> Zod validates input against trail's schema
  -> TrailContext created (requestId, logger, abortSignal, env, cwd)
  -> Declared resources resolved into ctx
  -> Layers run (auth, rate limit, telemetry)
  -> implementation(validatedInput, ctx) called
  -> Result returned
  -> Layers post-process
  -> Result mapped to exit code + stdout output
```

### The Same Trail on MCP

```text
MCP tool call ({ name: "myapp_entity_show", arguments: { name: "Alpha" } })
  -> MCP connector matches to trail
  -> Zod validates input
  -> TrailContext created
  -> Declared resources resolved into ctx
  -> Same implementation(validatedInput, ctx) called
  -> Same Result returned
  -> Result mapped to MCP tool response
```

### The Same Trail on HTTP

```text
HTTP request (GET /entity/show?name=Alpha)
  -> Hono matches route derived from trail ID
  -> Zod validates input (query params for GET, JSON body for POST/DELETE)
  -> TrailContext created
  -> Declared resources resolved into ctx
  -> Same implementation(validatedInput, ctx) called
  -> Same Result returned
  -> Result mapped to JSON response with status code from error taxonomy
```

The implementation is identical. Only the edges change.

### Headless Execution via `run()`

`run()` is the headless path -- no trailhead connector needed:

```text
run(topo, 'entity.show', { name: 'Alpha' }, options?)
  -> topo.get(id) looks up the trail
  -> executeTrail(trail, rawInput, options) runs the shared pipeline
  -> Result returned, never throws
```

This is useful for server-side composition, background workers, and test harnesses that need to invoke trails by ID without wiring a trailhead.

### The Shared `executeTrail()` Pipeline

All trailheads -- CLI, MCP, HTTP, and `run()` -- delegate to the same `executeTrail()` function in `@ontrails/core`:

```text
executeTrail(trail, rawInput, options?)
  -> Zod validates rawInput against trail's input schema
  -> TrailContext resolved from options/createContext
  -> Declared resources resolved into ctx
  -> Layers composed via composeLayers()
  -> implementation(validatedInput, ctx) called
  -> Result returned
```

This guarantees consistent validation, layer ordering, and error handling regardless of which trailhead initiated the call.

## Error Taxonomy

13 error classes across 10 categories. Each maps to CLI exit codes, HTTP status codes, JSON-RPC codes, and retryability:

| Category | Exit | HTTP | Retryable | Classes |
| --- | --- | --- | --- | --- |
| `validation` | 1 | 400 | No | `ValidationError`, `AmbiguousError` |
| `not_found` | 2 | 404 | No | `NotFoundError` |
| `conflict` | 3 | 409 | No | `AlreadyExistsError`, `ConflictError` |
| `permission` | 4 | 403 | No | `PermissionError` |
| `timeout` | 5 | 504 | Yes | `TimeoutError` |
| `rate_limit` | 6 | 429 | Yes | `RateLimitError` |
| `network` | 7 | 502 | Yes | `NetworkError` |
| `internal` | 8 | 500 | No | `InternalError`, `AssertionError` |
| `auth` | 9 | 401 | No | `AuthError` |
| `cancelled` | 130 | 499 | No | `CancelledError` |

All extend `TrailsError` (direct class inheritance). Pattern matching uses `instanceof` or `error.category`.

## Runtime Strategy

**Trails is Bun-native. Trailheads are universally consumable.**

All packages use Bun APIs where they improve the developer experience: `Bun.file()` for I/O, `Bun.Glob` for discovery, `Bun.randomUUIDv7()` for IDs, `Bun.CryptoHasher` for hashing, `bun:sqlite` for storage.

The trailheads Trails produces (CLI commands, MCP tools, HTTP endpoints) are protocol-based. Consumers interact via standard protocols -- they don't need Bun. A Node project can add Trails by installing Bun alongside Node. Bun runs Node code, so everything coexists.
