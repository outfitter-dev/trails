# @ontrails/http

Framework-agnostic HTTP route derivation for Trails. Pair this package with `@ontrails/hono` when you want the Hono surface connector.

## Usage

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { surface } from '@ontrails/hono';
import { z } from 'zod';

const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  output: z.object({ message: z.string() }),
  intent: 'read',
  blaze: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
});

const graph = topo('myapp', { greet });
await surface(graph, { port: 3000 });
```

This starts a Hono-based HTTP server. The `greet` trail becomes `GET /greet?name=...` because its `intent` is `'read'`.

For more control, build the routes yourself:

```typescript
import { deriveHttpRoutes } from '@ontrails/http';

const result = deriveHttpRoutes(graph);
if (result.isErr()) throw result.error; // ValidationError on route collision
for (const route of result.value) {
  console.log(`${route.method} ${route.path} → ${route.trailId}`);
}
```

`deriveHttpRoutes` returns `Result<HttpRouteDefinition[], Error>` rather than a bare array. It returns `Result.err(ValidationError)` if two trails derive the same `(method, path)` pair.

## API

| Export | What it does |
| --- | --- |
| `deriveHttpRoutes(graph, options?)` | Build framework-agnostic route definitions from a topo |

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

`deriveHttpRoutes` detects when two trails would produce the same `(method, path)` pair and returns `Result.err(ValidationError)` describing both trail IDs. The `surface()` helper from `@ontrails/hono` throws on collision.

## Resource resolution

Declared resources on each trail are resolved into the context before the implementation runs.

## Filtering

```typescript
const result = deriveHttpRoutes(graph, {
  include: ['entity.**'],
  exclude: ['dev.**'],
});
```

`*` matches one dotted segment and `**` matches any depth. Trails declared
with `visibility: 'internal'` stay hidden unless you include their exact trail
ID intentionally.

## AbortSignal propagation

The `execute` function on each `HttpRouteDefinition` accepts an optional `abortSignal`. The Hono connector extracts `signal` from `c.req.raw` and forwards it as `abortSignal`, so client disconnects propagate into trail execution.

## `HttpRouteDefinition`

Each route definition produced by `deriveHttpRoutes` includes:

| Field | Type | What it is |
| --- | --- | --- |
| `method` | `'GET' \| 'POST' \| 'DELETE'` | HTTP method |
| `path` | `string` | Derived path (e.g. `/entity/show`) |
| `trailId` | `string` | The trail ID this route was derived from |
| `inputSource` | `'query' \| 'body'` | Where to read input |
| `trail` | `Trail` | The original trail definition |
| `execute` | `(input, requestId?, abortSignal?) => Promise<Result>` | Validates, layers, and runs the implementation |

## Installation

```bash
bun add @ontrails/http @ontrails/hono
```

## Migration

Hono integration now lives in `@ontrails/hono`.

- Replace `import { trailhead } from '@ontrails/http/hono'` with `import { surface } from '@ontrails/hono'`
- Keep `deriveHttpRoutes()` and the route model imports on `@ontrails/http`
