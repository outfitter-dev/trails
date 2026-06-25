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
  blaze: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
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

MCP tool definitions include the trail's input schema, and trails with an `output` schema also project that schema into MCP `outputSchema`. Non-object trail outputs are wrapped in a `{ data: ... }` object because MCP structured tool results are object-shaped.

Trail examples are projected as structured metadata under `_meta["ontrails/examples"]`. Each projected example preserves its input, expected output or error, a success/error kind, and provenance pointing back to the authored `trail.examples` field.

## MCP resources and deferred loading

Cold context is projected through MCP resources, not extra Trails resources. `surface(graph)` and `createServer(graph)` expose MCP resources by default:

- `trails://surface-map` lists the resolved MCP tool projection, including ordinary tools, trailhead tools, schemas, versions, deferred hints, and member trail IDs.
- `trails://examples/<trailId>` exposes structured examples for exposed trails that define examples.
- `trails://trail/<trailId>` exposes MCP-visible graph facts for an exposed trail when graph resources are enabled.

Disable resource projection only when the host needs a minimal MCP capability surface:

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

Declared resources on each trail are resolved into the context before the blaze receives input.

## Progress bridge

Blazes report progress through `ctx.progress`. On MCP, these bridge to `notifications/progress` when the client sends a `progressToken`:

```typescript
const importTrail = trail('data.import', {
  blaze: async (input, ctx) => {
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

```bash
bun add @ontrails/mcp@beta
```
