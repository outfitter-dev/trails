---
name: trails
description: Build with the Trails framework — define trail contracts, wire CLI/MCP surfaces, test with examples, debug errors, migrate codebases, run governance. Use when creating trails, adding surfaces, testing, debugging Trails errors, migrating to Trails, running warden, or any work involving @ontrails/* packages.
---

# Trails

Contract-first TypeScript framework. Define a trail once with typed input, Result output, examples, and metadata — then surface it on CLI, MCP, HTTP, or WebSocket without drift.

## Quick Start

```typescript
// 1. Define a trail
const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  output: z.object({ message: z.string() }),
  intent: 'read',
  examples: [{ name: 'Basic', input: { name: 'World' }, expected: { message: 'Hello, World!' } }],
  run: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
});

// 2. Collect into topo
const app = topo('myapp', greetModule);

// 3. Blaze on surfaces
blaze(app);              // CLI — from @ontrails/cli/commander
await blaze(app);        // MCP — from @ontrails/mcp

// 4. Headless execution (no surface needed)
const result = await dispatch(app, 'greet', { name: 'Alice' });

// 5. Test
testAll(app);            // Examples + governance in one line
```

## Vocabulary

Use these terms — they are non-negotiable in Trails codebases.

| Term | Meaning | Not this |
|------|---------|----------|
| `trail` | Unit of work (atomic or composite) | handler, action |
| `follow` | Composition declaration and runtime verb | workflow, route |
| `topo` | Trail collection | registry |
| `blaze` | Open trails on a surface | serve, mount |
| `surface` | Transport adapter (CLI, MCP, HTTP) | transport |
| `metadata` | Trail annotations | tags |
| `warden` | Governance enforcement | linter |

## Creating Trails

### Atomic vs Composite Trails

- **Atomic trail**: does one thing. `(input, ctx) => Result`. Default choice.
- **Composite trail**: composes other trails. Declares `follow: [...]`, uses `ctx.follow()`.

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

Adding a surface is a `blaze()` call, not an architecture change. The framework derives everything from the trail contract.

**CLI**: Flags from Zod, subcommands from dotted IDs, exit codes from error taxonomy.

```typescript
import { blaze } from '@ontrails/cli/commander';
blaze(app);
```

**MCP**: Tool names from trail IDs, JSON Schema from Zod, annotations from metadata.

```typescript
import { blaze } from '@ontrails/mcp';
await blaze(app);
```

**HTTP**: Routes from trail IDs (dots become path segments), verbs from intent, error responses from taxonomy.

```typescript
import { blaze } from '@ontrails/http/hono';
await blaze(app, { port: 3000 });
```

See [cli-surface.md](references/cli-surface.md), [mcp-surface.md](references/mcp-surface.md), and the HTTP surface docs for derivation details.

## Testing

`testAll(app)` runs the full governance suite in one line:

1. Topo validation (follows, schemas, events)
2. Example execution (every example as an assertion)
3. Contract checks (output matches schema)
4. Detour verification (targets exist)

**TDD workflow**: Define trail with examples → run tests (red) → implement (green) → refactor.

Edge cases go in `testTrail(trail, scenarios)`. Use `createFollowContext()` to mock `ctx.follow` for composite trail unit tests. Surface integration uses `createCliHarness()` / `createMcpHarness()`.

See [testing-patterns.md](references/testing-patterns.md) for the full testing API.

## Error Taxonomy

13 error classes, deterministic mapping to exit codes, HTTP status, and JSON-RPC codes:

| Category | Classes | Exit | HTTP | Retry |
|----------|---------|------|------|-------|
| validation | ValidationError, AmbiguousError | 1 | 400 | No |
| not_found | NotFoundError | 2 | 404 | No |
| conflict | AlreadyExistsError, ConflictError | 3 | 409 | No |
| permission | PermissionError | 4 | 403 | No |
| timeout | TimeoutError | 5 | 504 | Yes |
| rate_limit | RateLimitError | 6 | 429 | Yes |
| network | NetworkError | 7 | 502 | Yes |
| internal | InternalError, AssertionError | 8 | 500 | No |
| auth | AuthError | 9 | 401 | No |
| cancelled | CancelledError | 130 | 499 | No |

Use the most specific class. Return `Result.err(new XError(...))`, never throw.

See [error-taxonomy.md](references/error-taxonomy.md) for constructor signatures and patterns. See [common-pitfalls.md](references/common-pitfalls.md) for anti-patterns.

## Migration

Converting existing code to Trails:

1. Inventory handlers (routes, CLI commands, MCP tools)
2. Extract Zod input/output schemas
3. Convert implementations to return Result (replace throw/console.log/process.exit)
4. Compose into topo, blaze on surfaces
5. Add examples, run `testAll()`
6. Run warden for governance

See [migration-checklist.md](references/migration-checklist.md) for the detailed checklist.

## Governance

The warden enforces conventions and detects drift:

```bash
trails warden          # Convention checks
trails warden --drift  # Contract drift vs lock file
```

Key rules: no throw in run functions, no surface imports, follow declarations match ctx.follow() calls, output schemas present, .describe() on fields.

## References

| Reference | Content |
|-----------|---------|
| [getting-started.md](references/getting-started.md) | Full install-to-test walkthrough |
| [architecture.md](references/architecture.md) | Hexagonal model, package layers, data flow |
| [contract-patterns.md](references/contract-patterns.md) | ID naming, schema design, example authoring |
| [cli-surface.md](references/cli-surface.md) | Flag derivation, output modes, exit codes |
| [mcp-surface.md](references/mcp-surface.md) | Tool naming, annotations, progress |
| [testing-patterns.md](references/testing-patterns.md) | testAll, testTrail, harnesses |
| [error-taxonomy.md](references/error-taxonomy.md) | All 13 error classes with signatures |
| [common-pitfalls.md](references/common-pitfalls.md) | 9 anti-patterns with fixes |
| [migration-checklist.md](references/migration-checklist.md) | Step-by-step conversion guide |
| [trail.md](templates/trail.md) | Annotated trail skeleton |
| [composition.md](templates/composition.md) | Annotated composite trail skeleton |
| [patterns.md](examples/patterns.md) | Before/after: common transformation patterns |
| [express-handler.md](examples/express-handler.md) | Before/after: Express routes → trails |
| [cli-command.md](examples/cli-command.md) | Before/after: Commander commands → trails |
| [mcp-tool.md](examples/mcp-tool.md) | Before/after: MCP tool handlers → trails |
| [composition.md](examples/composition.md) | Before/after: direct calls → ctx.follow |
