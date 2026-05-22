# HTTP Surface Reference

Trails HTTP support has a shared core plus runtime materializers:

- `@ontrails/http` owns route derivation, OpenAPI projection, and the shared Web Fetch request kernel.
- `@ontrails/hono` opens the derived routes through Hono.
- `@ontrails/http/bun` opens the same derived routes through Bun-native serving.
- `@ontrails/http/fetch` exposes in-process Web Fetch handlers for adapters and tests.

## Install

```bash
bun add @ontrails/http @ontrails/hono
# or, for Bun-native serving:
bun add @ontrails/http
```

## Open With Hono

```typescript
import { surface } from '@ontrails/hono';
import { graph } from './app.js';

await surface(graph, { port: 3000 });
```

## Open With Bun-Native HTTP

```typescript
import { surface } from '@ontrails/http/bun';
import { graph } from './app.js';

await surface(graph, { port: 3000 });
```

The Bun-native materializer uses Bun's native serving fast path and falls back to the shared Web Fetch handler where needed. It does not add a third-party runtime dependency.

## Route Derivation

HTTP routes are derived from trail contracts:

| Trail field | HTTP method | Input source |
| --- | --- | --- |
| `intent: 'read'` | `GET` | Query string |
| `intent: 'write'` or omitted | `POST` | JSON body |
| `intent: 'destroy'` | `DELETE` | JSON body |

Trail IDs become paths by replacing dots with slashes. `entity.show` becomes `/entity/show`.

## Pure Projections

Use pure projection APIs when you need to inspect or persist HTTP shape without opening a server:

```typescript
import { deriveHttpRoutes, deriveOpenApiSpec } from '@ontrails/http';

const routes = deriveHttpRoutes(graph);
if (routes.isErr()) return routes;

const spec = deriveOpenApiSpec(graph, { basePath: '/api' });
```

`deriveHttpRoutes()` returns `Result.err(ValidationError)` when two trails derive the same `(method, path)` pair. `deriveOpenApiSpec()` emits OpenAPI 3.1 from the same input/output schemas used by CLI, MCP, and tests.

## Fetch Kernel

Adapters consume the shared fetch kernel so Hono and Bun keep the same semantics:

```typescript
import { createFetchHandler, createRouteHandler } from '@ontrails/http/fetch';
import { deriveHttpRoutes } from '@ontrails/http';

const fetchHandler = createFetchHandler(graph);
const fetchResponse = await fetchHandler(
  new Request('https://example.com/entity/show?name=Alpha')
);
if (fetchResponse.status !== 200) throw new Error('unexpected HTTP response');

const routes = deriveHttpRoutes(graph);
if (routes.isErr()) return routes;
const route = routes.value.find((candidate) => candidate.trailId === 'entity.show');
if (route === undefined) throw new Error('entity.show route not found');
const handler = createRouteHandler(route);
const routeResponse = await handler(
  new Request('https://example.com/entity/show?name=Alpha')
);
if (routeResponse.status !== 200) throw new Error('unexpected route response');
```

The kernel owns query/body parsing, public error projection, request IDs, abort propagation, content-length validation, and webhook parsing behavior.

## Testing

Use `createHttpHarness()` for in-process HTTP checks and `testSurfaceParity()` when you want CLI, MCP, and HTTP examples to agree:

```typescript
import { createHttpHarness, testSurfaceParity } from '@ontrails/testing';
import { graph } from './app.js';

const http = createHttpHarness({ graph });
const response = await http.get('/entity/show', { name: 'Alpha' });
expect(response.status).toBe(200);

testSurfaceParity(graph);
```
