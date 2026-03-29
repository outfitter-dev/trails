# Trails Architecture

## Hexagonal Model

Core defines ports. Everything on the edges is an adapter.

```text
            LEFT SIDE (inbound)             RIGHT SIDE (outbound)
            How the world calls in          How the framework calls out
            +--------------------+          +--------------------+
            |  CLI (commander)   |          |  Logging (logtape) |
            |  MCP (sdk)         |          |  Storage (planned) |
            |  HTTP (planned)    |          |  Telemetry (planned)|
            |  WebSocket (plan.) |          |  Search (planned)  |
            +---------+----------+          +---------+----------+
                      |                               |
                      +-------> @ontrails/core <------+
                                trail() event()
                                topo() Result Errors
                                Layer, Topo
```

**Core principles:**

- The trail is the product, not the surface. Surfaces are projections.
- Drift is structurally harder than alignment — one schema, one Result type, one error taxonomy.
- Surfaces are peers. CLI, MCP, HTTP are equal adapters. Adding a surface is a `blaze()` call.
- Implementations are pure functions. Input in, Result out. No surface awareness.
- The contract is machine-readable at runtime via topo, survey, and guide.

## Information Architecture

Every piece of information has a clear ownership model.

### Authored — new information only the developer knows

| What you author | Why |
|----------------|-----|
| Input/output Zod schemas | The shape of your domain |
| Intent and flags: `intent`, `idempotent` | Behavioral assertions |
| Examples (input + expected result or error) | Concrete specifications |
| The implementation function | Your business logic |
| Trail ID (`entity.show`) | Your domain hierarchy |

### Projected — mechanically derived, guaranteed correct

| Authored | Projected to |
|----------|-------------|
| Zod input schema | CLI flags, MCP `inputSchema` (JSON Schema) |
| Trail ID | CLI command path (`entity show`), MCP tool name (`app_entity_show`) |
| `.describe()` on Zod fields | `--help` text, MCP descriptions |
| `intent: 'read'` | MCP `readOnlyHint`, HTTP GET (future) |
| `intent: 'destroy'` | Auto-add `--dry-run` flag on CLI, MCP `destructiveHint` |
| Error taxonomy class | Exit code, HTTP status, JSON-RPC code, retryability |
| Examples | Test assertions via `testExamples()`, agent documentation |

### Enforced — constrained by the type system

| Declaration | Constrains |
|------------|-----------|
| `output: z.object({...})` | Implementation return type must match |
| `Result<T, Error>` | Cannot throw — must return `Result.ok()` or `Result.err()` |
| `TrailContext` interface | Implementation receives only framework-provided fields |
| `follow: [...]` on trail | Warden verifies `ctx.follow()` calls match |

### Inferred — detected by static analysis, best-effort

| Inferred | From |
|----------|------|
| Which trails a trail follows | `ctx.follow()` calls in run |
| Error types returned | `Result.err(new XError(...))` patterns |
| Surface map entries and hash | All of the above, canonicalized |

Warden uses inference to verify declarations match actual code. The surface map captures inferred information for CI governance.

## Package Layers

### Foundation

`@ontrails/core` — only external dependency is `zod`. Contains Result, error taxonomy, `trail()`/`event()`, `topo()`, validation, layers, and adapter port interfaces.

### Surface Adapters (left side)

| Package | Purpose | External dep |
|---------|---------|-------------|
| `@ontrails/cli` | Command model, flag derivation, output formatting | None beyond core |
| `@ontrails/cli/commander` | Commander adapter, `blaze()` | `commander` (peer) |
| `@ontrails/mcp` | MCP tools, annotations, progress bridge, `blaze()` | `@modelcontextprotocol/sdk` |

### Infrastructure Adapters (right side)

| Package | Purpose | External dep |
|---------|---------|-------------|
| `@ontrails/logging` | Structured logging, sinks, formatters | None beyond core |
| `@ontrails/logging/logtape` | LogTape sink adapter | `@logtape/logtape` (peer) |

### Ecosystem

| Package | Purpose |
|---------|---------|
| `@ontrails/testing` | `testAll()`, `testExamples()`, `testTrail()`, contract testing |
| `@ontrails/schema` | Surface maps, semantic diffing, lock files |
| `@ontrails/warden` | Lint rules, drift detection, CI gating |

### Dependency graph

```text
@ontrails/core (zod)
  <- @ontrails/cli (core)
  <- @ontrails/mcp (core, @modelcontextprotocol/sdk)
  <- @ontrails/logging (core)
  <- @ontrails/testing (core, cli, mcp, logging)
  <- @ontrails/schema (core)
     <- @ontrails/cli/commander (cli, commander)
     <- @ontrails/logging/logtape (logging, @logtape/logtape)
     <- @ontrails/warden (core, schema)
```

## Data Flow

### CLI Request Path

```text
CLI input ("myapp entity show --name Alpha")
  -> Commander parses args/flags
  -> CLI adapter matches trail via CliCommand model
  -> Layers run (auth, rate limit, telemetry)
  -> Zod validates input against trail's schema
  -> TrailContext created (requestId, logger, signal)
  -> implementation(validatedInput, ctx) called
  -> Result returned
  -> Layers post-process
  -> Result mapped to exit code + stdout
```

### MCP Request Path

```text
MCP tool call ({ name: "myapp_entity_show", arguments: { name: "Alpha" } })
  -> MCP adapter matches trail
  -> Zod validates input
  -> TrailContext created
  -> Same implementation(validatedInput, ctx) called
  -> Same Result returned
  -> Result mapped to MCP tool response
```

The implementation is identical. Only the edges change.

## Error Taxonomy

13 error classes across 10 categories. All extend `TrailsError`. Pattern match with `instanceof` or `error.category`.

| Category | Exit | HTTP | Retryable | Classes |
|----------|------|------|-----------|---------|
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

Use the most specific `TrailsError` subclass available. The error category determines exit code, HTTP status, JSON-RPC code, and retryability across all surfaces automatically.
