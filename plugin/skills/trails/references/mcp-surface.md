# MCP Surface Reference

## Tool Naming

Trail IDs are converted to MCP tool names using the pattern `${appName}_${trailId}` with dots replaced by underscores:

| App name | Trail ID | MCP tool name |
|----------|----------|---------------|
| `myapp` | `greet` | `myapp_greet` |
| `myapp` | `entity.show` | `myapp_entity_show` |
| `myapp` | `math.add` | `myapp_math_add` |

Tool names are always lowercase with underscores. This matches MCP conventions and avoids conflicts across apps sharing a server.

## JSON Schema Derivation

The trail's Zod `input` schema is converted to JSON Schema for the MCP tool's `inputSchema`:

| Zod type | JSON Schema |
|----------|-------------|
| `z.string()` | `{ type: "string" }` |
| `z.number()` | `{ type: "number" }` |
| `z.boolean()` | `{ type: "boolean" }` |
| `z.enum(['a', 'b'])` | `{ type: "string", enum: ["a", "b"] }` |
| `z.array(z.string())` | `{ type: "array", items: { type: "string" } }` |
| `z.object({...})` | `{ type: "object", properties: {...} }` |
| `.describe('...')` | `{ description: "..." }` |
| `.default(val)` | `{ default: val }` |
| `.optional()` | Removed from `required` array |

Fields without `.optional()` or `.default()` are listed in the `required` array.

## Annotations from Intent

Trail intent and flags map directly to MCP tool annotations:

| Trail field | MCP annotation |
|------------|----------------|
| `intent: 'read'` | `readOnlyHint: true` |
| `intent: 'destroy'` | `destructiveHint: true` |
| `idempotent: true` | `idempotentHint: true` |

These annotations help MCP clients (like Claude) make informed decisions about tool usage — read-only tools are safe to call speculatively, destructive tools warrant confirmation.

## Progress Bridging

`ctx.progress?.(event)` inside a trail implementation maps to MCP progress notifications. The surface handles the protocol — implementations just report structured progress events:

```typescript
blaze: async (input, ctx) => {
  for (let i = 0; i < items.length; i++) {
    await processItem(items[i]);
    ctx.progress?.({
      current: i + 1,
      total: items.length,
      ts: new Date().toISOString(),
      type: 'progress',
    });
  }
  return Result.ok({ processed: items.length });
},
```

## Examples as Agent Context

Trail `examples` are included in MCP tool metadata. Agents use these to understand expected input/output shapes and plan tool usage without trial and error.

## CreateServerOptions

```typescript
import { surface } from '@ontrails/mcp';

await surface(graph, {
  name: 'myapp',                  // Tool name prefix (defaults to topo name)
  version: '1.0.0',               // Server version
  description: 'Internal tools',  // Forwarded as MCP server instructions
  include: ['entity.**'],         // Optional trail filters
});
```

`surface(graph, options)` and `createServer(graph, options)` accept the same
options bag: `name`, `version`, `description`, `include`, `exclude`, `intent`,
`layers`, `createContext`, `configValues`, `resources`, and `validate`.

## Escape Hatch

For manual tool definition or custom MCP server configuration, use `deriveMcpTools()`. It returns `Result<McpToolDefinition[], Error>` — check for errors before using the array (name collisions produce a `ValidationError`):

```typescript
import { deriveMcpTools } from '@ontrails/mcp';
import { graph } from './app';

const toolsResult = deriveMcpTools(graph);
if (toolsResult.isErr()) throw new Error(toolsResult.error.message);
const tools = toolsResult.value;
// Wire into your own MCP server setup
```

Each `McpToolDefinition` includes:

- `name` — derived tool name (`appName_trail_id`)
- `inputSchema` — JSON Schema from the trail's Zod input
- `annotations` — MCP hints derived from trail intent
- `description` — trail description with first example appended
- `handler` — async function that runs the full `executeTrail` pipeline
- `trailId` — the original trail ID this tool was derived from (useful for filtering and introspection)

This gives you the raw tool definitions to register manually while still benefiting from automatic schema derivation and annotation mapping.
