---
name: trails
description: Build with the Trails framework — define trail contracts, open CLI/MCP surfaces, test with examples, debug errors, migrate codebases, run governance. Use when creating trails, adding surfaces, testing, debugging Trails errors, migrating to Trails, running warden, or any work involving @ontrails/* packages.
metadata:
  trails:
    version: 1.0.0-beta.15
---

# Trails

Contract-first TypeScript framework. Define a trail once with typed input, Result output, examples, and meta — then surface it on CLI, MCP, HTTP, or WebSocket without drift.

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
await surface(graph);        // CLI — from @ontrails/cli/commander
// await surface(graph);     // MCP — from @ontrails/mcp

// 4. Headless execution (no surface needed)
const result = await run(graph, 'greet', { name: 'Alice' });

// 5. Test
testAll(graph);            // Examples + governance in one line
```

## Lexicon

Use these terms — they are non-negotiable in Trails codebases.

| Term | Meaning | Not this |
|------|---------|----------|
| `trail` | Unit of work (atomic or composite) | handler, action |
| `cross` | Composition declaration and runtime verb | workflow, route |
| `topo` | Queryable graph of trails, signals, resources, and relationships | registry, collection |
| `blaze` | Implementation function — input to Result | handler, impl |
| `surface` | The boundary-owned one-liner that opens a graph | serve, mount |
| `graph` | Local name for a topo instance | app, registry |
| `projection` | Deterministic derivation of graph onto a surface shape | mapping |
| `meta` | Trail annotations and ownership data | tags, metadata |
| `warden` | Governance enforcement | linter |

## Creating Trails

### Atomic vs Composite Trails

- **Atomic trail**: does one thing. `(input, ctx) => Result`. Default choice.
- **Composite trail**: composes other trails. Declares `crosses: [...]`, uses `ctx.cross()`.

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
import { surface } from '@ontrails/cli/commander';
await surface(graph);
```

**MCP**: Tool names from trail IDs, JSON Schema from Zod, annotations from intent, idempotency, and description.

```typescript
import { surface } from '@ontrails/mcp';
await surface(graph);
```

**HTTP**: Routes from trail IDs (dots become path segments), verbs from intent, error responses from taxonomy.

```typescript
import { surface } from '@ontrails/hono';
await surface(graph, { port: 3000 });
```

See the CLI surface docs, the MCP surface docs, and the HTTP surface docs for derivation details.

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

The `create` factory receives `ResourceContext` (env, cwd, workspaceRoot only — not the full `TrailContext`). Resources are singletons, resolved once per process and cached.

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

**Test** with zero config — resources with `mock` factories auto-resolve in `testAll(graph)`. Override explicitly when needed:

```typescript
testAll(graph, () => ({ resources: { 'db.main': createSpecialTestDb() } }));
```

**Governance:** The warden enforces `resource-declarations` (usage matches declarations) and `resource-exists` (resource IDs resolve in the topo).

See [contract-patterns.md](references/contract-patterns.md) for declaration patterns and [testing-patterns.md](references/testing-patterns.md) for mock strategies.

## Testing

`testAll(graph)` runs the full governance suite in one line:

1. Topo validation (crosses, schemas, signals, resources)
2. Example execution (every example as an assertion)
3. Contract checks (output matches schema)
4. Detour verification (targets exist)

**TDD workflow**: Define trail with examples → run tests (red) → implement (green) → refactor.

Edge cases go in `testTrail(trail, scenarios)`. Use `createCrossContext()` to mock `ctx.cross` for composite trail unit tests. Surface integration uses `createCliHarness()` / `createMcpHarness()`.

See [testing-patterns.md](references/testing-patterns.md) for the full testing API.

## Error Taxonomy

15 error classes across 10 categories, with deterministic mapping to exit codes, HTTP status, and JSON-RPC codes:

| Category | Classes | Exit | HTTP | Retry |
|----------|---------|------|------|-------|
| validation | ValidationError, AmbiguousError | 1 | 400 | No |
| not_found | NotFoundError | 2 | 404 | No |
| conflict | AlreadyExistsError, ConflictError | 3 | 409 | No |
| permission | PermissionError | 4 | 403 | No |
| timeout | TimeoutError | 5 | 504 | Yes |
| rate_limit | RateLimitError | 6 | 429 | Yes |
| network | NetworkError | 7 | 502 | Yes |
| internal | InternalError, DerivationError, AssertionError | 8 | 500 | No |
| auth | AuthError | 9 | 401 | No |
| cancelled | CancelledError | 130 | 499 | No |

`RetryExhaustedError` is dynamic: it wraps another `TrailsError`, inherits the wrapped error's category for surface mappings, and always reports `retryable: false`.

Use the most specific class. Return `Result.err(new XError(...))`, never throw.

See [error-taxonomy.md](references/error-taxonomy.md) for constructor signatures and patterns. See [common-pitfalls.md](references/common-pitfalls.md) for anti-patterns.

## Migration

Converting existing code to Trails:

1. Inventory handlers (routes, CLI commands, MCP tools)
2. Extract Zod input/output schemas
3. Convert implementations to return Result (replace throw/console.log/process.exit)
4. Compose into topo, open surfaces
5. Add examples, run `testAll()`
6. Run warden for governance

See [migration-checklist.md](references/migration-checklist.md) for the detailed checklist.

## Governance

The warden enforces conventions and detects drift:

```bash
trails warden          # Convention checks
trails warden --drift-only # Contract drift vs lockfile
trails topo export         # Regenerate committed topo artifacts
trails topo verify         # Verify committed topo artifacts
```

Key rules: no throw in blaze functions, no surface imports, crosses declarations match ctx.cross() calls, resource declarations match db.from(ctx) / ctx.resource() calls, output schemas present, .describe() on fields.

## References

| Reference | Content |
|-----------|---------|
| [getting-started.md](references/getting-started.md) | Full install-to-test walkthrough |
| [architecture.md](references/architecture.md) | Hexagonal model, package boundaries, data flow |
| [contract-patterns.md](references/contract-patterns.md) | ID naming, schema design, example authoring |
| CLI surface docs | Flag derivation, output modes, exit codes |
| MCP surface docs | Tool naming, annotations, progress |
| [testing-patterns.md](references/testing-patterns.md) | testAll, testTrail, harnesses |
| [error-taxonomy.md](references/error-taxonomy.md) | All 15 error classes with signatures |
| [common-pitfalls.md](references/common-pitfalls.md) | 12 anti-patterns with fixes |
| [migration-checklist.md](references/migration-checklist.md) | Step-by-step conversion guide |
| [trail.md](templates/trail.md) | Annotated trail skeleton |
| [composition.md](templates/composition.md) | Annotated composite trail skeleton |
| [patterns.md](examples/patterns.md) | Before/after: common transformation patterns |
| [express-handler.md](examples/express-handler.md) | Before/after: Express routes → trails |
| [cli-command.md](examples/cli-command.md) | Before/after: Commander commands → trails |
| [mcp-tool.md](examples/mcp-tool.md) | Before/after: MCP tool handlers → trails |
| [composition.md](examples/composition.md) | Before/after: direct calls → ctx.cross |
