# MCP Surface

The MCP surface adapter turns every trail into an MCP tool. Annotations are auto-derived from trail intent and metadata. Progress callbacks bridge to MCP notifications. One `trailhead()` call starts a server.

## Setup

```bash
bun add @ontrails/mcp
```

```typescript
import { trailhead } from '@ontrails/mcp';
import { app } from './app';

await trailhead(app);
```

That starts an MCP server over stdio with every trail registered as a tool.

## How Trail IDs Map to Tool Names

Tool names are derived from the app name and trail ID:

| App name   | Trail ID       | Tool name               |
| ---------- | -------------- | ----------------------- |
| `myapp`    | `entity.show`  | `myapp_entity_show`     |
| `myapp`    | `search`       | `myapp_search`          |
| `dispatch` | `patch.search` | `dispatch_patch_search` |

Rules: dots become underscores, hyphens become underscores, everything lowercase. Tool names match the MCP convention of `[a-z0-9_]+`.

```typescript
import { deriveToolName } from '@ontrails/mcp';

deriveToolName('myapp', 'entity.show'); // "myapp_entity_show"
```

## Input Schema

The trail's Zod input schema is converted to JSON Schema via `zodToJsonSchema()` from `@ontrails/core`. This is what MCP clients see when listing tools.

```typescript
const show = trail('entity.show', {
  input: z.object({
    name: z.string().describe('Entity name to look up'),
  }),
  // ...
});
```

Produces the JSON Schema:

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Entity name to look up" }
  },
  "required": ["name"]
}
```

`.describe()` annotations on Zod fields become `description` in the JSON Schema -- these are what agents see.

## Annotations

Trail intent maps directly to MCP tool annotations:

| Trail field | MCP annotation | Effect |
| --- | --- | --- |
| `intent: 'read'` | `readOnlyHint: true` | Tells the agent this tool does not modify state |
| `intent: 'destroy'` | `destructiveHint: true` | Warns the agent about destructive side effects |
| `idempotent: true` | `idempotentHint: true` | Tells the agent repeated calls are safe |
| `description` | `title` | Human-readable tool title |

```typescript
import { deriveAnnotations } from '@ontrails/mcp';

const annotations = deriveAnnotations(showTrail);
// { readOnlyHint: true, title: "Show entity details" }
```

Trails without intent produce empty annotations (MCP SDK defaults apply).

## Result Mapping

Trail results are mapped to MCP tool responses:

**Success:**

```typescript
Result.ok({ name: 'Alpha', type: 'concept' });
// -> { content: [{ type: "text", text: '{"name":"Alpha","type":"concept"}' }] }
```

**Error:**

```typescript
Result.err(new NotFoundError('Entity not found'));
// -> { content: [{ type: "text", text: "Entity not found" }], isError: true }
```

**Binary data:**

If the result contains a `BlobRef` with an image MIME type, it becomes an image content entry:

```typescript
// -> { content: [{ type: "image", data: "<base64>", mimeType: "image/png" }] }
```

## Progress Bridging

Trail implementations can report progress via `ctx.progress`. On the MCP surface, these are bridged to MCP `notifications/progress`:

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

The MCP client receives progress notifications: `{ current: 1, total: 100 }`, `{ current: 2, total: 100 }`, etc.

Progress bridging activates only when the MCP client includes a `progressToken` in the tool call. Otherwise, `ctx.progress` calls are silently ignored.

## Filtering Trails

Not every trail should be exposed as an MCP tool. Use include/exclude filters:

```typescript
await trailhead(app, {
  includeTrails: ['entity.show', 'entity.add', 'search'],
});

// Or exclude specific trails
await trailhead(app, {
  excludeTrails: ['internal.debug', 'admin.reset'],
});
```

`includeTrails` takes precedence over `excludeTrails`.

## Server Configuration

```typescript
await trailhead(app, {
  serverInfo: {
    name: 'myapp',
    version: '1.0.0',
  },
  transport: 'stdio', // Only stdio for now; SSE/streamable HTTP planned
  layers: [myAuthLayer, myRateLimitLayer],
  createContext: () => createTrailContext({ logger: myLogger }),
});
```

## AbortSignal Propagation

The MCP client's abort signal is propagated through to `TrailContext.abortSignal`. If the client cancels a tool call, the implementation's signal is aborted.

```typescript
const longTask = trail('long.task', {
  blaze: async (input, ctx) => {
    for (const item of items) {
      if (ctx.abortSignal?.aborted) {
        return Result.err(new CancelledError('Task cancelled'));
      }
      await processItem(item);
    }
    return Result.ok('done');
  },
});
```

## Layers

Layers compose identically to CLI. The MCP adapter uses `composeLayers()` from `@ontrails/core` to wrap the implementation.

No MCP-specific layers ship in v1. The infrastructure is wired and ready for domain-specific layers (rate limiting, caching, auth) to be added later.

## Building Tools Without `trailhead()`

For advanced use cases, build the tool definitions directly:

```typescript
import { buildMcpTools } from '@ontrails/mcp';

const result = buildMcpTools(app, {
  includeTrails: ['entity.show', 'search'],
});

if (result.isErr()) {
  throw result.error;
}

// result.value is McpToolDefinition[] -- register them with your own MCP server instance
for (const tool of result.value) {
  server.registerTool(tool.name, tool.handler, {
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  });
}
```

Each `McpToolDefinition` includes a `trailId` field containing the original trail ID (e.g. `'entity.show'`). This is useful for logging, filtering, or routing when managing tool definitions outside of `trailhead()`.
