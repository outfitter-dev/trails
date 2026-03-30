# Getting Started with Trails

## Installation

```bash
# Requires Bun (https://bun.sh)

# Scaffold a new project
bunx @ontrails/trails create

# Or install manually
bun add @ontrails/core @ontrails/cli
bun add commander                    # Commander adapter
bun add @ontrails/mcp                # MCP surface (optional)
bun add -d @ontrails/testing         # Testing (dev)
```

## Define Your First Trail

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
  run: (input) => {
    const message = `Hello, ${input.name}!`;
    return Result.ok({
      message: input.loud ? message.toUpperCase() : message,
    });
  },
});
```

This gives you CLI flags (`--name`, `--loud`), an MCP tool with JSON Schema and `readOnlyHint: true`, examples as test cases, and sync authoring normalized to async at runtime.

## Collect Into a Topo

Create `src/app.ts`:

```typescript
import { topo } from '@ontrails/core';
import * as greetModule from './trails/greet';

export const app = topo('myapp', greetModule);
```

`topo()` scans module exports for `Trail` shapes and builds the collection.

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
```

Flags, types, defaults, and `--help` text are all derived from the Zod schema.

## Blaze on MCP

Create `src/mcp.ts`:

```typescript
import { blaze } from '@ontrails/mcp';
import { app } from './app';

await blaze(app);
```

Same trail, same implementation, different surface. The MCP server exposes `myapp_greet` with JSON Schema input, `readOnlyHint: true`, and examples for agent planning.

## Test with testAll

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

`testAll(app)` runs: topo validation, example execution (input/output assertions), contract checks (output matches schema), and detour verification. Use `testExamples(app)` for example assertions only.

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
    { name: 'Add two numbers', input: { a: 2, b: 3 }, expected: { result: 5 } },
  ],
  run: (input) => Result.ok({ result: input.a + input.b }),
});
```

Update `src/app.ts`:

```typescript
import { topo } from '@ontrails/core';
import * as greetModule from './trails/greet';
import * as mathModule from './trails/math';

export const app = topo('myapp', greetModule, mathModule);
```

Dotted trail ID `math.add` becomes:

- CLI subcommand: `myapp math add --a 2 --b 3`
- MCP tool: `myapp_math_add`

No additional configuration needed.

## Composing Trails

A trail can follow other trails to accomplish a higher-level task:

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

export const addAndDouble = trail('math.add-and-double', {
  follow: ['math.add'],
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.object({ result: z.number() }),
  run: async (input, ctx) => {
    const sum = await ctx.follow('math.add', input);
    if (sum.isErr()) return sum;
    return Result.ok({ result: sum.value.result * 2 });
  },
});
```

Rules for composition:

- Declare dependencies with `follow`
- Call them with `ctx.follow()` — never call `.run()` directly
- Propagate errors: `if (result.isErr()) return result;`
- The warden verifies `follow` matches actual `ctx.follow()` calls

## Using Services

When trails need infrastructure — databases, API clients, caches — declare them as services.

Define a service in `src/services/db.ts`:

```typescript
import { service, Result } from '@ontrails/core';

export const db = service('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  dispose: (conn) => conn.close(),
  mock: () => createInMemoryDb(),
});
```

Register services in the topo alongside trails:

```typescript
import * as greetModule from './trails/greet';
import * as services from './services/db';

export const app = topo('myapp', greetModule, services);
```

Use in a trail by declaring `services` and accessing via `db.from(ctx)`:

```typescript
const lookup = trail('lookup', {
  services: [db],
  input: z.object({ id: z.string().describe('Record ID') }),
  output: z.object({ name: z.string() }),
  intent: 'read',
  run: async (input, ctx) => {
    const conn = db.from(ctx);
    const record = await conn.findById(input.id);
    if (!record) return Result.err(new NotFoundError(`No record: ${input.id}`));
    return Result.ok({ name: record.name });
  },
});
```

The `mock` factory means `testAll(app)` works with no additional configuration — the in-memory database is used automatically in tests.
