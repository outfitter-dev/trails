# @ontrails/mcp

MCP surface connector. One `surface()` call turns a topo into an MCP server with tool definitions, annotations, and progress bridging -- all derived from the trail contracts.

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

## Tool naming

Trail IDs become MCP tool names with the app prefix: `entity.show` in app `myapp` becomes `myapp_entity_show`. Dots and hyphens become underscores, everything lowercase.

## Resource resolution

Declared resources on each trail are resolved into the context before the implementation runs.

## Progress bridge

Implementations report progress through `ctx.progress`. On MCP, these bridge to `notifications/progress` when the client sends a `progressToken`:

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

`*` matches one dotted segment and `**` matches any depth. Trails declared with
`visibility: 'internal'` stay hidden unless you include their exact trail ID.

## Installation

```bash
bun add @ontrails/mcp
```
