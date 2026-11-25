# @ontrails/mcp

MCP surface adapter. One `surface()` call turns a topo into an MCP server with tool definitions, annotations, and progress bridging -- all derived from the trail contracts.

## Usage

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { surface } from '@ontrails/mcp';
import { z } from 'zod';

const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  output: z.object({ greeting: z.string() }),
  intent: 'read',
  examples: [
    {
      expected: { greeting: 'Hello, Ada!' },
      input: { name: 'Ada' },
      name: 'Ada',
    },
  ],
  implementation: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
});

const graph = topo('myapp', { greet });
await surface(graph);
```

This starts an MCP server over stdio with a `myapp_greet` tool. The tool gets `readOnlyHint: true`, JSON Schema input, JSON Schema output, and structured examples -- all derived from the trail definition.

For more control, build the tools yourself:

```typescript
import { deriveMcpTools } from '@ontrails/mcp';

const result = deriveMcpTools(graph);
if (result.isErr()) throw result.error; // ValidationError on tool-name collision
for (const tool of result.value) {
  server.registerTool(tool.name, tool.handler, {
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    _meta: tool._meta,
  });
}
```

`deriveMcpTools` returns `Result<McpToolDefinition[], Error>` rather than a bare array. It returns `Result.err(ValidationError)` if two trails derive the same MCP tool name. Each `McpToolDefinition` includes a `trailId` field that records which trail the tool was derived from.

## Portable HTTP Entry

Import `createFetchHandler` from `@ontrails/mcp/fetch` to obtain `{ fetch, close }` for Bun or Hono. The subpath avoids stdio imports and serves modern MCP plus legacy stateless HTTP. Hostnames default to loopback only; browser origins require an explicit exact HTTP(S) allowlist. Actual request Authorization and application metadata reach the existing permit resolver. See [MCP Over HTTP](../../docs/surfaces/mcp-http.md) for the Bun and Hono attachments, validation rules and the separate HTTP challenge and live-client follow-ups.

## API

| Export | What it does |
| --- | --- |
| `surface(graph, options?)` | Start an MCP server with all trails as tools |
| `deriveMcpTools(graph, options?)` | Build tool definitions without starting a server |
| `buildMcpResources(graph, tools, config?)` | Build MCP resource listings and read handlers for cold context |
| `deriveToolName(appName, trailId)` | Compute the MCP tool name from app and trail IDs |
| `deriveAnnotations(trail)` | Extract MCP annotations from trail intent, idempotency, and description |
| `createMcpProgressCallback(server)` | Bridge `ctx.progress` to MCP `notifications/progress` |

See the [API Reference](../../docs/api-reference.md) for the full list.

## Request credential resolution

A configured `resolvePermit` receives each request's raw `authorization`, best-effort `bearerToken` and untrusted application `_meta`. It owns the accepted credential source and syntax. An opaque key in Authorization can therefore reach that policy without first passing Bearer parsing. Metadata fields and tool arguments are never promoted into header credentials. HTTP header candidates require a real hosting adapter; the core does not synthesize them from `_meta`.

Return `Result.ok(null)` or `undefined` only when no accepted credential was selected. A selected malformed or invalid credential, lookup miss or operational failure must return an error; it stops even a public tool before host-context fallback or execution. Choose precedence before verification and never fall back to another candidate after selected failure. A Bearer-only policy must reject malformed presented Bearer credentials itself.

Two credential postures exist (`credentialPosture` on the derive and server options). On the `host` posture, which stdio uses, explicit host-provided `extra.permit` keeps its precedence and, when the configured resolver returns absence, trusted `createContext` permit configuration remains available as the launcher's own policy; a resolver error cannot use that fallback. On the `network` posture, which `@ontrails/mcp/fetch` always sets, identity enters only through `resolvePermit`: a `createContext` permit is discarded at runtime (one diagnostic names the migration), `extra.permit` is ignored, a presented bearer with no resolver is an `AuthError` rather than absence, and a surface that exposes protected trails without a resolver is refused at build time with a `ValidationError` listing the trails. Resolver absence means anonymous: public trails run, protected trails fail at enforcement.

Migration for apps that seeded a permit through `createContext` on a network host: move the credential into a verifier passed as `resolvePermit` (a JWKS or opaque adapter from `@ontrails/permits`), and keep `createContext` for the logger, extensions and resources it still seeds. `--dev-permit` is not a migration path for network surfaces.

Tool invocation and resource list/read requests share one internal request permit-resolution seam. Resource requests resolve once, then evaluate optional `authorizeResourceRead({ permit, resource })` policy against canonical catalog descriptors. Return `Result.ok()` to allow a URI or a `PermissionError` to deny it. Listing omits permission-denied URIs; direct reads reject them, and other errors fail the request. The descriptor carries a real `trailId` for trail-specific resources and none for aggregates. Without explicit read policy, the authored static resource population remains public.

Resolvers now receive resource requests even without bearer credentials. Every read rechecks; prior lists and other callers grant no authority. On the host posture, trusted `createContext` permits are available only after request-credential absence, never after verification failure; the network posture never consults them. Resource policy does not alter static tool discovery or redact the surface-map aggregate; deny unsafe aggregates when private member-level discovery is required. See [resource read policy](../../docs/surfaces/mcp.md#resource-read-policy) for configuration and migration guidance. This change does not establish Fetch hosting, query credentials, application-cookie policy or header extraction for a future host.

## Annotations

Trail intent, idempotency, and description map directly to MCP annotations:

| Trail field | MCP annotation |
| --- | --- |
| `intent: 'read'` | `readOnlyHint: true` |
| `intent: 'destroy'` | `destructiveHint: true` |
| `idempotent: true` | `idempotentHint: true` |
| `description` | `title` |

No manual annotation definitions. The contract is the source of truth.

## Schemas and Examples

MCP tool definitions include the trail's input schema, and trails with an `output` schema also render that schema into MCP `outputSchema`. Non-object trail outputs are wrapped in a `{ data: ... }` object because MCP structured tool results are object-shaped.

Trail examples are rendered as structured metadata under `_meta["ontrails/examples"]`. Each rendered example preserves its input, expected output or error, a success/error kind, and provenance pointing back to the authored `trail.examples` field.

## MCP resources and deferred loading

Cold context is rendered through MCP resources, not extra Trails resources. `surface(graph)` and `createServer(graph)` expose MCP resources by default:

- `trails://surface-map` lists the resolved MCP tool rendering, including ordinary tools, trailhead tools, schemas, versions, deferred hints, and member trail IDs.
- `trails://examples/<trailId>` exposes structured examples for exposed trails that define examples.
- `trails://trail/<trailId>` exposes MCP-visible graph facts for an exposed trail when graph resources are enabled.

Disable resource rendering only when the host needs a minimal MCP capability surface:

```typescript
await surface(graph, { mcpResources: false });
```

Or choose a narrower resource set:

```typescript
await surface(graph, {
  mcpResources: { examples: false, graph: true, surfaceMap: true },
});
```

Graph resources are opt-in for general MCP hosts because they widen cold context for every exposed trail. The Trails operator enables them so agents can inspect high-signal graph facts without invoking another tool.

Trailhead definitions may set `mcp: { loading: 'deferred' }`. In this release, deferred loading is a compatibility hint under `_meta["ontrails/deferred"]`; the MCP tool schema remains present so clients that do not understand deferred loading continue to work.

## Tool naming

Trail IDs become MCP tool names with the app prefix: `entity.show` in app `myapp` becomes `myapp_entity_show`. Dots and hyphens become underscores, everything lowercase.

## Resource resolution

Declared resources on each trail are resolved into the context before the implementation receives input.

## Progress bridge

Implementations report progress through `ctx.progress`. On MCP, these bridge to `notifications/progress` when the client sends a `progressToken`:

```typescript
const importTrail = trail('data.import', {
  implementation: async (input, ctx) => {
    for (let i = 0; i < items.length; i++) {
      await processItem(items[i]);
      ctx.progress?.({ type: 'progress', current: i + 1, total: items.length });
    }
    return Result.ok({ imported: items.length });
  },
});
```

## Filtering

```typescript
await surface(graph, { include: ['entity.**', 'search'] });
await surface(graph, { exclude: ['internal.debug'] });
```

`*` matches one dotted segment and `**` matches any depth. Trails declared with `visibility: 'internal'` stay hidden unless you include their exact trail ID.

## Installation

The source targets the SDK v2 migration release, with `@modelcontextprotocol/server` 2.x (minimum 2.4.0) as its peer. Source support does not establish publication; use the Trails release containing this migration and its matching peer requirements.

```bash
bun add @ontrails/mcp '@modelcontextprotocol/server@^2.4.0'
```

See [SDK v2 Migration](../../docs/surfaces/mcp.md#sdk-v2-migration) for the stdio factory API and embedded binary content changes.
