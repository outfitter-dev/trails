# @ontrails/mcp

MCP surface adapter for Trails. Generates MCP tools from trail definitions with auto-derived annotations, progress bridging, and a single `blaze()` call to start a server.

## Installation

```bash
bun add @ontrails/mcp
```

## Quick Start

```typescript
import { trail, topo, Result } from '@ontrails/core';
import { blaze } from '@ontrails/mcp';
import { z } from 'zod';

const greet = trail('greet', {
  input: z.object({ name: z.string().describe('Who to greet') }),
  readOnly: true,
  implementation: (input) => Result.ok(`Hello, ${input.name}!`),
});

const app = topo('myapp', { greet });
await blaze(app);
```

This starts an MCP server over stdio with a `myapp_greet` tool. The tool has `readOnlyHint: true` and a JSON Schema input derived from the Zod schema.

Pure trails can return `Result` directly. The MCP surface still executes the normalized awaitable implementation shape under the hood.

## API Overview

### `blaze(app, options?)`

Start an MCP server with all trails registered as tools.

```typescript
await blaze(app, {
  serverInfo: { name: 'myapp', version: '1.0.0' },
  transport: 'stdio',
  includeTrails: ['entity.show', 'search'],
  excludeTrails: ['internal.debug'],
  layers: [myAuthLayer],
  createContext: () => createTrailContext({ logger: myLogger }),
});
```

### `buildMcpTools(app, options?)`

Build tool definitions without starting a server. For advanced use cases where you manage the MCP server instance directly.

```typescript
import { buildMcpTools } from '@ontrails/mcp';

const tools = buildMcpTools(app, {
  includeTrails: ['entity.show', 'search'],
});

for (const tool of tools) {
  server.registerTool(tool.name, tool.handler, {
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  });
}
```

### Tool Name Derivation

Trail IDs map to MCP tool names with the app name prefix:

| App name   | Trail ID       | Tool name               |
| ---------- | -------------- | ----------------------- |
| `myapp`    | `entity.show`  | `myapp_entity_show`     |
| `myapp`    | `search`       | `myapp_search`          |
| `dispatch` | `patch.search` | `dispatch_patch_search` |

Rules: dots become underscores, hyphens become underscores, everything lowercase. Names match MCP convention `[a-z0-9_]+`.

```typescript
import { deriveToolName } from '@ontrails/mcp';
deriveToolName('myapp', 'entity.show'); // "myapp_entity_show"
```

### Annotation Auto-Generation

Trail markers map directly to MCP tool annotations:

| Trail field | MCP annotation | Effect |
| --- | --- | --- |
| `readOnly: true` | `readOnlyHint: true` | Tool does not modify state |
| `destructive: true` | `destructiveHint: true` | Tool has destructive side effects |
| `idempotent: true` | `idempotentHint: true` | Repeated calls are safe |
| `description` | `title` | Human-readable tool title |

```typescript
import { deriveAnnotations } from '@ontrails/mcp';
deriveAnnotations(showTrail); // { readOnlyHint: true, title: "Show entity details" }
```

Trails without markers produce empty annotations (MCP SDK defaults apply).

### Progress Bridge

Trail implementations report progress via `ctx.progress`. On MCP, these bridge to `notifications/progress`:

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

Progress bridging activates only when the MCP client includes a `progressToken` in the tool call. Otherwise, `ctx.progress` calls are silently ignored.

### Result Mapping

| Trail Result | MCP Response |
| --- | --- |
| `Result.ok(value)` | `{ content: [{ type: "text", text: JSON.stringify(value) }] }` |
| `Result.err(error)` | `{ content: [{ type: "text", text: error.message }], isError: true }` |
| `BlobRef` with image MIME type | `{ content: [{ type: "image", data: "<base64>", mimeType: "..." }] }` |

### Trail Filtering

```typescript
// Whitelist
await blaze(app, { includeTrails: ['entity.show', 'entity.add', 'search'] });

// Blacklist
await blaze(app, { excludeTrails: ['internal.debug', 'admin.reset'] });
```

`includeTrails` takes precedence over `excludeTrails`.

### AbortSignal Propagation

The MCP client's abort signal propagates to `TrailContext.signal`. If the client cancels a tool call, the implementation's signal is aborted.

## Exports

```typescript
import {
  blaze,
  buildMcpTools,
  deriveToolName,
  deriveAnnotations,
  createMcpProgressCallback,
  connectStdio,
} from '@ontrails/mcp';
```

## Further Reading

- [MCP Surface Guide](../../docs/surfaces/mcp.md)
- [Getting Started](../../docs/getting-started.md)
