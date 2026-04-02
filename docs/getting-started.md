# Getting Started

Install the core packages, define your first trail, open trailheads on CLI and MCP, and test it with one line.

## Installation

```bash
# Requires Bun (https://bun.sh)

# Recommended: scaffold a new project
bunx @ontrails/trails create

# Or install manually
bun add @ontrails/core @ontrails/cli

# Add Commander connector (for the /commander subpath)
bun add commander

# Add MCP trailhead (optional)
bun add @ontrails/mcp

# Add testing (dev dependency)
bun add -d @ontrails/testing
```

## Your First Trail

A trail is the atomic unit of work in Trails. It has a Zod input schema, an implementation that returns `Result`, and optional examples that double as tests and agent documentation.

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
  blaze: (input) => {
    const message = `Hello, ${input.name}!`;
    return Result.ok({
      message: input.loud ? message.toUpperCase() : message,
    });
  },
});
```

What you get from this single definition:

- A typed implementation that receives validated input and returns `Result`
- CLI flags derived from the Zod schema: `--name <value>`, `--loud`
- An MCP tool with JSON Schema input and annotations (`readOnlyHint: true`)
- Two examples that serve as agent documentation AND test cases
- Sync authoring for pure work, with the runtime normalized to one awaitable execution shape for gates and trailheads

## Collect Into a Topo

Create `src/app.ts`:

```typescript
import { topo } from '@ontrails/core';
import * as greetModule from './trails/greet';

export const app = topo('myapp', greetModule);
```

`topo()` scans the module exports for `Trail` shapes and builds the internal topo (the trail collection).

## Open a CLI Trailhead

Create `src/cli.ts`:

```typescript
import { trailhead } from '@ontrails/cli/commander';
import { app } from './app';

trailhead(app);
```

Run it:

```bash
$ bun src/cli.ts greet --name World
{ "message": "Hello, World!" }

$ bun src/cli.ts greet --name World --loud
{ "message": "HELLO, WORLD!" }

$ bun src/cli.ts greet --help
Usage: myapp greet [options]

Greet someone by name

Options:
  --name <value>  Who to greet
  --loud          Shout the greeting (default: false)
  -o, --output <mode>  Output format (choices: "text", "json", "jsonl", default: "text")
  -h, --help      display help for command
```

## Open an MCP Trailhead

Create `src/mcp.ts`:

```typescript
import { trailhead } from '@ontrails/mcp';
import { app } from './app';

await trailhead(app);
```

Same trail. Same implementation. Different trailhead. The MCP server exposes a `myapp_greet` tool with:

- JSON Schema input derived from the Zod schema
- `readOnlyHint: true` annotation from `intent: 'read'`
- Examples available for agent planning

Pure trails can return `Result` directly. Trails with `crosses` and I/O-heavy trails can stay `async`; Trails normalizes both forms before connectors run them.

## Test with `testAll`

Create `src/__tests__/app.test.ts`:

```typescript
import { testAll } from '@ontrails/testing';
import { app } from '../app';

testAll(app);
```

Run it:

```bash
$ bun test
 PASS  src/__tests__/app.test.ts
  governance
    topo validation
    greet
      example: Basic greeting
      example: Loud greeting
    contracts
    detours
```

That single `testAll(app)` call runs the full governance suite:

1. **Topo validation** via `validateTopo` -- crosses exist, no recursive crossing, event origins, example schema validation, output schema presence
2. **Example execution** -- for each trail, validates input, runs the implementation, asserts the result matches `expected` (or validates against the output schema when no `expected` is declared)
3. **Contract checks** -- verifies implementation output matches declared output schemas
4. **Detour verification** -- confirms detour targets exist in the topo

No separate test files for the happy path. The examples ARE the tests.

If your app declares provisions with `mock` factories, `testAll(app)` and
`testExamples(app)` pick them up automatically. Use explicit `provisions`
overrides only when you need a specific fake or fresh mutable state.

For finer control, use `testExamples(app)` to run only example assertions without structural checks:

```typescript
import { testExamples } from '@ontrails/testing';
import { app } from '../app';

testExamples(app);
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
  blaze: (input) => Result.ok({ result: input.a + input.b }),
});
```

Update `src/app.ts`:

```typescript
import { topo } from '@ontrails/core';
import * as greetModule from './trails/greet';
import * as mathModule from './trails/math';

export const app = topo('myapp', greetModule, mathModule);
```

The dotted trail ID `math.add` becomes a subcommand on CLI (`myapp math add --a 2 --b 3`) and a namespaced tool on MCP (`myapp_math_add`). No additional configuration needed.

## Composing Trails

A trail can compose other trails via `crosses` to accomplish a higher-level task:

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

export const addAndDouble = trail('math.add-and-double', {
  crosses: ['math.add'],
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.object({ result: z.number() }),
  blaze: async (input, ctx) => {
    const sum = await ctx.cross('math.add', input);
    if (sum.isErr()) return sum;
    return Result.ok({ result: sum.value.result * 2 });
  },
});
```

Trails declare their composition dependencies with `crosses` and invoke them with `ctx.cross()`. The warden linter verifies these match.

## Using Services

When a trail needs an external dependency — a database, cache, or API client — declare it as a provision:

```typescript
import { provision, trail, Result } from '@ontrails/core';
import { z } from 'zod';

const db = provision('db', {
  create: () => Result.ok(createPool(process.env.DATABASE_URL)),
  mock: () => createMockPool(),
  dispose: (pool) => pool.end(),
});

export const listUsers = trail('user.list', {
  provisions: [db],
  input: z.object({}),
  output: z.object({ users: z.array(UserSchema) }),
  intent: 'read',
  blaze: async (input, ctx) => {
    const pool = db.from(ctx);
    const rows = await pool.query('SELECT * FROM users');
    return Result.ok({ users: rows });
  },
});
```

The `provisions: [db]` declaration tells the topo which infrastructure this trail depends on. Access the provision instance through `db.from(ctx)` for typed access. When you run `testAll(app)`, the framework automatically resolves `mock` factories — no configuration needed for example-based tests.

## What's Next

- [Architecture](./architecture.md) -- How the hexagonal model works
- [Vocabulary](./vocabulary.md) -- All Trails terms defined
- [Testing Guide](./testing.md) -- TDD approach, contract testing, harnesses
- [CLI Trailhead Guide](./trailheads/cli.md) -- Flag derivation, output modes, gates
- [MCP Trailhead Guide](./trailheads/mcp.md) -- Annotations, progress, tool naming
