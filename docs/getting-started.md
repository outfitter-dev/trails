# Getting Started

Install the core packages, define your first trail, blaze it on CLI and MCP, and test it with one line.

## Installation

```bash
# Requires Bun (https://bun.sh)

# Recommended: scaffold a new project
bunx trails init

# Or install manually
bun add @ontrails/core @ontrails/cli

# Add Commander adapter (for the /commander subpath)
bun add commander

# Add MCP surface (optional)
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
  readOnly: true,
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
- CLI flags derived from the Zod schema: `--name <value>`, `--loud`
- An MCP tool with JSON Schema input and annotations (`readOnlyHint: true`)
- Two examples that serve as agent documentation AND test cases
- Sync authoring for pure work, with the runtime normalized to one awaitable execution shape for layers and surfaces

## Collect Into a Topo

Create `src/app.ts`:

```typescript
import { topo } from '@ontrails/core';
import * as greetModule from './trails/greet';

export const app = topo('myapp', greetModule);
```

`topo()` scans the module exports for `Trail` shapes and builds the internal topo (the trail collection).

## Blaze on CLI

Create `src/cli.ts`:

```typescript
import { blaze } from '@ontrails/cli/commander';
import { app } from './app';

blaze(app);
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

## Blaze on MCP

Create `src/mcp.ts`:

```typescript
import { blaze } from '@ontrails/mcp';
import { app } from './app';

await blaze(app);
```

Same trail. Same implementation. Different surface. The MCP server exposes a `myapp_greet` tool with:

- JSON Schema input derived from the Zod schema
- `readOnlyHint: true` annotation from `readOnly: true`
- Examples available for agent planning

Pure trails can return `Result` directly. Hikes and I/O-heavy trails can stay `async`; Trails normalizes both forms before adapters run them.

## Test with `testExamples`

Create `src/__tests__/app.test.ts`:

```typescript
import { testExamples } from '@ontrails/testing';
import { app } from '../app';

testExamples(app);
```

Run it:

```bash
$ bun test
 PASS  src/__tests__/app.test.ts
  greet
    example: Basic greeting
    example: Loud greeting
```

That single `testExamples(app)` call:

1. Iterates every trail in the topo
2. For each example, validates the input against the trail's Zod schema
3. Runs the implementation with validated input
4. Asserts the result matches `expected` (or validates against the output schema when no `expected` is declared)

No separate test files for the happy path. The examples ARE the tests.

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
  readOnly: true,
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

export const app = topo('myapp', greetModule, mathModule);
```

The dotted trail ID `math.add` becomes a subcommand on CLI (`myapp math add --a 2 --b 3`) and a namespaced tool on MCP (`myapp_math_add`). No additional configuration needed.

## Composing with Hikes

A hike follows multiple trails to accomplish a higher-level task:

```typescript
import { hike, Result } from '@ontrails/core';
import { z } from 'zod';

export const addAndDouble = hike('math.add-and-double', {
  follows: ['math.add'],
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.object({ result: z.number() }),
  implementation: async (input, ctx) => {
    const sum = await ctx.follow('math.add', input);
    if (sum.isErr()) return sum;
    return Result.ok({ result: sum.value.result * 2 });
  },
});
```

Hikes declare their dependencies with `follows` and call them with `ctx.follow()`. The warden linter verifies these match.

## What's Next

- [Architecture](./architecture.md) -- How the hexagonal model works
- [Vocabulary](./vocabulary.md) -- All Trails terms defined
- [Testing Guide](./testing.md) -- TDD approach, contract testing, harnesses
- [CLI Surface Guide](./surfaces/cli.md) -- Flag derivation, output modes, layers
- [MCP Surface Guide](./surfaces/mcp.md) -- Annotations, progress, tool naming
