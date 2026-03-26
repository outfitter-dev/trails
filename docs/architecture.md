# Architecture

Trails uses a hexagonal architecture. Core defines ports. Everything on the edges is an adapter.

## The Hexagonal Model

```text
                LEFT SIDE (inbound)
                How the world calls in
                +-----------------------+
                |  CLI (commander)      |
                |  MCP (sdk)            |
                |  HTTP (planned)       |
                |  WebSocket (planned)  |
                +---------+-------------+
                          |
                +---------v-------------+
                |                       |
                |    @ontrails/core     |
                |                       |
                |  trail() -> Trail     |
                |  hike() -> Hike       |
                |  event() -> Event     |
                |  topo() -> Topo       |
                |  Result, Errors       |
                |  Layer, Topo          |
                |                       |
                +---------+-------------+
                          |
                +---------v-------------+
                |  Logging (logtape)    |
                |  Storage (planned)    |
                |  Telemetry (planned)  |
                |  Search (planned)     |
                +-----------------------+
                RIGHT SIDE (outbound)
                How the framework calls out
```

The left side is where the world calls in -- CLI commands, MCP tool calls, HTTP requests. The right side is where the framework calls out -- logging, storage, telemetry. Core sits in the middle and defines the contracts for both sides.

## Core Principles

**The trail is the product, not the surface.** A trail is a typed function with a Zod schema, error taxonomy, examples, and metadata. CLI commands, MCP tools, and HTTP endpoints are projections of that trail onto surfaces.

**Drift is structurally harder than alignment.** One schema, one `Result` type, one error taxonomy. You cannot have different parameter names across surfaces because there is only one schema.

**Surfaces are peers.** No surface is privileged. CLI, MCP, HTTP, and WebSocket are all equal adapters reading from the same topo. Adding a surface is a `blaze()` call, not an architecture change.

**Implementations are pure functions.** Input in, `Result` out. No `process.exit()`, no `console.log()`, no `req.headers`. The implementation does not know which surface invoked it. Authoring can be sync or async; runtime execution is normalized to one awaitable shape before layers and surfaces run.

**The framework defines ports -- everything concrete is an adapter.** CLI framework (Commander, yargs), logging backend (LogTape, pino), storage engine, telemetry exporter -- all pluggable. The framework never imports a concrete implementation.

**The contract is machine-readable at runtime.** The topo, survey, and guide make the trail system queryable by agents, tooling, and CI.

## Information Architecture

Every piece of information in a Trails app has a clear ownership model. Understanding these categories is key to understanding the framework.

### Authored — new information only the developer knows

These are the creative contributions. They can't be derived because they don't exist until someone authors them.

| What you author | Why it can't be derived |
| --- | --- |
| Input and output Zod schemas | The shape of your domain data |
| Safety markers: `readOnly`, `destructive`, `idempotent` | Behavioral assertions about intent |
| Examples (input plus expected result or error) | Concrete specifications of behavior |
| The implementation function | Your business logic |
| Trail ID (`entity.show`) | Your domain hierarchy and naming |

### Projected — mechanically derived, guaranteed correct

These are deterministic transformations from authored information. If the input exists, the output is unambiguous.

| Authored | Projected |
| --- | --- |
| Zod input schema | CLI flags (types, defaults, descriptions), MCP `inputSchema` (JSON Schema) |
| Trail ID | CLI command path (`entity show`), MCP tool name (`myapp_entity_show`) |
| `.describe()` on Zod fields | `--help` text, MCP tool descriptions |
| `readOnly: true` | MCP `readOnlyHint`, HTTP GET (future), skip CLI confirmation |
| `destructive: true` | Auto-add `--dry-run` flag on CLI |
| Error taxonomy class | Exit code, HTTP status, JSON-RPC code, retryability |
| Examples | Test assertions via `testExamples()`, agent documentation |

### Enforced — constrained by the type system

These are boundaries the compiler enforces on the implementation at development time.

| Declaration | What it constrains |
| --- | --- |
| `output: z.object({...})` | Implementation return type must match the schema shape |
| `Result<T, Error>` | Implementation cannot throw — must return `Result.ok()` or `Result.err()` |
| `TrailContext` interface | Implementation receives only the fields the framework provides |
| `follows: [...]` on hikes | Declares the dependency graph; warden verifies `ctx.follow()` calls match |

### Inferred — detected by static analysis, best-effort

These are derived from the implementation code itself. Useful for governance and documentation, but not compiler-guaranteed.

| Inferred                     | From                                       |
| ---------------------------- | ------------------------------------------ |
| Which trails a hike follows  | `ctx.follow()` calls in the implementation |
| Error types returned         | `Result.err(new XError(...))` patterns     |
| Surface map entries and hash | All of the above, canonicalized            |

Warden uses inference to verify that declarations match actual code. The surface map captures inferred information for CI governance.

### Observed — learned from runtime (future)

The tracks (telemetry) system will capture what actually happens in production: error distributions, latency profiles, service usage patterns. Observations close the loop — declarations define intent, observations verify reality.

### Overridden — when derivation doesn't fit

Any derived value can be overridden when the default is wrong for your case:

| Override | When you'd use it |
| --- | --- |
| CLI command name | Default derivation from trail ID doesn't read well |
| MCP tool name | Need to match an external convention |
| Flag name or description | Zod field name doesn't make a good flag |
| `follows` list | Lock the dependency boundary tighter than the code implies |

Overrides are escape hatches. They're visible in the surface map as explicit deviations from derivation. They should be rare — if you're overriding everything, the derivation rules are wrong.

**The design heuristic:** when evaluating any new feature, ask "does this require the developer to author information the framework already has?" If yes, derive it. If it genuinely can't be derived, it earns a place on the trail spec. If it can be derived but might be wrong sometimes, derive it with an override.

---

## Package Layers

### Foundation

`@ontrails/core` is the only package with an external dependency: `zod`. It contains Result, error taxonomy, `trail()`/`hike()`/`event()`, `topo()`, validation, patterns, redaction, branded types, guards, collections, layers, and adapter port interfaces.

**The test:** if you are building a surface adapter or ecosystem package, you should only need `@ontrails/core`.

### Surface Adapters (left side)

| Package | What it does | External dep |
| --- | --- | --- |
| `@ontrails/cli` | Framework-agnostic command model, flag derivation, output formatting | None beyond core |
| `@ontrails/cli/commander` | Commander adapter, `blaze()` | `commander` (optional peer) |
| `@ontrails/mcp` | MCP tools, annotations, progress bridge, `blaze()` | `@modelcontextprotocol/sdk` |

### Infrastructure Adapters (right side)

| Package | What it does | External dep |
| --- | --- | --- |
| `@ontrails/logging` | Structured logging, sinks, formatters | None beyond core |
| `@ontrails/logging/logtape` | LogTape sink adapter | `@logtape/logtape` (optional peer) |

### Ecosystem

| Package | What it does |
| --- | --- |
| `@ontrails/testing` | `testExamples()`, `testTrail()`, `testHike()`, contract testing, surface harnesses |
| `@ontrails/schema` | Surface maps, semantic diffing, lock files |
| `@ontrails/warden` | Lint rules, drift detection, CI gating |

### Apps

| App                | What it does                                           |
| ------------------ | ------------------------------------------------------ |
| `apps/trails`      | The `trails` CLI -- init, survey, guide, warden |
| `apps/trails-demo` | Example app demonstrating the framework                |

## Dependency Graph

```text
@ontrails/core (zod)
     ^
@ontrails/cli (core)
@ontrails/mcp (core, @modelcontextprotocol/sdk)
@ontrails/logging (core)
@ontrails/testing (core, cli, mcp, logging)
@ontrails/schema (core)
     ^
@ontrails/cli/commander (cli, commander)
@ontrails/logging/logtape (logging, @logtape/logtape)
@ontrails/warden (core, schema)
     ^
apps/trails (cli/commander, schema)
```

Clean DAG. Core at the center. No cycles. Surface adapters depend only on core. Framework adapters depend on their parent package.

## Data Flow

### Request Path (CLI)

```text
CLI input ("myapp entity show --name Alpha")
  -> Commander parses args/flags
  -> CLI adapter matches to trail via CliCommand model
  -> Layers run (auth, rate limit, telemetry)
  -> Zod validates input against trail's schema
  -> TrailContext created (requestId, logger, signal)
  -> implementation(validatedInput, ctx) called
  -> Result returned
  -> Layers post-process
  -> Result mapped to exit code + stdout output
```

### The Same Trail on MCP

```text
MCP tool call ({ name: "myapp_entity_show", arguments: { name: "Alpha" } })
  -> MCP adapter matches to trail
  -> Zod validates input
  -> TrailContext created
  -> Same implementation(validatedInput, ctx) called
  -> Same Result returned
  -> Result mapped to MCP tool response
```

The implementation is identical. Only the edges change.

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

**Trails is Bun-native. Surfaces are universally consumable.**

All packages use Bun APIs where they improve the developer experience: `Bun.file()` for I/O, `Bun.Glob` for discovery, `Bun.randomUUIDv7()` for IDs, `Bun.CryptoHasher` for hashing, `bun:sqlite` for storage.

The surfaces Trails produces (CLI commands, MCP tools, HTTP endpoints) are protocol-based. Consumers interact via standard protocols -- they don't need Bun. A Node project can add Trails by installing Bun alongside Node. Bun runs Node code, so everything coexists.
