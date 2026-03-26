# Trails — Repo Bootstrap Plan

> **Status:** Planning
> **Author:** Matt Galligan
> **Last updated:** 2026-03-25

---

## The Split

**Trails** (`trails.dev`, `@ontrails/*`) is the contract-first action registry framework. New repo, clean versioning, purpose-built from the 13 PRDs. No legacy, no migration debt.

**Outfitter** (`@outfitter/*`) is the general-purpose TypeScript toolkit for building developer tools. Stays in the existing repo. Continues working. Trails depends on Outfitter primitives; Outfitter has no knowledge of Trails.

**Dependency direction:** Trails → Outfitter, never the reverse.

---

## What Goes Where

### Trails Repo (`@ontrails/*`)

Trails has three layers: the **core framework** (core package, surface adapters), the **ecosystem** (packages shaped for Trails projects), and **adapters** (pluggable implementations of framework-defined interfaces).

#### Core Framework

| Package | Purpose | External deps |
|---------|---------|---------------|
| `@ontrails/core` | The framework foundation — see expanded scope below | `zod` |
| `@ontrails/cli` | CLI surface — command model, flag derivation, `output()`, layer composition. **Does not import Commander.** | None beyond core |
| `@ontrails/mcp` | MCP surface — `buildMcpTools()`, annotation auto-generation | `@modelcontextprotocol/sdk` |
| `@ontrails/schema` | Surface maps, diffing, governance | None beyond core |
| `@ontrails/config` | Contract-aware config — `defineConfig()`, resolution stacks, XDG, preferences | `smol-toml` |
| `@ontrails/logging` | Structured logging — clean API, hierarchical categories, redaction from contracts | None beyond core |
| `@ontrails/testing` | `testAllExamples()`, progressive assertion, profile matrices | None beyond core |
| `@ontrails/services` | `defineService()`, lifecycle, health checks, port interfaces for storage/cache/search | None beyond core |
| `@ontrails/http` | HTTP surface — route derivation, status code mapping, SSE, OpenAPI | None beyond core |

#### What's in `@ontrails/core`

Core is everything a surface adapter, ecosystem package, or service adapter needs to integrate with the framework. One import, complete foundation.

**Action system:**

| Module | Exports | Purpose |
|--------|---------|---------|
| `actions.ts` | `ActionSpec`, `defineAction`, `createActionRegistry`, `ActionRegistry`, `ActionSurface` | The action primitive |
| `handler.ts` | `ActionImplementation`, `SyncActionImplementation` | Implementation function types |
| `context.ts` | `ActionContext`, `createActionContext`, `CreateActionContextOptions` | Invocation environment |
| `events.ts` | `EventSpec`, `defineEvent` | Server-originated event definitions |
| `relations.ts` | `ActionRelation`, `RelationType` | Action-to-action relationships |
| `hints.ts` | `CLIHint`, `ActionHint`, `MCPHint` | Surface-specific hints |

**Result and errors:**

| Module | Exports | Purpose |
|--------|---------|---------|
| `result.ts` | `Result`, `Ok`, `Err`, `combine`, `match` | Built-in Result type (no `better-result`) |
| `errors.ts` | 13 error classes, `ErrorCategory`, `exitCodeMap`, `statusCodeMap`, `retryableMap`, `errorCategoryMeta` | Error taxonomy |
| `recovery.ts` | `isRetryable`, `shouldRetry`, `getBackoffDelay` | Retry decision helpers |
| `resilience.ts` | `retry`, `withTimeout` | Resilience wrappers for implementations |

**Schemas and validation:**

| Module | Exports | Purpose |
|--------|---------|---------|
| `validation.ts` | `validateInput`, `formatZodIssues`, `createValidator`, `parseInput` | Zod validation at the boundary |
| `schema.ts` | `zodToJsonSchema`, `JsonSchema` | One canonical Zod → JSON Schema conversion |
| `serialization.ts` | `serializeError`, `deserializeError`, `safeParse`, `safeStringify` | Cross-boundary serialization |
| `fetch.ts` | `fromFetch` | Fetch → Result helper |

**Cross-cutting interfaces:**

| Module | Exports | Purpose |
|--------|---------|---------|
| `layers.ts` | `Layer` interface, layer composition utilities | Surface-agnostic layer contract — every adapter accepts these |
| `health.ts` | `HealthStatus`, `HealthResult` | Shared by services and daemon |
| `adapters.ts` | `IndexAdapter`, `StorageAdapter`, `CacheAdapter`, `AuthAdapter` | Right-side port interfaces for `defineService()` |
| `logging.ts` | `Logger` interface, `LogLevel`, `LogMethod`, `LogMetadata` | Logger contract (not implementation) |
| `stream.ts` | `StreamEvent`, `ProgressCallback` | Streaming progress types |

**Types and utilities (folded in from `@outfitter/types`):**

| Module | Exports | Purpose |
|--------|---------|---------|
| `branded.ts` | `Branded<T, Tag>`, `brand()`, `unbrand()`, `Email`, `UUID`, `NonEmptyString`, `PositiveInt` | Nominal typing for action inputs |
| `guards.ts` | `isDefined()`, `isNonEmptyString()`, `isPlainObject()`, `hasProperty()`, `assertType()` | Boundary type narrowing |
| `collections.ts` | `chunk()`, `dedupe()`, `groupBy()`, `sortBy()`, `first()`, `last()`, `NonEmptyArray`, `isNonEmptyArray()` | Collection utilities for implementations |
| `ids.ts` | `shortId()`, `hashId()` | ID generation |
| `type-utils.ts` | `DeepPartial`, `DeepReadonly`, `Prettify`, `AtLeastOne`, `assertNever`, `Mutable` | TypeScript ergonomics |

No separate `@ontrails/types` package. Core IS the types. Trails is TypeScript-first — types ship with the code.

**Subpath exports:**

| Import path | Exports | Purpose |
|-------------|---------|---------|
| `@ontrails/core/patterns` | `paginationFields`, `paginatedOutput`, `bulkOutput`, `dateRangeFields`, `sortFields`, `timestampFields`, `statusFields`, `changeOutput`, `progressFields` | Composable Zod schema helpers |
| `@ontrails/core/redaction` | `createRedactor`, `DEFAULT_PATTERNS`, `DEFAULT_SENSITIVE_KEYS`, `RedactorConfig` | Sensitive data scrubbing |

**What does NOT go in core:**

| Concern | Package | Why it's separate |
|---------|---------|-------------------|
| `createLogger()`, sinks, formatters | `@ontrails/logging` | Implementation, not interface |
| `buildCliCommands()`, flag derivation | `@ontrails/cli` | Surface-specific |
| `buildMcpTools()` | `@ontrails/mcp` | Surface-specific |
| `defineService()`, lifecycle ordering | `@ontrails/services` | Application-level concern |
| `generateSurfaceMap()`, diffing | `@ontrails/schema` | Governance tooling |
| `defineConfig()`, resolution stacks | `@ontrails/config` | Config system is substantial |
| `testAllExamples()`, profile matrices | `@ontrails/testing` | Test infrastructure |
| Commander, yargs integration | `@ontrails/cli-commander` | Adapter |

**The test:** If you're building a Trails surface adapter or a Trails ecosystem package, you should only need `@ontrails/core`. Everything required to integrate with the framework comes from one import.

---

#### Adapters

Most adapters ship as **subpath exports** of the package they adapt — one install, tree-shaken. Niche alternatives are standalone packages.

**Subpath adapters (default choices, ship with the parent package):**

| Import path | What it adapts | External dep |
|-------------|---------------|-------------|
| `@ontrails/cli/commander` | `CliCommand[]` → Commander program | `commander` (optional peer) |
| `@ontrails/logging/logtape` | Sink adapter for logtape (recommended default) | `@logtape/logtape` (optional peer) |
| `@ontrails/logging/pino` | Sink adapter for pino | `pino` (optional peer) |
| `@ontrails/telemetry/otel` | OTel exporter | `@opentelemetry/*` (optional peer) |

**Standalone adapter packages (niche alternatives):**

| Package | What it adapts | External dep |
|---------|---------------|-------------|
| `@ontrails/cli-yargs` (future) | `CliCommand[]` → yargs | `yargs` |
| `@ontrails/cli-citty` (future) | `CliCommand[]` → citty | `citty` |
| `@ontrails/telemetry-datadog` (future) | Datadog exporter | `dd-trace` |
| `@ontrails/index-sqlite` | FTS5 search index (from `@outfitter/index`) | `bun:sqlite` |
| `@ontrails/index-meilisearch` (future) | MeiliSearch search index | `meilisearch` |

**The principle:** If there's a clear default most users want (Commander for CLI, OTel for telemetry), it's a subpath — one install, tree-shaken if unused. If it's one-of-many alternatives, it's a standalone package.

#### Ecosystem (Packages shaped for Trails projects)

| Package | Purpose | Built from |
|---------|---------|------------|
| `@ontrails/daemon` | Process hosting for registries — understands `registry.start()`/`registry.stop()`, service ordering, health aggregation, signal propagation to `ctx.signal` | `@outfitter/daemon`, reshaped for Trails |
| `@ontrails/state` | Cursor persistence for CLI pagination — aligned with `paginatedOutput()` patterns | `@outfitter/state`, types aligned |
| `@ontrails/docs` | Action/surface documentation assembly, `llms.txt` generation, freshness checks | `@outfitter/docs`, reshaped |
| `@ontrails/telemetry` | Contract-aware instrumentation, `telemetryLayer`, adapter interface | Observability PRD |

**Future ecosystem packages** (designed in PRDs, built when needed):
- `@ontrails/ws` — WebSocket surface
- `@ontrails/graph` — Action graph queries

#### Apps

| App | Purpose |
|-----|---------|
| `apps/trails` | The `trails` CLI — `init`, `schema`, `diff`, `serve`. Imports `@outfitter/tui` for rendering, `@clack/prompts` for interactive flows. This is the opinionated app layer. |
| `apps/trails-demo` | Example app demonstrating the framework |

### Outfitter Repo (`@outfitter/*`) — What Stays

General-purpose TypeScript building blocks. None know about actions, registries, or surfaces. All import `Result` from `@ontrails/core` (dogfooding).

| Package | Purpose | Changes |
|---------|---------|---------|
| `@outfitter/types` | Branded types, type guards, collection utilities | Content folded into `@ontrails/core`. Stays published for direct consumers; Trails projects don't need it |
| `@outfitter/tui` | Terminal rendering (tables, lists, trees, themes, borders) | Extract text utilities. Remove `@outfitter/cli` peer dep |
| `@outfitter/file-ops` | Workspace detection, path security, locking, glob | Switch Result import to `@ontrails/core` |
| `@outfitter/tooling` | Dev tooling presets (tsconfig, lefthook, oxlint, markdownlint) | Remove framework-specific checks |
| `@outfitter/presets` | Scaffold templates and catalog versions | Fix dependency bloat |

Four active packages (types becomes a legacy re-export). All general-purpose. None know about actions, registries, or surfaces.

---

## Trails Owns Its Result Type — `better-result` Goes Away

**Decision: Trails implements its own `Result` type and error system. `better-result` is dropped as a dependency.**

### Why

`better-result` provides `Result`, `TaggedError`, and `TaggedErrorClass`. But Trails already extends all three:
- Result extensions (`combine2`, `combine3`, `expect`, `orElse`, `unwrapOrElse`) live in core, not in `better-result`
- Error classes wrap `TaggedError` bases with a second level of indirection (`TaggedError("ValidationError")` → `ValidationErrorBase` → `class ValidationError extends ValidationErrorBase`)
- The default error generic is constrained — Trails wants `Result<T, Error>` (widened), not `Result<T, E extends SomeConstraint>`

Half the API already lives outside the library. The rest is ~80 lines of code.

### Trails-Native Result

```typescript
type Result<T, E = Error> = Ok<T> | Err<E>;

const Result = {
  ok: <T>(value: T): Result<T, never> => new Ok(value),
  err: <E>(error: E): Result<never, E> => new Err(error),
};
```

Default error type is `Error`. Add `map`, `flatMap`, `mapErr`, `match`, `combine` for a complete, purpose-built Result shaped for the framework. No external dependency.

### Trails-Native Error System

Instead of the `TaggedError` factory pattern (two levels of indirection), Trails uses direct class inheritance:

```typescript
// One level. category is the discriminant, not _tag.
abstract class TrailsError extends Error {
  abstract readonly category: ErrorCategory;
  exitCode() { return exitCodeMap[this.category]; }
  statusCode() { return statusCodeMap[this.category]; }
  get retryable() { return retryableMap[this.category]; }
}

class ValidationError extends TrailsError {
  readonly category = "validation" as const;
  constructor(public readonly field?: string, message?: string) {
    super(message ?? "Validation failed");
  }
}
```

Pattern matching uses `instanceof` or `error.category` — both map directly to exit codes, HTTP status, and retryability. No `_tag` property needed (that was a `better-result` convention).

### Outfitter Dogfoods Trails

Outfitter packages import `Result` and error types from `@ontrails/core`:

```typescript
// @outfitter/file-ops
import { Result, ValidationError, NotFoundError } from "@ontrails/core";
```

The dependency graph is a clean DAG:

```
@ontrails/core  (owns Result, errors, ActionSpec — depends on: zod)
     ↑                        ↑
@outfitter/file-ops    @outfitter/daemon    (import Result from Trails)
@outfitter/state       @outfitter/index
     ↑
@ontrails/config     (can use @outfitter/file-ops for workspace detection)
```

No cycles. `@ontrails/core` depends on nothing from Outfitter. Outfitter packages import core types from Trails. Trails packages import utilities from Outfitter where useful.

---

## The Tooling Split

The current `@outfitter/tooling` has 14 CLI commands. Some are general dev tooling (check formatting, upgrade Bun). Some are Outfitter-monorepo-specific (check bunup registry, check shard coverage). And some would be Trails-framework-specific (check TSDoc on actions, validate surface maps).

**Three layers:**

### Layer 1: Trails Dev Tools (`@ontrails/dev` or `trails` CLI commands)

Framework-aware checks that understand actions and the contract system:

| Command | What it does | Why it's Trails |
|---------|-------------|-----------------|
| `trails check tsdoc` | Validates TSDoc on exported action declarations | Knows about ActionSpec |
| `trails check exports` | Validates package.json exports match source | Generic but shipped with Trails |
| `trails schema diff` | Contract diffing against git refs | Reads the action registry |
| `trails schema generate` | Regenerate surface.lock | Reads the action registry |
| `trails check surface-drift` | Verify surface.lock is current | Reads the action registry |

These live in `apps/trails` (the CLI app) or as a `@ontrails/dev` package. They require the registry to function.

### Layer 2: General Dev Tooling (`@outfitter/tooling`)

Project-agnostic dev tooling that works for any TypeScript project:

| Command/Preset | What it does | Why it's Outfitter |
|----------------|-------------|-------------------|
| `tsconfig.preset.json` | Strict TypeScript config | Any TS project |
| `tsconfig.preset.bun.json` | Bun-specific TS config | Any Bun project |
| `lefthook.yml` | Git hooks configuration | Any project |
| `.markdownlint-cli2.jsonc` | Markdown linting config | Any project |
| `tooling check` | Run oxlint/ultracite | Wraps standard tools |
| `tooling fix` | Fix lint issues | Wraps standard tools |
| `tooling upgrade-bun` | Upgrade Bun version | Any Bun project |
| `tooling init` | Copy config presets into project | Any project |
| Registry (shadcn-style blocks) | Copy file blocks into projects | Any project |

These stay in `@outfitter/tooling`. No knowledge of actions or registries. Pure dev convenience.

### Layer 3: Monorepo-Specific (stays in Outfitter repo, not published)

Commands that only make sense for the Outfitter monorepo itself:

| Command | What it does | Why it's monorepo-only |
|---------|-------------|----------------------|
| `check-bunup-registry` | Validate bunup filter matches config | Outfitter build system |
| `check-changeset` | Validate changesets for modified packages | Outfitter release flow |
| `check-clean-tree` | Verify git tree is clean | CI-specific |
| `check-boundary-invocations` | Validate cross-package imports | Outfitter architecture rule |
| `check-home-paths` | Check for hardcoded home paths | Outfitter-specific lint |
| `check-markdown-links` | Validate markdown link targets | Could be general, but currently Outfitter-specific |
| `pre-push` | TDD-aware pre-push hook orchestration | Outfitter workflow |

These can stay as scripts or a workspace-only package — they don't need to be published.

**The key insight:** What Trails offers adopters isn't "here's how we like to format code." It's "here's how to govern your action definitions." The Trails CLI handles governance. Outfitter tooling handles dev preferences. The monorepo has its own housekeeping scripts. Three audiences, three layers.

---

## Trails Repo Structure

```
trails/
├── apps/
│   ├── trails/                    # The `trails` CLI app
│   │   ├── src/
│   │   │   ├── commands/          # init, schema, diff, serve
│   │   │   └── index.ts
│   │   └── package.json           # depends on @ontrails/*, @outfitter/tui, @clack/prompts
│   └── trails-demo/               # Example app
│       ├── src/
│       │   ├── actions/           # Example defineAction() calls
│       │   └── index.ts           # blaze on cli + mcp
│       └── package.json
├── packages/
│   ├── core/                      # @ontrails/core
│   │   ├── src/
│   │   │   ├── index.ts           # Main barrel — action system + Result + errors
│   │   │   │
│   │   │   │ # Action system
│   │   │   ├── actions.ts         # ActionSpec, defineAction, createActionRegistry
│   │   │   ├── handler.ts         # ActionImplementation, SyncActionImplementation
│   │   │   ├── context.ts         # ActionContext, createActionContext
│   │   │   ├── events.ts          # EventSpec, defineEvent
│   │   │   ├── relations.ts       # ActionRelation, RelationType
│   │   │   ├── hints.ts           # CLIHint, ActionHint, MCPHint
│   │   │   │
│   │   │   │ # Result and errors
│   │   │   ├── result.ts          # Result, Ok, Err, combine, match (built-in)
│   │   │   ├── errors.ts          # Error taxonomy (13 classes, 10 categories)
│   │   │   ├── recovery.ts        # isRetryable, shouldRetry, getBackoffDelay
│   │   │   ├── resilience.ts      # retry, withTimeout
│   │   │   │
│   │   │   │ # Schemas and validation
│   │   │   ├── validation.ts      # validateInput, formatZodIssues, createValidator
│   │   │   ├── schema.ts          # zodToJsonSchema (one canonical copy)
│   │   │   ├── serialization.ts   # serializeError, deserializeError, safeParse
│   │   │   ├── fetch.ts           # fromFetch (fetch → Result)
│   │   │   │
│   │   │   │ # Cross-cutting interfaces
│   │   │   ├── layers.ts          # Layer interface, composition utilities
│   │   │   ├── health.ts          # HealthStatus, HealthResult
│   │   │   ├── adapters.ts        # IndexAdapter, StorageAdapter, CacheAdapter
│   │   │   ├── logging.ts         # Logger interface, LogLevel (not implementation)
│   │   │   ├── stream.ts          # StreamEvent, ProgressCallback
│   │   │   │
│   │   │   │ # Subpath exports
│   │   │   ├── patterns/          # @ontrails/core/patterns
│   │   │   │   ├── pagination.ts  # paginationFields, paginatedOutput
│   │   │   │   ├── bulk.ts        # bulkOutput
│   │   │   │   ├── date-range.ts  # dateRangeFields
│   │   │   │   ├── sorting.ts     # sortFields
│   │   │   │   ├── timestamps.ts  # timestampFields
│   │   │   │   ├── status.ts      # statusFields
│   │   │   │   ├── change.ts      # changeOutput
│   │   │   │   ├── progress.ts    # progressFields
│   │   │   │   └── index.ts
│   │   │   └── redaction/         # @ontrails/core/redaction
│   │   │       ├── index.ts       # createRedactor, DEFAULT_PATTERNS
│   │   │       └── ...
│   │   └── package.json           # depends on zod ONLY
│   ├── cli/                       # @ontrails/cli
│   │   ├── src/
│   │   │   ├── actions.ts         # buildCliCommands → CliCommand[] model
│   │   │   ├── model.ts           # CliCommand, CliFlag, CliArgument types
│   │   │   ├── flags.ts           # Flag presets, deriveFlags from Zod
│   │   │   ├── output.ts          # output(), resolveOutputMode
│   │   │   ├── layers.ts          # Layer composition for CLI
│   │   │   ├── commander/         # Subpath: @ontrails/cli/commander
│   │   │   │   ├── adapter.ts     # toCommander(commands) → Commander program
│   │   │   │   ├── blaze.ts        # blaze(app) — one-liner convenience
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   └── package.json           # depends on @ontrails/core; commander as optional peer
│   ├── mcp/                       # @ontrails/mcp
│   │   ├── src/
│   │   │   ├── server.ts          # createMcpServer, defineTool, defineResource
│   │   │   ├── actions.ts         # buildMcpTools
│   │   │   ├── progress.ts        # createMcpProgressCallback
│   │   │   ├── transport.ts       # connectStdio, createSdkServer
│   │   │   └── index.ts
│   │   └── package.json           # depends on @ontrails/core, @modelcontextprotocol/sdk
│   ├── schema/                    # @ontrails/schema
│   │   ├── src/
│   │   │   ├── surface.ts         # generateSurfaceMap, hashSurfaceMap
│   │   │   ├── manifest.ts        # generateManifest
│   │   │   ├── diff/              # diffSurfaceMaps
│   │   │   └── index.ts
│   │   └── package.json           # depends on @ontrails/core
│   ├── config/                    # @ontrails/config
│   │   ├── src/
│   │   │   ├── define.ts          # defineConfig, composeConfig
│   │   │   ├── resolution.ts      # defineResolution, layer primitives
│   │   │   ├── layers.ts          # xdg, project, pattern, env, custom, inline
│   │   │   ├── preferences.ts     # definePreferences
│   │   │   ├── presets.ts         # withLocal, full, envOnly, minimal
│   │   │   ├── xdg.ts            # Full XDG Base Directory compliance
│   │   │   └── index.ts
│   │   └── package.json           # depends on @ontrails/core, smol-toml
│   ├── logging/                   # @ontrails/logging
│   │   ├── src/
│   │   │   ├── logger.ts          # createLogger (single API, no factory)
│   │   │   ├── sinks.ts           # createConsoleSink, createFileSink
│   │   │   ├── formatters.ts      # createJsonFormatter, createPrettyFormatter
│   │   │   ├── categories.ts      # Hierarchical category filtering
│   │   │   └── index.ts
│   │   └── package.json           # depends on @ontrails/core
│   ├── testing/                   # @ontrails/testing
│   │   ├── src/
│   │   │   ├── examples.ts        # testAllExamples, testAction
│   │   │   ├── contracts.ts       # testContracts, testRecoveryPaths
│   │   │   ├── profiles.ts        # testWithProfiles, testWithPreferences, testAll
│   │   │   ├── config.ts          # testConfig.profilesValidate, etc.
│   │   │   ├── events.ts          # testEventSchemas, testEventContracts
│   │   │   ├── harness/
│   │   │   │   ├── cli.ts         # createCliHarness
│   │   │   │   └── mcp.ts         # createMcpHarness
│   │   │   ├── mocks.ts           # createTestActionContext, createTestLogger
│   │   │   └── index.ts
│   │   └── package.json           # depends on @ontrails/core
│   └── services/                  # @ontrails/services
│       ├── src/
│       │   ├── define.ts          # defineService
│       │   ├── lifecycle.ts       # Startup/shutdown ordering
│       │   ├── health.ts          # Health check aggregation
│       │   └── index.ts
│       └── package.json           # depends on @ontrails/core
├── AGENTS.md
├── CLAUDE.md
├── package.json                   # Workspace root
└── bun.lock
```

---

## The API Vocabulary

### Branded (the words people remember)

| Term | What it does | Metaphor |
|------|-------------|----------|
| `trail()` | Define a path from input to output | Mark a trail |
| `route()` | Define a composite that follows multiple trails | Plan a route across trails |
| `trailhead()` | Collect trails into an app | Plan the trail system |
| `blaze()` | Open the app on a surface | Blaze the trails for others |
| `ctx.follow()` | Call another trail from within a route | Follow a connecting trail |
| `topo` | The collection of all trails (internal/power users) | The topography |
| `follows: [...]` | What a route traverses | The trails this route follows |

### Standard (universal terms, no learning curve)

| Term | What it does |
|------|-------------|
| `event()` | Define a server-originated event |
| `Result` | Success/failure return type |
| `Layer` | Cross-cutting surface wrapper |
| `Surface` | `"cli" \| "mcp" \| "http" \| "ws"` |

### Types (mostly inferred, rarely typed explicitly)

| Type | What it represents |
|------|-------------------|
| `Trail<I, O>` | The spec — what `trail()` returns |
| `Route<I, O>` | A trail with `follows` — what `route()` returns |
| `Event<T>` | The event spec — what `event()` returns |
| `TrailContext` | The invocation environment |
| `Implementation<I, O>` | The function type (almost always inferred) |
| `Topo` | The trail collection type |
| `Relation` | Trail-to-trail relationship |
| `Example` | Input/output pair |
| `CliSpec` / `McpSpec` / `HttpSpec` | Per-surface overrides |

**Define trails → Collect into app → Blaze on surfaces.** Three branded words. The whole framework.

## Adding a Surface is Two Lines

Each surface package exports a `blaze()` function that does everything — build commands/tools/routes from the app, wire up the framework adapter, start listening. One import and one function call per surface.

### MCP-only tool (the starting point)

```typescript
import { trail, trailhead, Result } from "@ontrails/core";
import { blaze } from "@ontrails/mcp";
import { z } from "zod";

// Define a trail
export const hello = trail("hello", {
  input: z.object({ name: z.string() }),
  implementation: async (input) => Result.ok(`Hello, ${input.name}!`),
});

// Collect and blaze
import * as actions from "./trails/hello";
blaze(trailhead("myapp", actions), { stdio: true });
```

### Add CLI — two lines

```typescript
import { blaze as blazeMcp } from "@ontrails/mcp";
import { blaze as blazeCli } from "@ontrails/cli/commander";

// ... same app, same trails ...

const app = trailhead("myapp", actions);
blazeMcp(app, { stdio: true });
blazeCli(app);  // Every trail becomes a CLI command. Flags from Zod. --json for free.
```

### Add HTTP — one more line

```typescript
import { blaze as blazeHttp } from "@ontrails/http";
blazeHttp(app, { port: 3000, prefix: "/api/v1" });
// GET for readOnly trails, POST for mutations. Error taxonomy → status codes. SSE for events.
```

Same app. Same trails. Same implementations. Each surface gets everything the app declares — commands, flags, tool definitions, routes, error handling — for free.

### Power users go lower

`blaze()` is sugar over `buildCliCommands()` + adapter wiring. When you need layers, custom context factories, or fine-grained control:

```typescript
import { buildCliCommands } from "@ontrails/cli";
import { toCommander } from "@ontrails/cli/commander";

const commands = buildCliCommands(app, {
  layers: [autoIterateLayer(), dateShortcutsLayer()],
  onResult: myCustomResultHandler,
});

const program = toCommander(commands, { name: "myapp", version: "1.0.0" });
program.parse();
```

`buildCliCommands` returns a `CliCommand[]` model — framework-agnostic. `toCommander` turns it into Commander commands. `toYargs` (from `@ontrails/cli-yargs`) would turn it into yargs commands. The model is the same either way.

---

## The Adapter Pattern (Both Sides)

### Left Side: Surface Adapters are Pluggable

`@ontrails/cli` defines the command model. It does NOT import Commander.

```typescript
// What @ontrails/cli produces — a framework-agnostic model
interface CliCommand {
  name: string;
  description: string;
  args: CliArgument[];
  flags: CliFlag[];
  aliases: string[];
  action: (args: string[], flags: Record<string, unknown>) => Promise<void>;
  subcommands?: CliCommand[];
}
```

**What `@ontrails/cli` does:**
- `buildCliCommands(registry)` → `CliCommand[]` model
- Derive flags from Zod schemas
- Validate input through Zod
- Call implementations
- Map `Result` to exit codes
- `output(value, mode)` → write structured data to stdout
- Accept and compose layers
- `blaze()` convenience (via `/commander` subpath)

**What `@ontrails/cli` does NOT do:**
- Import Commander, yargs, or any CLI framework (that's the adapter's job)
- Import `@outfitter/tui` (no tables, no colors, no boxes)
- Import `@clack/prompts` (no interactive prompts)
- Render progress bars, spinners, or styled output

All rendering lives in `apps/trails` — the opinionated app layer.

### Right Side: Storage, Search, Cache are Pluggable

`@ontrails/services` defines port interfaces. Adapters implement them:

```typescript
// @ontrails/core defines the port
interface IndexAdapter<T> {
  add(doc: IndexDocument): Promise<Result<void, Error>>;
  search(query: SearchQuery): Promise<Result<SearchResult<T>[], Error>>;
  remove(id: string): Promise<Result<void, Error>>;
}

// @ontrails/index-sqlite implements it
import { createSqliteIndex } from "@ontrails/index-sqlite";
const searchService = defineService({
  name: "search",
  create: ({ config }) => createSqliteIndex({ path: config.indexPath }),
});

// @ontrails/index-meilisearch implements it differently
import { createMeiliIndex } from "@ontrails/index-meilisearch";
const searchService = defineService({
  name: "search",
  create: ({ config }) => createMeiliIndex({ host: config.searchUrl }),
});
```

The implementation doesn't know which adapter backs the search service. `ctx.services.search.search(query)` works identically regardless.

### The Principle

Trails defines **ports** (interfaces). Everything concrete is an **adapter**:

| Port (Trails defines) | Adapter (pluggable) |
|-----------------------|---------------------|
| `CliCommand[]` model | `cli-commander`, `cli-yargs` |
| `IndexAdapter` interface | `index-sqlite`, `index-meilisearch` |
| `Sink` interface (logging) | `logging-pino`, `logging-logtape` |
| `TelemetryAdapter` interface | `telemetry-otel`, `telemetry-datadog` |
| MCP server interface | `@modelcontextprotocol/sdk` (peer dep) |
| HTTP route handler | Hono, Bun.serve, Express (framework integration) |

The framework never imports a concrete implementation. Adapters never import each other. The dependency graph is a clean star with `@ontrails/core` at the center.

---

## What `apps/trails` Does

The Trails CLI app is the opinionated, batteries-included experience:

```bash
# Scaffolding
trails init                        # Interactive project setup
trails init --preset api           # Non-interactive with preset
trails init --preset mcp-server    # MCP server starter

# Contract governance
trails schema --all                # Full registry introspection
trails schema --capabilities       # Agent bootstrap
trails schema --config             # Effective configuration
trails schema --events             # Event definitions
trails schema --graph              # Action graph (future)
trails diff main                   # Contract diffing
trails diff v1.0.0 --impact        # With downstream analysis
trails check tsdoc                 # TSDoc coverage on actions
trails check exports               # Export map validation
trails check surface-drift         # Verify surface.lock

# Development
trails serve cli                   # Start CLI surface
trails serve cli mcp               # Start CLI + MCP
trails serve http --port 3000      # Start HTTP surface

# Utilities
trails schema search --json        # Inspect a single action
trails schema --openapi            # Generate OpenAPI spec
trails schema --deprecated         # List deprecated actions
```

This app imports `@outfitter/tui` for rendering, `@clack/prompts` for interactive flows, and uses the full Trails package set. It's the reference implementation of a Trails-powered CLI.

---

## Outfitter Repo Changes

With the framework and ecosystem pieces in Trails, Outfitter becomes a pure general-purpose toolkit.

### Moved to Trails (reimplemented fresh or reshaped)

| Current Package | Trails Package | Notes |
|----------------|---------------|-------|
| `@outfitter/contracts` | `@ontrails/core` | Reimplemented with all PRD decisions baked in |
| `@outfitter/cli` | `@ontrails/cli` + `@ontrails/cli-commander` | Split: model + adapter |
| `@outfitter/mcp` | `@ontrails/mcp` | Reimplemented fresh |
| `@outfitter/schema` | `@ontrails/schema` | Reimplemented fresh |
| `@outfitter/config` | `@ontrails/config` | Reimplemented from config PRD |
| `@outfitter/logging` | `@ontrails/logging` | Reimplemented from observability PRD |
| `@outfitter/testing` | `@ontrails/testing` | Reimplemented from testing PRD |
| `@outfitter/daemon` | `@ontrails/daemon` | Reshaped for registry lifecycle hosting |
| `@outfitter/index` | `@ontrails/index-sqlite` | Reshaped as a storage adapter |
| `@outfitter/state` | `@ontrails/state` | Aligned with pagination patterns |
| `@outfitter/docs` | `@ontrails/docs` | Reshaped for action/surface documentation |

These packages stay published in `@outfitter/*` for existing consumers with deprecation notices pointing to Trails equivalents. New development happens exclusively in `@ontrails/*`.

### Stays in Outfitter

| Package | Changes Needed |
|---------|---------------|
| `@outfitter/types` | Switch Result import to `@ontrails/core` |
| `@outfitter/tui` | Remove `@outfitter/cli` peer dep. Extract text utilities locally. Switch Result import |
| `@outfitter/file-ops` | Switch Result import to `@ontrails/core` |
| `@outfitter/tooling` | Remove framework-specific checks. Keep general dev presets (tsconfig, lefthook, oxlint) |
| `@outfitter/presets` | Fix dependency bloat. Remove framework-specific templates |


### The `apps/outfitter` question

The current `apps/outfitter/` is the `outfitter` CLI that does scaffolding, checks, and uses the action registry pattern itself. Post-split:

- Framework-specific commands (`schema`, `diff`, `check surface-drift`) move to `apps/trails`
- Action definitions and the registry pattern move to Trails
- The `outfitter` CLI could remain as a toolkit scaffolding tool (`outfitter init` for setting up dev tooling presets)
- Or it could be deprecated in favor of `trails init` handling everything

**Recommendation:** Keep `outfitter` CLI for toolkit concerns (dev tooling setup). `trails` CLI for framework concerns (project scaffolding, governance, surfaces). They're independent tools for independent repos.

---

## Versioning Strategy

**Trails:** Starts at `0.1.0`. Every package starts fresh. No pre-existing version history to manage. Follow semver strictly from day one.

**Outfitter:** Continues on current versions. Packages that switch from `@outfitter/contracts` to `@ontrails/core` get a minor version bump. Packages that are deprecated get a final version with deprecation notice.

---

## Build Sequence

### Phase 1: Foundation

1. Create Trails repo with workspace setup
2. Implement `@ontrails/core` — ActionSpec, ActionImplementation, ActionContext, error taxonomy, patterns, events, relations. All PRD terminology from day one
3. Implement `@ontrails/logging` — clean, no logtape, hierarchical categories
4. Implement `@ontrails/testing` — testAllExamples, progressive assertion, mocks
5. Basic `apps/trails` — `trails init` scaffolding

### Phase 2: Surface Adapters

6. Implement `@ontrails/cli` — buildCliCommands, flag derivation, layers
7. Implement `@ontrails/mcp` — buildMcpTools, annotations
8. Implement `@ontrails/schema` — surface maps, diffing
9. Expand `apps/trails` — `trails schema`, `trails diff`, `trails serve`

### Phase 3: Runtime Services

10. Implement `@ontrails/config` — defineConfig, resolution stacks, preferences
11. Implement `@ontrails/services` — defineService, lifecycle, health
12. Implement `@ontrails/http` — buildHttpRoutes, SSE, OpenAPI

### Phase 4: Ecosystem

13. Implement `@ontrails/telemetry` — OTel spans, adapter interface
14. `trails-demo` app — full example
15. Documentation site at trails.dev

### Parallel: Outfitter cleanup

- Remove `@outfitter/cli` peer dep from `@outfitter/tui`
- Switch Outfitter packages from `@outfitter/contracts` to `@ontrails/core`
- Fix `@outfitter/presets` dependency bloat
- Remove framework-specific tooling commands
- Publish deprecation notices on framework packages

---

## Open Questions

**Should the Trails CLI app live in the Trails repo or in a separate `trails-cli` repo?** Having it in the Trails repo (as `apps/trails`) makes development easy. Having it separate means the framework packages and the CLI app version independently. Start in the Trails repo; extract later if needed.

**Should `@outfitter/docs` move to Trails?** The docs package assembles documentation from package READMEs and generates `llms.txt`. If documentation assembly becomes Trails-aware (documenting actions, surfaces, events), it should move. If it stays general-purpose (any monorepo's docs), it stays in Outfitter. Likely moves to Trails eventually.

**Should `@outfitter/state` move to Trails?** Cursor persistence is most useful for CLI pagination, which is a Trails concern. But it's a general-purpose primitive (any app that needs cursor state). Lean toward keeping in Outfitter — Trails imports it when CLI pagination needs it.

**What's the relationship between `trails init` and `outfitter init`?** `trails init` creates a Trails project (action registry, surface adapters, contract governance). `outfitter init` sets up dev tooling (tsconfig, lefthook, oxlint). A Trails project would run both. They should compose: `trails init` could optionally call `outfitter init` for dev tooling setup, or the developer runs them independently.

**Should the npm scope be `@ontrails` or `@trails`?** Check npm availability. `@trails` is cleaner but may be taken. `@ontrails` matches `trails.dev` domain.
