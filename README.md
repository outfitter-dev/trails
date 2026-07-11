# Trails

**Define once. Surface everywhere.**

Trails is a contract-first TypeScript framework. Define a trail — typed input, Result output, examples, intent, and an `implementation` that establishes how it runs — and the framework projects it onto CLI, MCP, HTTP, or WebSocket. One definition, every surface, zero drift.

Trails ships CLI, MCP, and HTTP surfaces today. WebSocket is part of the architecture and roadmap, but not yet built.

## Get started

### With an AI agent

**Claude Code** — add the marketplace, then install the plugin:

```bash
claude plugin marketplace add outfitter-dev/trails
claude plugin install trails@trails
```

**Codex, Cursor, and others** — install the skill in the target agent profile:

```bash
npx skills outfitter-dev/trails
```

That command mutates the selected local skill install. Use a disposable or profile-specific target when testing installer behavior, and prefer the repo's [plugin release runbook](./docs/releases/plugin-release.md) for operator preflight checks.

The skill gives your agent the full Trails reference: lexicon, patterns, error taxonomy, surface wiring, testing, and before/after migration examples.

### With code

```bash
bunx @ontrails/trails create --permit '{"id":"local-dev","scopes":["project:write"]}'
```

Follow the prompts — pick a name, choose a starter, select your surfaces. The scaffolder generates a working project with trails, a topo, surface wiring, and tests. The `--permit` flag is required: `create` writes a new project, and Trails write commands always name their authority explicitly instead of assuming it.

Or install manually:

```bash
bun add @ontrails/core@beta @ontrails/cli@beta @ontrails/commander@beta zod
bun add -d @ontrails/testing@beta
```

During the active beta line, use `@beta` for the newest published beta or exact `1.0.0-beta.N` pins for reproducible handoffs. Do not rely on unqualified `latest` unless release notes explicitly say it has been advanced.

## Before and after

### Before: an Express handler

```typescript
app.get('/api/projects/:id', async (req, res) => {
  try {
    const project = await db.projects.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (err) {
    console.error('Failed to fetch project:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### After: a trail

```typescript
const show = trail('project.show', {
  input: z.object({ id: z.string().describe('Project ID') }),
  output: projectSchema,
  intent: 'read',
  examples: [
    { name: 'Found', input: { id: 'p_1' }, expected: { id: 'p_1', name: 'Acme' } },
    { name: 'Missing', input: { id: 'p_0' }, error: 'NotFoundError' },
  ],
  implementation: async (input) => {
    const project = await db.projects.findById(input.id);
    if (!project) return Result.err(new NotFoundError(`Project ${input.id} not found`));
    return Result.ok(project);
  },
});
```

Same behavior, now captured as a runnable trail contract. The framework derives:

- **CLI**: `myapp project show --id p_1` with `--help` text, exit code 2 for not-found
- **MCP**: tool `myapp_project_show` with JSON Schema input, `readOnlyHint` annotation
- **Tests**: both examples run as assertions — `testAll(graph)` validates the happy path and the error path
- **Governance**: warden checks for throws, surface-specific imports in trail code, missing output schemas

You authored the contract and implementation. The framework did the rest.

## What compounds

Each declaration you add to a trail unlocks derived behavior across every surface:

| You add | You get for free |
|---------|-----------------|
| `input` (Zod schema) | CLI flags + `--help` text, MCP JSON Schema, input validation |
| `output` (Zod schema) | Contract tests, MCP response typing, TopoGraph surface entries |
| `intent: 'read'` | MCP `readOnlyHint`, CLI skips confirmation, HTTP GET |
| `intent: 'destroy'` | MCP `destructiveHint`, CLI auto-adds `--dry-run`, HTTP DELETE |
| `examples` | Tests (happy + error path), agent guidance, documentation |
| `composes` | Composition graph, cycle detection, compose coverage in tests |
| `resources: [db]` | Singleton lifecycle, test mock auto-resolution, warden governance |
| `detours` | Recovery paths, detour contract validation, shadowing checks |

The value isn't any single feature. It's that they multiply — each declaration makes every surface smarter without additional wiring.

## How it works

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { surface as cliSurface } from '@ontrails/commander';
import { surface as mcpSurface } from '@ontrails/mcp';
import { z } from 'zod';

// 1. Define trails
const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  output: z.object({ message: z.string() }),
  intent: 'read',
  implementation: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
});

// 2. Collect into topo
const graph = topo('myapp', { greet });

// 3. Open surfaces with any adapter
await cliSurface(graph);      // CLI
// await mcpSurface(graph);   // MCP — same runnable trails
```

The same topo can be opened on HTTP today with `@ontrails/hono` or Bun-native `@ontrails/http/bun`. WebSocket follows the same peer-surface model, but is still planned.

```bash
$ myapp greet --name World
{ "message": "Hello, World!" }
```

## Packages

| Package | What it does |
|---------|-------------|
| [`@ontrails/core`](./packages/core) | Result, errors, trail/signal/entity/topo, validation, schema derivation |
| [`@ontrails/cli`](./packages/cli) | CLI command model - flag derivation, output formatting |
| [`@ontrails/commander`](./adapters/commander) | Commander adapter for the CLI surface |
| [`@ontrails/mcp`](./packages/mcp) | MCP surface — tool generation, annotations, progress bridge |
| [`@ontrails/http`](./packages/http) | HTTP surface model — route derivation, Web Fetch kernel, Bun-native subpath |
| [`@ontrails/hono`](./adapters/hono) | Hono adapter that opens a topo on the HTTP surface using the shared kernel |
| [`@ontrails/vite`](./adapters/vite) | Vite adapter for opening Trails surfaces inside Vite projects |
| [`@ontrails/config`](./packages/config) | Config resolution, profiles, resource config schemas, diagnostics |
| [`@ontrails/permits`](./packages/permits) | Auth layer, permit model, JWT adapter, scope enforcement |
| [`@ontrails/store`](./packages/store) | Backend-agnostic store definitions, typed accessors, adapter-support helpers |
| [`@ontrails/drizzle`](./adapters/drizzle) | Drizzle SQLite adapter, typed store bindings, read-only bindings |
| [`@ontrails/testing`](./packages/testing) | `testAll()`, `testTrail()`, `testComposes()`, contract testing, surface harnesses |
| [`@ontrails/topography`](./packages/topography) | TopoGraphs, semantic diffing, durable artifact helpers, lock manifests, topo-store persistence, Wayfind graph-read query APIs |
| [`@ontrails/source`](./packages/source) | Shared source-code AST parsing, walking, locations, edits, literals, and Trails syntax helpers |
| [`@ontrails/observe`](./packages/observe) | Log and trace sink contracts, sink composition, built-in sinks, trace rendering |
| [`@ontrails/tracing`](./packages/tracing) | Tracing compatibility, query/status trails, `trails.db` dev-state storage, sampling helpers, OTel adapter |
| [`@ontrails/logtape`](./packages/logtape) | Adapter that forwards Trails log records to a LogTape-shaped logger |
| [`@ontrails/pino`](./packages/pino) | Adapter that forwards Trails log records to a Pino-shaped logger |
| [`@ontrails/warden`](./packages/warden) | Convention rules, drift detection, CI formatters |

## Documentation

See **[docs/index.md](./docs/index.md)** for the full guide, organized by what you're trying to do.

## Development

```bash
bun run build          # Build all packages
bun run test           # Run all tests
bun run lint           # Lint with oxlint
bun run typecheck      # TypeScript strict mode
```

## Status

v1 beta. The contract layer, CLI/MCP/HTTP surfaces, `trails topo` and `trails dev` workflows, shared `trails.db`, tracing-backed developer state, schema-derived stores, and the Drizzle runtime are implemented and shipping. The WebSocket surface is designed but not yet built. See [Horizons](./docs/horizons.md) for what's next.
