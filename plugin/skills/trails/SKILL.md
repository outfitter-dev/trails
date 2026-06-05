---
name: trails
description: Build with the Trails framework — define trail contracts, open CLI/MCP surfaces, test with examples, debug errors, migrate codebases, run governance. Use when creating trails, adding surfaces, testing, debugging Trails errors, migrating to Trails, running warden, or any work involving @ontrails/* packages.
metadata:
  trails:
    version: 1.0.0-beta.19
---

# Trails

Contract-first TypeScript framework. Define a trail once with typed input, Result output, examples, meta, and a blaze that establishes how it runs — then surface it on CLI, MCP, or HTTP today, with WebSocket planned on the same contract-first model.

## Quick Start

```typescript
// 1. Define a trail
const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  output: z.object({ message: z.string() }),
  intent: 'read',
  examples: [{ name: 'Basic', input: { name: 'World' }, expected: { message: 'Hello, World!' } }],
  blaze: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
});

// 2. Collect into topo
const graph = topo('myapp', greetModule);

// 3. Open surfaces
await surface(graph);        // CLI — from @ontrails/commander
// await surface(graph);     // MCP — from @ontrails/mcp
// await surface(graph, { port: 3000 }); // HTTP — from @ontrails/hono or @ontrails/http/bun

// 4. Headless execution (no surface needed)
const result = await run(graph, 'greet', { name: 'Alice' });

// 5. Test
testAll(graph);            // Examples + contract suite in one line
```

## Lexicon

Use these terms — they are non-negotiable in Trails codebases.

| Term | Meaning | Not this |
|------|---------|----------|
| `trail` | Unit of work (atomic or composite) | handler, action |
| `compose` | Composition declaration and runtime verb | workflow, route |
| `topo` | Queryable graph of trails, signals, resources, and relationships | registry, collection |
| `blaze` | Authored implementation that establishes how a trail runs from validated input to Result | handler, impl |
| `surface` | The boundary-owned one-liner that opens a graph | serve, mount |
| `graph` | Local name for a topo instance | app, registry |
| `projection` | Deterministic derivation of graph onto a surface shape | mapping |
| `meta` | Trail annotations and ownership data | tags, metadata |
| `warden` | Governance enforcement | linter |

## Package Orientation

Current public packages are lockstep at the same Trails framework version.

- **Core model:** `@ontrails/core` owns Result, errors, trail/signal/contour/topo contracts, resources, layers, execution, validation, and adapter ports.
- **Surfaces:** `@ontrails/commander`, `@ontrails/mcp`, `@ontrails/hono`, and `@ontrails/http/bun` open the same topo on CLI, MCP, Hono HTTP, or Bun-native HTTP. `@ontrails/http` owns shared route derivation, OpenAPI, and the Web Fetch kernel; `@ontrails/cli` owns the framework-agnostic CLI command model; `@ontrails/vite` adapts Trails surfaces for Vite projects.
- **Infrastructure:** `@ontrails/config`, `@ontrails/permits`, `@ontrails/store`, and `@ontrails/drizzle` cover config, authorization, schema-derived stores, and Drizzle SQLite bindings.
- **Observability:** `@ontrails/observe` defines sink contracts; `@ontrails/tracing`, `@ontrails/logtape`, and `@ontrails/pino` provide tracing/dev-state and sink adapters.
- **Ecosystem:** `@ontrails/testing` provides contract tests and surface harnesses; `@ontrails/topographer` owns TopoGraphs, semantic diffing, lock manifests, and topo-store persistence; `@ontrails/warden` owns governance rules; `@ontrails/wayfinder` owns graph-read query trails over saved Topographer artifacts.
- **Beta install policy:** While `.changeset/pre.json` is in prerelease mode, install published Trails packages with exact `1.0.0-beta.N` pins or `@beta`; do not rely on unqualified `latest` unless release notes explicitly advance it.

## Agent Wayfinding

When saved Topographer artifacts can answer a graph question, prefer Wayfinder before raw text search:

- Start with `wayfind.overview` to learn artifact source, freshness, and graph counts.
- Use `wayfind.search` or typed list trails (`wayfind.trails`, `wayfind.resources`, `wayfind.signals`, `wayfind.surfaces`, `wayfind.facets`, `wayfind.versions`, `wayfind.examples`) for filtered discovery.
- Use `wayfind.describe` for a full saved entity record and `wayfind.contract` for a trail or version input/output/intent summary.
- Use `wayfind.nearby`, `wayfind.impact`, and `wayfind.diff` for relation context, blast-radius reads, and explicit saved-baseline comparison.
- Treat Wayfinder as graph-read only. Do not assume `wayfind.errors`, `wayfind.adapters`, generic `wayfind.query`, semantic search, signposts, or implications exist in v0.

Wayfinder trails are internal by default. Host apps expose selected queries deliberately, usually as read-only operator tools or MCP resources protected by the host's authorization boundary.

## Creating Trails

### Atomic vs Composite Trails

- **Atomic trail**: does one thing. `(input, ctx) => Result`. Default choice.
- **Composite trail**: composes other trails. Declares `composes: [...]`, uses `ctx.compose()`.
- **Blazed trail**: a runnable contract. The runtime runs trails, not blazes.

### Trail ID Conventions

Dotted, lowercase, verb-last: `entity.show`, `math.add`, `search`. Dots become CLI subcommands and MCP tool name segments.

### Input Schema

Every field gets `.describe()` — this becomes `--help` text, MCP descriptions, and form labels.

```typescript
input: z.object({
  name: z.string().describe('Entity name to look up'),
  limit: z.number().default(20).describe('Maximum results'),
})
```

### Output Schema

Required for MCP and HTTP surfaces. Define what Result.ok returns.

### Intent and Flags

| Field | Effect |
|-------|--------|
| `intent: 'read'` | Safe, no side effects. MCP: `readOnlyHint`. |
| `intent: 'destroy'` | Irreversible. CLI: auto-adds `--dry-run`. MCP: `destructiveHint`. |
| `idempotent: true` | Safe to retry. |

### Examples

Each example is both documentation AND a test case:

- **Full match**: `expected: { ... }` — deep equals
- **Schema-only**: no expected — validates against output schema
- **Error match**: `error: 'NotFoundError'` — asserts error type

See [contract-patterns.md](references/contract-patterns.md) for detailed patterns. Copy from [trail.md](templates/trail.md) or [composition.md](templates/composition.md).

## Surfaces

Adding a surface is a `surface()` call, not an architecture change. The framework derives everything from the trail contract.

**CLI**: Flags from Zod, subcommands from dotted IDs, exit codes from error taxonomy.

```typescript
import { surface } from '@ontrails/commander';
await surface(graph);
```

**MCP**: Tool names from trail IDs, JSON Schema from Zod, annotations from intent, idempotency, and description.

```typescript
import { surface } from '@ontrails/mcp';
await surface(graph);
```

Dense MCP surfaces may use **surface facets** to group related trails into fewer agent-facing tools. A surface facet is surface-side projection configuration, not a core `Facet` primitive and not a new domain operation. Author it in MCP surface options, call it with `{ trail, input }`, and expect successful results as `{ trail, output }` so the underlying trail stays visible.

```typescript
await surface(graph, {
  facets: {
    governance: {
      description: 'Run project diagnostics and Warden guidance.',
      mcp: { loading: 'deferred' },
      trails: ['doctor', 'warden', 'warden.guide'],
    },
  },
  mcpResources: { examples: true, surfaceMap: true },
});
```

Use `trails://surface-map` and per-trail MCP resources for cold context before guessing at grouped affordances. Adapter-kit may validate resolved projection evidence for future surface adapters, but it does not define or author facets. Do not invent `facet()`, `overlapsWith`, or adapter-kit facet config.

**HTTP**: Routes from trail IDs (dots become path segments), verbs from intent, error responses from taxonomy. Use Hono for framework portability or Bun-native HTTP when you want Bun serving without a third-party runtime; both share the `@ontrails/http` route/fetch kernel.

```typescript
import { surface } from '@ontrails/hono';
await surface(graph, { port: 3000 });
```

```typescript
import { surface } from '@ontrails/http/bun';
await surface(graph, { port: 3000 });
```

WebSocket is planned, not shipped. See the CLI surface docs, the MCP surface docs, and the HTTP package docs for derivation details.

## Resources

Resources declare infrastructure dependencies — databases, API clients, caches — as first-class primitives alongside trails and signals.

**Define** a resource with `resource()`:

```typescript
const db = resource('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  dispose: (conn) => conn.close(),
  health: (conn) => conn.ping(),
  mock: () => createInMemoryDb(),
});
```

The `create` factory receives `ResourceContext` (`env`, `cwd`, `workspaceRoot`, and validated `config` when the resource declares a config schema — not the full `TrailContext`). Resources are singletons, resolved once per process and cached.

**Declare** on trails with `resources: [...]`:

```typescript
const search = trail('search', {
  resources: [db],
  input: z.object({ query: z.string() }),
  output: z.array(z.object({ id: z.string(), title: z.string() })),
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    return Result.ok(await conn.search(input.query));
  },
});
```

**Access** via `db.from(ctx)` (typed, preferred) or `ctx.resource<Database>('db.main')` (dynamic escape hatch).

**Test** with zero config — resources with `mock` factories auto-resolve in `testAll(graph)`. Mark live-only dependencies with `unmockable: { reason }` and provide explicit overrides for examples or contracts that need them.

```typescript
testAll(graph, () => ({ resources: { 'db.main': createSpecialTestDb() } }));
```

**Governance:** The warden enforces `resource-declarations` (usage matches declarations) and `resource-exists` (resource IDs resolve in the topo).

See [contract-patterns.md](references/contract-patterns.md) for declaration patterns and [testing-patterns.md](references/testing-patterns.md) for mock strategies.

## Testing

`testAll(graph)` runs the full contract suite in one line:

1. Topo validation (composes, schemas, signals, resources)
2. Example execution (every example as an assertion)
3. Contract checks (output matches schema)
4. Detour verification (targets exist)

**TDD workflow**: Define trail with examples → run tests (red) → implement (green) → refactor.

Edge cases go in `testTrail(trail, scenarios)`. Use `createComposeContext()` to mock `ctx.compose` for composite trail unit tests. Surface integration uses `@ontrails/testing/cli`, `@ontrails/testing/mcp`, `@ontrails/testing/http`, and `@ontrails/testing/surface-parity`.

See [testing-patterns.md](references/testing-patterns.md) for the full testing API.

## Error Taxonomy

17 fixed-category error classes across 10 categories, plus the dynamic `RetryExhaustedError` wrapper, with deterministic mapping to exit codes, HTTP status, and JSON-RPC codes:

| Category | Classes | Exit | HTTP | Retry |
|----------|---------|------|------|-------|
| validation | ValidationError, AmbiguousError | 1 | 400 | No |
| not_found | NotFoundError, VersionNotSupportedError | 2 | 404 | No |
| conflict | AlreadyExistsError, ConflictError | 3 | 409 | No |
| permission | PermissionError, PermitError | 4 | 403 | No |
| timeout | TimeoutError | 5 | 504 | Yes |
| rate_limit | RateLimitError | 6 | 429 | Yes |
| network | NetworkError | 7 | 502 | Yes |
| internal | InternalError, DerivationError, RecoverableCompletionError, AssertionError | 8 | 500 | No |
| auth | AuthError | 9 | 401 | No |
| cancelled | CancelledError | 130 | 499 | No |

`RetryExhaustedError` is dynamic: it wraps another `TrailsError`, inherits the wrapped error's category for surface mappings, and always reports `retryable: false`.

Use the most specific class. Return `Result.err(new XError(...))`, never throw.

See [error-taxonomy.md](references/error-taxonomy.md) for constructor signatures and patterns. See [common-pitfalls.md](references/common-pitfalls.md) for anti-patterns.

## Migration

Converting existing code to Trails:

1. Inventory handlers (routes, CLI commands, MCP tools)
2. Extract Zod input/output schemas
3. Convert blazes to return Result (replace throw/console.log/process.exit)
4. Compose into topo, open surfaces
5. Add examples, run `testAll()`
6. Run warden for governance

See [migration-checklist.md](references/migration-checklist.md) for the detailed checklist.

## Governance

The warden enforces conventions and detects drift:

```bash
trails warden          # Convention checks
trails warden --lock cached --no-lock-mutation # Governance against cached lock data
trails compile        # Regenerate committed topo artifacts
trails validate       # Verify committed topo artifacts
```

For the current generated rule index, read [warden-guide.md](references/warden-guide.md) instead of relying on copied rule prose.

## References

| Reference | Content |
|-----------|---------|
| [getting-started.md](references/getting-started.md) | Full install-to-test walkthrough |
| [architecture.md](references/architecture.md) | Hexagonal model, package boundaries, data flow |
| [contract-patterns.md](references/contract-patterns.md) | ID naming, schema design, example authoring |
| [trails-language-styleguide](../trails-language-styleguide/SKILL.md) | Prose grammar for lexicon-sensitive docs, ADRs, prompts, and examples |
| CLI surface docs | Flag derivation, output modes, exit codes |
| MCP surface docs | Tool naming, annotations, progress |
| [http-surface.md](references/http-surface.md) | Route derivation, OpenAPI, Hono, Bun-native HTTP, fetch kernel |
| [testing-patterns.md](references/testing-patterns.md) | testAll, testTrail, harnesses |
| [error-taxonomy.md](references/error-taxonomy.md) | Error classes and signatures |
| [warden-guide.md](references/warden-guide.md) | Generated Warden rule guidance from the live manifest |
| [common-pitfalls.md](references/common-pitfalls.md) | 12 anti-patterns with fixes |
| [migration-checklist.md](references/migration-checklist.md) | Step-by-step conversion guide |
| [trail.md](templates/trail.md) | Annotated trail skeleton |
| [composition.md](templates/composition.md) | Annotated composite trail skeleton |
| [patterns.md](examples/patterns.md) | Before/after: common transformation patterns |
| [express-handler.md](examples/express-handler.md) | Before/after: Express routes → trails |
| [cli-command.md](examples/cli-command.md) | Before/after: Commander commands → trails |
| [mcp-tool.md](examples/mcp-tool.md) | Before/after: MCP tool handlers → trails |
| [composition.md](examples/composition.md) | Before/after: direct calls -> ctx.compose |
