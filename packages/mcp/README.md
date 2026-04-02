# @ontrails/mcp

MCP surface adapter. One `trailhead()` call turns a topo into an MCP server with tool definitions, annotations, and progress bridging -- all derived from the trail contracts.

## Usage

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { trailhead } from '@ontrails/mcp';
import { z } from 'zod';

const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  intent: 'read',
  blaze: (input) => Result.ok(`Hello, ${input.name}!`),
});

const app = topo('myapp', { greet });
await trailhead(app);
```

This starts an MCP server over stdio with a `myapp_greet` tool. The tool gets `readOnlyHint: true` and a JSON Schema input -- both derived from the trail definition.

For more control, build the tools yourself:

```typescript
import { buildMcpTools } from '@ontrails/mcp';

const result = buildMcpTools(app);
if (result.isErr()) throw result.error; // ValidationError on tool-name collision
for (const tool of result.value) {
  server.registerTool(tool.name, tool.handler, {
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  });
}
```

`buildMcpTools` returns `Result<McpToolDefinition[], Error>` rather than a bare array. It returns `Result.err(ValidationError)` if two trails derive the same MCP tool name. Each `McpToolDefinition` includes a `trailId` field that records which trail the tool was derived from.

## API

| Export | What it does |
| --- | --- |
| `trailhead(app, options?)` | Start an MCP server with all trails as tools |
| `buildMcpTools(app, options?)` | Build tool definitions without starting a server |
| `deriveToolName(appName, trailId)` | Compute the MCP tool name from app and trail IDs |
| `deriveAnnotations(trail)` | Extract MCP annotations from trail intent and metadata |
| `createMcpProgressCallback(server)` | Bridge `ctx.progress` to MCP `notifications/progress` |

See the [API Reference](../../docs/api-reference.md) for the full list.

## Annotations

Trail intent and metadata map directly to MCP annotations:

| Trail field | MCP annotation |
| --- | --- |
| `intent: 'read'` | `readOnlyHint: true` |
| `intent: 'destroy'` | `destructiveHint: true` |
| `idempotent: true` | `idempotentHint: true` |
| `description` | `title` |

No manual annotation definitions. The contract is the source of truth.

## Tool naming

Trail IDs become MCP tool names with the app prefix: `entity.show` in app `myapp` becomes `myapp_entity_show`. Dots and hyphens become underscores, everything lowercase.

## Service resolution

Declared services on each trail are resolved into the context before the implementation runs.

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
await trailhead(app, { includeTrails: ['entity.show', 'search'] });
await trailhead(app, { excludeTrails: ['internal.debug'] });
```

## Installation

```bash
bun add @ontrails/mcp
```
