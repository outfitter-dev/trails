# @ontrails/http

HTTP surface adapter. One `blaze()` call turns a topo into a Hono-based HTTP server with routes, input validation, and error mapping -- all derived from the trail contracts.

## Usage

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { blaze } from '@ontrails/http/hono';
import { z } from 'zod';

const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  output: z.object({ message: z.string() }),
  intent: 'read',
  run: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
});

const app = topo('myapp', { greet });
await blaze(app, { port: 3000 });
```

This starts a Hono-based HTTP server. The `greet` trail becomes `GET /greet?name=...` because its `intent` is `'read'`.

For more control, build the routes yourself:

```typescript
import { buildHttpRoutes } from '@ontrails/http';

const result = buildHttpRoutes(app);
if (result.isErr()) throw result.error; // ValidationError on route collision
for (const route of result.value) {
  console.log(`${route.method} ${route.path} → ${route.trailId}`);
}
```

`buildHttpRoutes` returns `Result<HttpRouteDefinition[], Error>` rather than a bare array. It returns `Result.err(ValidationError)` if two trails derive the same `(method, path)` pair.

## API

| Export | What it does |
| --- | --- |
| `buildHttpRoutes(app, options?)` | Build framework-agnostic route definitions from a topo |
| `blaze(app, options?)` (`@ontrails/http/hono`) | Start a Hono HTTP server with all trails as routes |

## Route derivation

Trail intent maps directly to HTTP method and input source:

| Trail field | HTTP method | Input source |
| --- | --- | --- |
| `intent: 'read'` | `GET` | Query string |
| `intent: 'write'` | `POST` | JSON body |
| `intent: 'destroy'` | `DELETE` | JSON body |
| (none) | `POST` | JSON body |

Trail IDs map to paths: `entity.show` becomes `/entity/show`. Dots become slashes, everything lowercase.

## Collision detection

`buildHttpRoutes` detects when two trails would produce the same `(method, path)` pair and returns `Result.err(ValidationError)` describing both trail IDs. The `blaze()` Hono adapter throws on collision.

## AbortSignal propagation

The `execute` function on each `HttpRouteDefinition` accepts an optional `AbortSignal`. The Hono adapter extracts `signal` from `c.req.raw` and passes it to `execute`, so client disconnects propagate into trail execution.

## `HttpRouteDefinition`

Each route definition produced by `buildHttpRoutes` includes:

| Field | Type | What it is |
| --- | --- | --- |
| `method` | `'GET' \| 'POST' \| 'DELETE'` | HTTP method |
| `path` | `string` | Derived path (e.g. `/entity/show`) |
| `trailId` | `string` | The trail ID this route was derived from |
| `inputSource` | `'query' \| 'body'` | Where to read input |
| `trail` | `Trail` | The original trail definition |
| `execute` | `(input, requestId?, signal?) => Promise<Result>` | Validates, layers, and runs the implementation |

## Installation

```bash
bun add @ontrails/http hono
```
