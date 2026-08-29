# Getting Started

Install the core packages, define your first trail, open surfaces on CLI, MCP, or HTTP, and test it with one line.

This guide demonstrates CLI and MCP first because they are the shortest path to a working app. HTTP is equally shipped today, and WebSocket is still planned.

## Installation

The canonical CLI install uses the Outfitter Homebrew tap. The formula requires [Bun](https://bun.sh) at runtime and installs the CLI's bundled JavaScript plus its platform-specific native parser and resolver dependencies.

```bash
brew install outfitter-dev/tap/trails
trails --version

# Upgrade later
brew update
brew upgrade trails

# Remove the CLI
brew uninstall trails
```

If Trails was the only formula you used from the tap, you may also remove the tap after uninstalling. Leave it configured when other installed formulae share it.

```bash
brew untap outfitter-dev/tap
```

For project dependencies and scaffolding, use Bun:

```bash
# Recommended: scaffold a standalone app
# (create writes a project, so it needs an explicit project:write permit)
bunx @ontrails/trails create my-app --permit '{"id":"local-dev","scopes":["project:write"]}'

# Or scaffold a configured workspace with one app under apps/my-app
bunx @ontrails/trails create my-app --workspace --permit '{"id":"local-dev","scopes":["project:write"]}'

# Or install manually
bun add @ontrails/core@beta @ontrails/cli@beta @ontrails/commander@beta zod

# Add MCP surface (optional)
bun add @ontrails/mcp@beta

# Add HTTP surface (optional, shipped today)
bun add @ontrails/http@beta @ontrails/hono@beta

# Add testing (dev dependency)
bun add -d @ontrails/testing@beta
```

During the active beta line, use `@beta` for the newest published beta or pin exact `1.0.0-beta.N` versions for reproducible handoffs. Do not rely on unqualified `latest` unless release notes explicitly say it has been advanced.

`create` writes authored source, not a lock. After `bun install`, derive the app-owned lock with the locally installed Trails operator:

- From a standalone app root, run `bun run compile --permit '{"id":"local-dev","scopes":["topo:write"]}'`.
- From a configured workspace root, run `bunx trails compile --app my-app --permit '{"id":"local-dev","scopes":["topo:write"]}'`.

That canonical compile path includes deterministic scaffold provenance in the lock's `scaffold` overlay. A workspace never receives an aggregate root lock.

## Your First Trail

A trail is the atomic unit of work in Trails. It has a Zod input schema, an `implementation` that establishes how the trail runs and returns `Result`, and optional examples that double as tests and agent documentation.

Create `src/trails/greet.ts`:

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

export const greet = trail('greet', {
  description: 'Greet someone by name',
  input: z.object({
    name: z.string().describe('Who to greet'),
    loud: z.boolean().default(false).describe('Shout the greeting'),
  }),
  output: z.object({ message: z.string() }),
  intent: 'read',
  examples: [
    {
      name: 'Basic greeting',
      input: { name: 'World' },
      expected: { message: 'Hello, World!' },
    },
    {
      name: 'Loud greeting',
      input: { name: 'World', loud: true },
      expected: { message: 'HELLO, WORLD!' },
    },
  ],
  implementation: (input) => {
    const message = `Hello, ${input.name}!`;
    return Result.ok({
      message: input.loud ? message.toUpperCase() : message,
    });
  },
});
```

What you get from this single definition:

- A typed implementation that receives validated input and returns `Result`
- CLI derivation: `name` auto-promoted to a positional arg (sole required string), `--loud` as a flag
- An MCP tool with JSON Schema input and annotations (`readOnlyHint: true`)
- Two examples that serve as agent documentation AND test cases
- Sync authoring for pure work, with the runtime normalized to one awaitable execution shape for layers and surfaces

## Collect Into a Topo

Create `src/app.ts`:

```typescript
import { topo } from '@ontrails/core';
import * as greetModule from './trails/greet';

export const graph = topo('myapp', greetModule);
```

`topo()` scans the module exports for trails, signals, entities, and resources and builds the resolved graph.

## Open a CLI Surface

Create `bin/cli.ts`:

```typescript
import { surface } from '@ontrails/commander';
import { graph } from '../src/app';

await surface(graph);
```

Run it:

```bash
# Positional arg — `name` is the sole required string field,
# so the CLI auto-promotes it to a positional argument.
$ bun bin/cli.ts greet World
{ "message": "Hello, World!" }

# Flags still work as an alternative.
$ bun bin/cli.ts greet --name World --loud
{ "message": "HELLO, WORLD!" }

$ bun bin/cli.ts greet --help
Usage: myapp greet [options] [name]

Greet someone by name

Arguments:
  name            Who to greet

Options:
  --name <value>  Who to greet
  --loud          Shout the greeting (default: false)
  -h, --help      display help for command
```

When a trail has exactly one required string field with no default, the CLI automatically promotes it to a positional argument. You can still pass it as a flag (`--name World`), but the positional form is shorter. To suppress auto-promotion, set `args: false` on the trail definition (see the [CLI surface guide](./surfaces/cli.md#positional-args)).

## Open an MCP Surface

Create `bin/mcp.ts`:

```typescript
import { surface } from '@ontrails/mcp';
import { graph } from '../src/app';

await surface(graph);
```

Same runnable trail. Different surface. The MCP server exposes a `myapp_greet` tool with:

- JSON Schema input derived from the Zod schema
- `readOnlyHint: true` annotation from `intent: 'read'`
- Examples available for agent planning

Pure implementations can return `Result` directly. Trails with `composes` and I/O-heavy implementations can stay `async`; Trails normalizes both forms before surfaces run the trail.

## Open an HTTP Surface

Create `bin/http.ts`:

```typescript
import { surface } from '@ontrails/hono';
import { graph } from '../src/app';

await surface(graph, { port: 3000 });
```

Same topo. Same runnable trail. Different shipped surface. The HTTP adapter derives routes from trail IDs and verbs from `intent`:

- `greet` becomes `GET /greet` because the trail declares `intent: 'read'`
- Input validation still comes from the same Zod schema
- The same `Result` and error taxonomy map to HTTP responses instead of CLI or MCP output

See the [HTTP surface guide](./surfaces/http.md) for the full route and error model. WebSocket follows the same peer-surface design, but does not have a public package yet.

## Test with `testAll`

Create `src/__tests__/app.test.ts`:

```typescript
import { testAll } from '@ontrails/testing';
import { graph } from '../app';

testAll(graph);
```

Run it:

```bash
$ bun test
 PASS  src/__tests__/app.test.ts
  contract
    topo validation
    greet
      example: Basic greeting
      example: Loud greeting
    contracts
    detours
```

That single `testAll(graph)` call runs the full contract suite:

1. **Topo validation** via `validateTopo` -- composed trails exist, no recursive composition, signal origins, example schema validation, output schema presence
2. **Example execution** -- for each trail, validates input, runs the trail, asserts the result matches `expected` (or validates against the output schema when no `expected` is declared)
3. **Contract checks** -- verifies successful trail results against declared output schemas
4. **Detour contract validation** -- confirms detours declare valid `on` / `recover` semantics and sane ordering

No separate test files for the happy path. The examples ARE the tests.

If your app declares resources with `mock` factories, `testAll(graph)` and `testExamples(graph)` pick them up automatically. Use explicit `resources` overrides only when you need a specific fake or fresh mutable state.

For finer control, use `testExamples(graph)` to run only example assertions without structural checks:

```typescript
import { testExamples } from '@ontrails/testing';
import { graph } from '../app';

testExamples(graph);
```

## Adding More Trails

Create `src/trails/math.ts`:

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

export const add = trail('math.add', {
  input: z.object({
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  }),
  output: z.object({ result: z.number() }),
  intent: 'read',
  examples: [
    {
      name: 'Add two numbers',
      input: { a: 2, b: 3 },
      expected: { result: 5 },
    },
  ],
  implementation: (input) => Result.ok({ result: input.a + input.b }),
});
```

Update `src/app.ts`:

```typescript
import { topo } from '@ontrails/core';
import * as greetModule from './trails/greet';
import * as mathModule from './trails/math';

export const graph = topo('myapp', greetModule, mathModule);
```

The dotted trail ID `math.add` becomes a subcommand on CLI (`myapp math add --a 2 --b 3`) and a namespaced tool on MCP (`myapp_math_add`). No additional configuration needed.

## Composing Trails

A trail can compose other trails via `composes` to accomplish a higher-level task:

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

export const addAndDouble = trail('math.add-and-double', {
  composes: ['math.add'],
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.object({ result: z.number() }),
  implementation: async (input, ctx) => {
    const sum = await ctx.compose('math.add', input);
    if (sum.isErr()) return sum;
    return Result.ok({ result: sum.value.result * 2 });
  },
});
```

Trails declare their composition dependencies with `composes` and invoke them with `ctx.compose()`. The warden linter verifies these match.

## Using Resources

When a trail needs an external dependency — a database, cache, or API client — declare it as a resource:

```typescript
import { resource, trail, Result } from '@ontrails/core';
import { z } from 'zod';

const db = resource('db', {
  create: () => Result.ok(createPool(process.env.DATABASE_URL)),
  mock: () => createMockPool(),
  dispose: (pool) => pool.end(),
});

export const listUsers = trail('user.list', {
  resources: [db],
  input: z.object({}),
  output: z.object({ users: z.array(UserSchema) }),
  intent: 'read',
  implementation: async (input, ctx) => {
    const pool = db.from(ctx);
    const rows = await pool.query('SELECT * FROM users');
    return Result.ok({ users: rows });
  },
});
```

The `resources: [db]` declaration tells the topo which infrastructure this trail depends on. Access the resource instance through `db.from(ctx)` for typed access. When you run `testAll(graph)`, the framework automatically resolves `mock` factories — no configuration needed for example-based tests.

## Compile and Validate Auto-Discovery

`trails compile` and `trails validate` automatically discover a conventional entry point when the selected project extent is one app. No `--module` flag is needed for a standalone app or when CWD is inside one configured app root and the app follows one of these layouts:

- **Single-app:** `src/app.ts`
- **Monorepo:** `apps/*/src/app.ts`

Configured workspaces name app identity in `workspace.apps`. From the workspace root, use `--app <id>` with `trails compile`; a bare `trails validate` deliberately validates the complete configured app set. `trails compile` never fans out and never creates a workspace-root aggregate lock.

Run `trails config explain --json` when you need to inspect the static catalog, resolved app entries, selected extent, and selection provenance. The command does not import app modules or treat locks as app discovery.

If multiple entry candidates are found inside the selected app, the CLI exits with an error listing them; pass `--module` to refine that app's module.

For these commands, `--root-dir` fixes the discovery boundary exactly. `--module` is selected-app-relative by default and never changes app identity or the lock root. They reject URL-shaped paths, absolute paths, and `..` paths that escape the selected app root. Framework code that deliberately loads an app module outside that boundary must opt into `trustedModulePath: true` when calling `loadApp` or `loadFreshAppLease`.

## What's Next

- [Architecture](./architecture.md) -- How the hexagonal model works
- [Lexicon](./lexicon.md) -- All Trails terms defined
- [Testing Guide](./testing.md) -- TDD approach, contract testing, harnesses
- [CLI Surface Guide](./surfaces/cli.md) -- Flag derivation, output modes, layers
- [MCP Surface Guide](./surfaces/mcp.md) -- Annotations, progress, tool naming
