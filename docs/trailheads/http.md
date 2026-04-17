# HTTP Trailhead

The HTTP trailhead connector turns every trail into an endpoint. Routes are derived from trail IDs, HTTP verbs from intent, input parsing from the method, and error responses from the error taxonomy. One `surface()` call starts a Hono server.

The package separates framework-agnostic route building (`@ontrails/http`) from the Hono connector (`@ontrails/hono`).

## Setup

```bash
bun add @ontrails/http @ontrails/hono
```

```typescript
import { surface } from '@ontrails/hono';
import { graph } from './app';

await surface(graph, { port: 3000 });
```

That starts an HTTP server with every trail registered as a route.

## How Trail IDs Map to Routes

Dots in trail IDs become path segments:

| Trail ID       | Route path        |
| -------------- | ----------------- |
| `greet`        | `/greet`          |
| `entity.show`  | `/entity/show`    |
| `entity.add`   | `/entity/add`     |
| `math.add`     | `/math/add`       |

A `basePath` option prepends a prefix to all routes:

```typescript
await surface(graph, { basePath: '/api/v1', port: 3000 });
// entity.show -> /api/v1/entity/show
```

## Intent to HTTP Verb Mapping

The trail's `intent` determines which HTTP method the route uses:

| Intent      | HTTP Method | Rationale                          |
| ----------- | ----------- | ---------------------------------- |
| `read`      | GET         | Safe, no side effects              |
| `destroy`   | DELETE      | Irreversible removal               |
| *(default)* | POST        | Mutations, creates, general writes |

If no intent is declared, the trail defaults to POST.

## Input Handling

Input parsing depends on the HTTP method:

- **GET** -- Query parameters are parsed into an object. Simple type coercion applies: numeric strings become numbers, `"true"`/`"false"` become booleans.
- **POST / DELETE** -- The JSON request body is parsed via `req.json()`.

In both cases, the parsed input is validated against the trail's Zod schema before the implementation runs.

## Response Format

### Success

```json
{
  "data": { "name": "Alpha", "type": "concept", "tags": ["core"] }
}
```

HTTP 200 for all successful responses.

### Error

```json
{
  "error": {
    "message": "Entity not found: Omega",
    "code": "NotFoundError",
    "category": "not_found"
  }
}
```

The `code` is the error class name. The `category` matches the error taxonomy.

## Status Code Mapping

Status codes come directly from the error taxonomy -- the same mapping used across all trailheads:

| Category     | HTTP Status | Classes                              |
| ------------ | ----------- | ------------------------------------ |
| `validation` | 400         | `ValidationError`, `AmbiguousError`  |
| `not_found`  | 404         | `NotFoundError`                      |
| `conflict`   | 409         | `AlreadyExistsError`, `ConflictError`|
| `permission` | 403         | `PermissionError`                    |
| `timeout`    | 504         | `TimeoutError`                       |
| `rate_limit` | 429         | `RateLimitError`                     |
| `network`    | 502         | `NetworkError`                       |
| `internal`   | 500         | `InternalError`, `AssertionError`    |
| `auth`       | 401         | `AuthError`                          |
| `cancelled`  | 499         | `CancelledError`                     |

Unrecognized errors (non-`TrailsError` exceptions) return 500 with `category: 'internal'`.

## Layers as Layers

Layers compose the same way as on CLI and MCP -- they wrap trail implementations:

```typescript
import { surface } from '@ontrails/hono';
import { authLayer, loggingLayer } from './layers';

await surface(graph, {
  layers: [loggingLayer, authLayer],
  port: 3000,
});
```

Layers run in order, wrapping the implementation. They have access to the trail and its context, so they can inspect intent, metadata, and markers.

## TrailheadHttpOptions

| Option          | Type                                   | Default       | Description                                          |
| --------------- | -------------------------------------- | ------------- | ---------------------------------------------------- |
| `basePath`      | `string`                               | `''`          | Prefix for all route paths                           |
| `createContext`  | `() => TrailContext \| Promise<TrailContext>` | default context | Factory for per-request TrailContext           |
| `hostname`      | `string`                               | `'0.0.0.0'`  | Bind address                                         |
| `layers`         | `readonly Layer[]`                      | `[]`          | Layers to compose around implementations              |
| `name`          | `string`                               | *none*        | Server name for logging                              |
| `port`          | `number`                               | `3000`        | Listen port                                          |
| `serve`         | `boolean`                              | `true`        | Set `false` to return the Hono app without starting  |

## Request ID Bridging

The handler reads `X-Request-ID` from inbound requests and passes it through to the `TrailContext`. If no header is present, the context's default ID is used.

## Escape Hatch

For custom setups, use `deriveHttpRoutes()` from the base package to get framework-agnostic route definitions. Each route has an `execute` function that validates input, composes Layers, and runs the trail -- you wire it into whatever HTTP framework you use:

```typescript
import { deriveHttpRoutes } from '@ontrails/http';
import { Hono } from 'hono';

const hono = new Hono();
const routesResult = deriveHttpRoutes(graph, { basePath: '/api' });

if (routesResult.isErr()) {
  throw routesResult.error; // ValidationError if route collisions are detected
}

for (const route of routesResult.value) {
  const method = route.method.toLowerCase() as 'get' | 'post' | 'delete';
  hono[method](route.path, async (c) => {
    const input =
      route.inputSource === 'query'
        ? Object.fromEntries(new URL(c.req.url).searchParams)
        : await c.req.json();
    const result = await route.execute(input);
    return result.isOk()
      ? c.json({ data: result.value }, 200)
      : c.json({ error: { message: result.error?.message } }, 500);
  });
}

export default hono;
```

This gives you full control over the HTTP framework while still deriving routes from the topo.

`deriveHttpRoutes()` returns `Result<HttpRouteDefinition[], Error>`. If two trails resolve to the same method + path (e.g. two trails both map to `POST /entity/add`), it returns a `ValidationError` describing the collision instead of silently overwriting a route.

## AbortSignal Propagation

The HTTP request's abort signal is forwarded to `TrailContext.abortSignal`. If the client disconnects or cancels the request mid-flight, the implementation's signal is aborted.

```typescript
const longTask = trail('report.generate', {
  blaze: async (input, ctx) => {
    for (const chunk of data) {
      if (ctx.abortSignal?.aborted) {
        return Result.err(new CancelledError('Request cancelled'));
      }
      await processChunk(chunk);
    }
    return Result.ok({ report: '...' });
  },
});
```

## Example: Full HTTP Entry Point

```typescript
import { createTrailContext } from '@ontrails/core';
import { surface } from '@ontrails/hono';
import { graph } from './app';
import { createStore } from './store';

const store = createStore([
  { name: 'Alpha', tags: ['core'], type: 'concept' },
]);

await surface(graph, {
  createContext: () => createTrailContext({ store }),
  port: 3000,
});
```

```bash
curl http://localhost:3000/entity/show?name=Alpha
# {"data":{"name":"Alpha","type":"concept","tags":["core"]}}

curl -X POST http://localhost:3000/entity/add \
  -H 'Content-Type: application/json' \
  -d '{"name":"Delta","type":"tool"}'
# {"data":{"name":"Delta","type":"tool","tags":[]}}
```
