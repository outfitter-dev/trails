# Trails

**Define once. Surface everywhere.**

Trails is a contract-first TypeScript framework. Define a trail — typed input, Result output, examples, intent — and the framework projects it onto CLI, MCP, HTTP, or WebSocket. One definition, every surface, zero drift.

## Get started

### With an AI agent

**Claude Code** — add the marketplace, then install the plugin:

```bash
claude plugin marketplace add outfitter-dev/trails
claude plugin install trails@trails
```

**Codex, Cursor, and others** — install the skill:

```bash
npx skills outfitter-dev/trails
```

The skill gives your agent the full Trails reference: vocabulary, patterns, error taxonomy, surface wiring, testing, and before/after migration examples.

### With code

```bash
bunx @ontrails/trails create
```

Follow the prompts — pick a name, choose a starter, select your surfaces. The scaffolder generates a working project with trails, a topo, surface wiring, and tests.

Or install manually:

```bash
bun add @ontrails/core @ontrails/cli commander zod
bun add -d @ontrails/testing
```

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
  run: async (input) => {
    const project = await db.projects.findById(input.id);
    if (!project) return Result.err(new NotFoundError(`Project ${input.id} not found`));
    return Result.ok(project);
  },
});
```

Same logic. But now the framework derives:

- **CLI**: `myapp project show --id p_1` with `--help` text, exit code 2 for not-found
- **MCP**: tool `myapp_project_show` with JSON Schema input, `readOnlyHint` annotation
- **Tests**: both examples run as assertions — `testAll(app)` validates the happy path and the error path
- **Governance**: warden checks for throws, surface imports, missing output schemas

You authored the contract. The framework did the rest.

## What compounds

Each declaration you add to a trail unlocks derived behavior across every surface:

| You add | You get for free |
|---------|-----------------|
| `input` (Zod schema) | CLI flags + `--help` text, MCP JSON Schema, input validation |
| `output` (Zod schema) | Contract tests, MCP response typing, surface map entries |
| `intent: 'read'` | MCP `readOnlyHint`, CLI skips confirmation, HTTP GET (future) |
| `intent: 'destroy'` | MCP `destructiveHint`, CLI auto-adds `--dry-run`, HTTP DELETE (future) |
| `examples` | Tests (happy + error path), agent guidance, documentation |
| `follow` | Composition graph, cycle detection, follow coverage in tests |
| `detours` | Recovery paths, warden validates targets exist |

The value isn't any single feature. It's that they multiply — each declaration makes every surface smarter without additional wiring.

## How it works

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { blaze } from '@ontrails/cli/commander';
import { z } from 'zod';

// 1. Define trails
const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  output: z.object({ message: z.string() }),
  intent: 'read',
  run: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
});

// 2. Collect into topo
const app = topo('myapp', { greet });

// 3. Blaze on any surface
blaze(app);              // CLI
// await blaze(app);     // MCP — same trails, same run function
```

```bash
$ myapp greet --name World
{ "message": "Hello, World!" }
```

## Packages

| Package | What it does |
|---------|-------------|
| [`@ontrails/core`](./packages/core) | Result, errors, trail/event/topo, validation, schema derivation |
| [`@ontrails/cli`](./packages/cli) | CLI surface — flag derivation, output formatting, Commander adapter |
| [`@ontrails/mcp`](./packages/mcp) | MCP surface — tool generation, annotations, progress bridge |
| [`@ontrails/testing`](./packages/testing) | `testAll()`, `testTrail()`, `testFollows()`, contract testing, surface harnesses |
| [`@ontrails/schema`](./packages/schema) | Surface maps, semantic diffing, lock files for CI governance |
| [`@ontrails/warden`](./packages/warden) | AST-based convention rules, drift detection, CI formatters |
| [`@ontrails/logging`](./packages/logging) | Structured logging — sinks, formatters, LogTape adapter |

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

v1 beta. The contract layer, CLI and MCP surfaces, testing, and governance are implemented and shipping. HTTP and WebSocket surfaces are designed but not yet built. See [Horizons](./docs/horizons.md) for what's next.
