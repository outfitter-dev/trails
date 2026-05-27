# Getting Started with Trails

## Installation

```bash
# Requires Bun (https://bun.sh)

# Scaffold a new project
bunx @ontrails/trails create

# Or install manually
bun add @ontrails/core@beta @ontrails/cli@beta @ontrails/commander@beta zod
bun add @ontrails/mcp@beta @modelcontextprotocol/sdk # MCP surface (optional)
bun add @ontrails/http@beta @ontrails/hono@beta # Hono HTTP surface (optional)
# or, for Bun-native HTTP without Hono:
bun add @ontrails/http@beta
bun add -d @ontrails/testing@beta # Testing (dev)
```

During the active beta line, use `@beta` for the newest published beta or exact `1.0.0-beta.N` pins for reproducible handoffs. Do not rely on unqualified `latest` unless release notes explicitly say it has been advanced.

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
  blaze: (input) => {
    const message = `Hello, ${input.name}!`;
    return Result.ok({
      message: input.loud ? message.toUpperCase() : message,
    });
  },
});
```

This gives you a blazed trail plus CLI flags (`--name`, `--loud`), an MCP tool with JSON Schema and `readOnlyHint: true`, examples as test cases, and sync authoring normalized to async at runtime.

## Collect Into a Topo

Create `src/app.ts`:

```typescript
import { topo } from '@ontrails/core';
import * as greetModule from './trails/greet';

export const graph = topo('myapp', greetModule);
```

`topo()` scans module exports for Trails primitives and builds the queryable graph.

## Open a CLI Surface

Create `src/cli.ts`:

```typescript
import { surface } from '@ontrails/commander';
import { graph } from './app';

await surface(graph);
```

Run it:

```bash
$ bun src/cli.ts greet --name World
{ "message": "Hello, World!" }

$ bun src/cli.ts greet --name World --loud
{ "message": "HELLO, WORLD!" }
```

Flags, types, defaults, and `--help` text are all derived from the Zod schema.

## Open an MCP Surface

Create `src/mcp.ts`:

```typescript
import { surface } from '@ontrails/mcp';
import { graph } from './app';

await surface(graph);
```

Same blazed trail, different surface. The MCP server exposes `myapp_greet` with JSON Schema input, `readOnlyHint: true`, and examples for agent planning.

## Open an HTTP Surface

Use Hono when you want framework portability:

```typescript
import { surface } from '@ontrails/hono';
import { graph } from './app';

await surface(graph, { port: 3000 });
```

Use Bun-native HTTP when you want Bun's `Bun.serve({ routes })` path without a third-party runtime:

```typescript
import { surface } from '@ontrails/http/bun';
import { graph } from './app';

await surface(graph, { port: 3000 });
```

The same `greet` trail becomes `GET /greet?name=World` because `intent: 'read'` maps to HTTP GET. See [http-surface.md](http-surface.md) for route derivation, OpenAPI, Hono, and Bun-native details.

## Test with testAll

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

`testAll(graph)` runs: topo validation, example execution (input/output assertions), contract checks (output matches schema), and detour verification. Use `testExamples(graph)` for example assertions only.

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
  blaze: (input) => Result.ok({ result: input.a + input.b }),
});
```

Update `src/app.ts`:

```typescript
import { topo } from '@ontrails/core';
import * as greetModule from './trails/greet';
import * as mathModule from './trails/math';

export const graph = topo('myapp', greetModule, mathModule);
```

Dotted trail ID `math.add` becomes:

- CLI subcommand: `myapp math add --a 2 --b 3`
- MCP tool: `myapp_math_add`

No additional configuration needed.

## Composing Trails

A trail can compose other trails to accomplish a higher-level task:

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';
import { add } from './math.js';

export const addAndDouble = trail('math.add-and-double', {
  composes: [add],
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.object({ result: z.number() }),
  blaze: async (input, ctx) => {
    const sum = await ctx.compose(add, input);
    if (sum.isErr()) return sum;
    return Result.ok({ result: sum.value.result * 2 });
  },
});
```

Rules for composition:

- Declare dependencies with `composes`
- Call them with `ctx.compose()` — prefer trail objects where in scope, use string IDs as an escape hatch, and never call `.run()` directly
- Propagate errors: `if (result.isErr()) return result;`
- The warden verifies `composes` matches actual `ctx.compose()` calls

## Using Resources

When trails need infrastructure — databases, API clients, caches — declare them as resources.

Define a resource in `src/resources/db.ts`:

```typescript
import { resource, Result } from '@ontrails/core';

export const db = resource('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  dispose: (conn) => conn.close(),
  mock: () => createInMemoryDb(),
});
```

Register resources in the topo alongside trails:

```typescript
import * as greetModule from './trails/greet';
import * as resources from './resources/db';

export const graph = topo('myapp', greetModule, resources);
```

Use in a trail by declaring `resources` and accessing via `db.from(ctx)`:

```typescript
const lookup = trail('lookup', {
  resources: [db],
  input: z.object({ id: z.string().describe('Record ID') }),
  output: z.object({ name: z.string() }),
  intent: 'read',
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    const record = await conn.findById(input.id);
    if (!record) return Result.err(new NotFoundError(`No record: ${input.id}`));
    return Result.ok({ name: record.name });
  },
});
```

The `mock` factory means `testAll(graph)` works with no additional configuration — the in-memory database is used automatically in tests.
