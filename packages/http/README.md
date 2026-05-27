# @ontrails/http

Framework-agnostic HTTP route derivation and Web Fetch request handling for Trails. Pair this package with `@ontrails/hono` when you want Hono portability, or use `@ontrails/http/bun` when you want Bun-native serving without a third-party framework.

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

For Bun-native HTTP without Hono, use the Bun runtime materializer subpath:

```typescript
import { surface } from '@ontrails/http/bun';

await surface(graph, { port: 3000 });
```

`@ontrails/http/bun` uses Bun's native `Bun.serve({ routes })` fast path and keeps the shared Web Fetch handler as the fallback. It requires Bun `>=1.2.3` and does not add a third-party runtime dependency.

## Projection and materialization

The HTTP package follows the surface API naming split:

- `derive*` exports are pure projections from the topo. Use `deriveHttpRoutes()` for route definitions and `deriveOpenApiSpec()` for the OpenAPI contract.
- `create*` exports materialize runtime objects without opening a network boundary. `@ontrails/http/fetch` exports `createRouteHandler()` for one route and `createFetchHandler()` for a full topo dispatcher.
- `surface()` opens the runtime boundary. `@ontrails/hono` opens a Hono server; `@ontrails/http/bun` opens Bun's native HTTP server.

The shared `@ontrails/http/fetch` kernel owns query/body parsing, content-length validation, public error projection, diagnostics, request IDs, headers, abort propagation, and webhook verification/parsing behavior. Hono and Bun both consume that kernel so route semantics stay aligned.

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

OpenAPI is the HTTP surface's persisted client contract projection:

```typescript
import { deriveOpenApiSpec } from '@ontrails/http';

const spec = deriveOpenApiSpec(graph, { basePath: '/api' });
```

`deriveOpenApiSpec()` emits an OpenAPI 3.1 document from the same trail contracts used by `deriveHttpRoutes()`.

## API

| Export | What it does |
| --- | --- |
| `deriveHttpRoutes(graph, options?)` | Build framework-agnostic route definitions from a topo |
| `deriveOpenApiSpec(graph, options?)` | Generate an OpenAPI 3.1 document for the HTTP surface |
| `@ontrails/http/fetch` | Shared Web Fetch `createRouteHandler()` and `createFetchHandler()` kernel |
| `@ontrails/http/bun` | Bun-native `createApp()` and `surface()` materializer |

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

Declared resources on each trail are resolved into the context before the blaze receives input.

## Filtering

```typescript
const result = deriveHttpRoutes(graph, {
  include: ['entity.**'],
  exclude: ['dev.**'],
});
```

`*` matches one dotted segment and `**` matches any depth. Trails declared with `visibility: 'internal'` stay hidden unless you include their exact trail ID intentionally.

## Request context and abort propagation

The `execute` function on each `HttpRouteDefinition` accepts optional `requestId`, `abortSignal`, and request context arguments. HTTP adapters should pass the request's `AbortSignal` so client disconnects propagate into trail execution, and pass headers in the request context when Bearer auth should resolve into `ctx.permit`.

## `HttpRouteDefinition`

Each route definition produced by `deriveHttpRoutes` includes:

| Field | Type | What it is |
| --- | --- | --- |
| `method` | `'GET' \| 'POST' \| 'DELETE'` | HTTP method |
| `path` | `string` | Derived path (e.g. `/entity/show`) |
| `trailId` | `string` | The trail ID this route was derived from |
| `inputSource` | `'query' \| 'body'` | Where to read input |
| `trail` | `Trail` | The original trail definition |
| `execute` | `(input, requestId?, abortSignal?, context?) => Promise<Result>` | Validates, layers, resolves request auth when configured, and runs the blazed trail |

For GET routes on the Hono surface, repeated query keys are passed through as arrays (`?tag=one&tag=two` -> `{ tag: ['one', 'two'] }`) while a single occurrence stays a scalar string. The adapter does not coerce singleton query values into arrays.

## Installation

```bash
bun add @ontrails/http@beta @ontrails/hono@beta
# or, for Bun-native serving:
bun add @ontrails/http@beta
```

## Migration

Hono integration now lives in `@ontrails/hono`.

<!-- warden-ignore-next-line -->
- Replace `import { trailhead } from '@ontrails/http/hono'` with `import { surface } from '@ontrails/hono'`
- Keep `deriveHttpRoutes()` and the route model imports on `@ontrails/http`
