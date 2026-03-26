# Stage 03 -- MCP Surface (`@ontrails/mcp`)

> The MCP surface adapter. Generates MCP tools from the topo, auto-derives annotations from trail markers, bridges progress callbacks to MCP notifications, and provides the `blaze()` one-liner for stdio transport.

---

## Prerequisites

- Stage 00 complete (monorepo scaffolded)
- Stage 01 complete (`@ontrails/core` implemented and tested)
- Stage 02 is NOT a prerequisite -- CLI and MCP are independent surface adapters. They can be built in parallel.

---

## 1. Package Setup

### 1.1 Structure

```
packages/mcp/
├── src/
│   ├── index.ts                  # Main barrel
│   ├── build.ts                  # buildMcpTools()
│   ├── tool-name.ts              # Tool name derivation
│   ├── annotations.ts            # Annotation auto-generation
│   ├── progress.ts               # Progress callback → MCP notifications
│   ├── blaze.ts                  # blaze() one-liner
│   ├── stdio.ts                  # connectStdio helper
│   └── __tests__/
│       ├── build.test.ts
│       ├── tool-name.test.ts
│       ├── annotations.test.ts
│       ├── progress.test.ts
│       ├── blaze.test.ts
│       └── stdio.test.ts
├── package.json
└── tsconfig.json
```

### 1.2 `package.json`

```json
{
  "name": "@ontrails/mcp",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@ontrails/core": "workspace:*"
  },
  "peerDependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "catalog:"
  },
  "scripts": {
    "build": "tsc -b",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist *.tsbuildinfo"
  }
}
```

`@modelcontextprotocol/sdk` is a required peer dependency (not optional like Commander is for CLI). MCP without the SDK is not useful.

---

## 2. Tool Name Derivation

**File:** `src/tool-name.ts`

### 2.1 `deriveToolName(appName, trailId)`

Converts a trail ID into an MCP tool name:

```typescript
function deriveToolName(appName: string, trailId: string): string;
```

**Rules:**

- Replace dots with underscores: `entity.show` -> `entity_show`
- Prefix with app name: `myapp` + `entity.show` -> `myapp_entity_show`
- Lowercase everything
- Replace hyphens with underscores (MCP tool names should be `[a-z0-9_]+`)

**Examples:**

| App name | Trail ID | Tool name |
|----------|----------|-----------|
| `myapp` | `entity.show` | `myapp_entity_show` |
| `myapp` | `search` | `myapp_search` |
| `myapp` | `entity.onboard` | `myapp_entity_onboard` |
| `dispatch` | `patch.search` | `dispatch_patch_search` |

### 2.2 Tests

- Basic dot-to-underscore conversion
- App name prefixing
- Hyphen handling
- Case normalization
- Single-segment trail IDs (no dots)

---

## 3. Annotation Auto-Generation

**File:** `src/annotations.ts`

### 3.1 `deriveAnnotations(trail)`

Generates MCP tool annotations from trail markers:

```typescript
function deriveAnnotations(trail: Trail): McpAnnotations;

interface McpAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  title?: string;
}
```

**Mapping from trail spec to MCP annotations:**

| Trail field | MCP annotation | Logic |
|-------------|---------------|-------|
| `readOnly: true` | `readOnlyHint: true` | Direct mapping |
| `destructive: true` | `destructiveHint: true` | Direct mapping |
| `idempotent: true` | `idempotentHint: true` | Direct mapping |
| `description` | `title` | Use trail description as tool title |

If none of `readOnly`, `destructive`, or `idempotent` are set, omit the corresponding hints (let the MCP SDK use its defaults).

### 3.2 Tests

- readOnly trail produces readOnlyHint
- destructive trail produces destructiveHint
- idempotent trail produces idempotentHint
- Multiple markers combine correctly
- No markers produces empty annotations (no defaults injected)
- Description maps to title

---

## 4. `buildMcpTools(app, options?)`

**File:** `src/build.ts`

### 4.1 Function signature

```typescript
function buildMcpTools(
  app: App,
  options?: BuildMcpToolsOptions,
): McpToolDefinition[];

interface BuildMcpToolsOptions {
  createContext?: () => TrailContext | Promise<TrailContext>;
  layers?: Layer[];
  includeTrails?: string[];     // Whitelist trail IDs (default: all)
  excludeTrails?: string[];     // Blacklist trail IDs
}

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;   // JSON Schema from zodToJsonSchema()
  annotations?: McpAnnotations;
  handler: (args: Record<string, unknown>, extra: McpExtra) => Promise<McpToolResult>;
}

interface McpExtra {
  signal?: AbortSignal;
  progressToken?: string | number;
  sendProgress?: (current: number, total: number) => Promise<void>;
}

interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

interface McpContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;          // Base64 for images
  mimeType?: string;
  uri?: string;           // For resource references
}
```

### 4.2 What it does, step by step

1. **Iterate the topo** -- loop through `app.topo.list()` to get all trails and routes.

2. **Apply include/exclude filters** -- if `includeTrails` is set, only include those IDs. If `excludeTrails` is set, remove those IDs. Include takes precedence.

3. **For each trail, produce an McpToolDefinition:**

   a. **Name:** Call `deriveToolName(app.name, trail.id)`.

   b. **Description:** Use `trail.description`. If the trail has examples, append a summary (first example's input as JSON).

   c. **Input schema:** Call `zodToJsonSchema(trail.input)` from `@ontrails/core` to convert the Zod input schema to JSON Schema.

   d. **Annotations:** Call `deriveAnnotations(trail)`.

   e. **Handler:** Create a function that:
      1. Validates input: `validateInput(trail.input, args)`
      2. Creates TrailContext: uses `options.createContext()` if provided, otherwise `createTrailContext()`
      3. Wires AbortSignal from `extra.signal` into the context
      4. Wires progress callback from `extra.sendProgress` into the context (see section 5)
      5. Applies layers: `composeLayers(options.layers ?? [], trail, trail.implementation)`
      6. Calls the implementation
      7. Maps the Result to McpToolResult:
         - `Result.ok(value)` -> `{ content: [{ type: "text", text: JSON.stringify(value) }] }`
         - `Result.err(error)` -> `{ content: [{ type: "text", text: error.message }], isError: true }`

4. **Handle BlobRef in output:** If the result value contains a `BlobRef`, convert it to an image or resource content entry:
   - Images (MIME type starts with `image/`): `{ type: "image", data: base64(blobRef.data), mimeType }`
   - Other: `{ type: "resource", uri: "blob://name", mimeType }`

5. **Return McpToolDefinition[]** -- the array of tool definitions.

### 4.3 Tests

- Builds tools from a simple app
- Tool names follow derivation rules
- Input schema is valid JSON Schema
- Annotations are correctly derived
- Handler validates input (returns isError on invalid)
- Handler calls implementation and returns result as text content
- Handler maps errors to isError content
- Include/exclude filters work
- BlobRef values are converted to image/resource content
- AbortSignal is propagated from MCP extra to TrailContext
- Layers compose correctly

---

## 5. Progress Callback Bridge

**File:** `src/progress.ts`

### 5.1 `createMcpProgressCallback(extra)`

Bridges the TrailContext `progress` callback to MCP's `sendProgress` notification:

```typescript
function createMcpProgressCallback(
  extra: McpExtra,
): ProgressCallback | undefined;
```

**Returns `undefined`** if the MCP client did not provide a `progressToken` (no progress reporting requested).

**When a progressToken is present**, returns a `ProgressCallback` that:

1. Receives `ProgressEvent` from the implementation
2. For `type: "progress"` events with `current` and `total`:
   - Calls `extra.sendProgress(event.current, event.total)`
3. For `type: "start"` and `type: "complete"` events:
   - Calls `extra.sendProgress(0, 1)` and `extra.sendProgress(1, 1)` respectively
4. For `type: "error"` events:
   - No progress notification (the error will be in the result)

This bridges the Trails streaming model (implementation emits ProgressEvents via `ctx.progress`) to the MCP progress notification model (server sends `notifications/progress` with current/total).

### 5.2 Tests

- Returns undefined when no progressToken
- Sends progress notification for "progress" events
- Sends 0/1 for "start" events
- Sends 1/1 for "complete" events
- Does not send for "error" events
- Handles missing total gracefully

---

## 6. `blaze(app, options?)`

**File:** `src/blaze.ts`

### 6.1 The one-liner

```typescript
async function blaze(
  app: App,
  options?: BlazeMcpOptions,
): Promise<void>;

interface BlazeMcpOptions {
  createContext?: () => TrailContext | Promise<TrailContext>;
  layers?: Layer[];
  includeTrails?: string[];
  excludeTrails?: string[];
  transport?: "stdio";          // Only stdio for now; SSE/streamable HTTP later
  serverInfo?: {
    name?: string;
    version?: string;
  };
}
```

### 6.2 What it does

```typescript
async function blaze(app: App, options: BlazeMcpOptions = {}): Promise<void> {
  const tools = buildMcpTools(app, {
    createContext: options.createContext,
    layers: options.layers,
    includeTrails: options.includeTrails,
    excludeTrails: options.excludeTrails,
  });

  const server = createMcpServer(tools, {
    name: options.serverInfo?.name ?? app.name,
    version: options.serverInfo?.version ?? "0.1.0",
  });

  await connectStdio(server);
}
```

1. Build MCP tools from the app's topo
2. Create an MCP server (using `@modelcontextprotocol/sdk`) with the tools
3. Connect via stdio transport

### 6.3 `createMcpServer(tools, info)` (internal)

Creates an MCP Server instance and registers all tools:

```typescript
function createMcpServer(
  tools: McpToolDefinition[],
  info: { name: string; version: string },
): Server;
```

Uses `@modelcontextprotocol/sdk`'s `Server` class:

1. Create `new Server({ name, version })`
2. Register `tools/list` handler that returns tool definitions (name, description, inputSchema, annotations)
3. Register `tools/call` handler that dispatches to the correct tool's handler
4. Return the server

**Usage:**

```typescript
import { trailhead } from "@ontrails/core";
import { blaze } from "@ontrails/mcp";
import * as entity from "./trails/entity.ts";

const app = trailhead("myapp", entity);
await blaze(app);
```

Three lines. Same pattern as CLI.

---

## 7. connectStdio Helper

**File:** `src/stdio.ts`

### 7.1 `connectStdio(server)`

Connects an MCP server to stdio transport:

```typescript
async function connectStdio(server: Server): Promise<void>;
```

Uses `@modelcontextprotocol/sdk`'s `StdioServerTransport`:

```typescript
async function connectStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

This is a thin wrapper. It exists as a separate function so it can be replaced with other transports (SSE, streamable HTTP) in the future without changing `blaze()`.

### 7.2 Tests

- connectStdio creates a transport and connects (integration test with mock stdin/stdout)

---

## 8. MCP-Specific Layer Support

Layers work the same way as in CLI -- they wrap the implementation. The MCP adapter composes them via `composeLayers()` from core.

MCP-specific layers can inspect trail markers and the MCP extra context. For example, a future `rateLimitLayer` could use `RateLimitError.retryAfter` to set MCP retry headers.

No MCP-specific layers ship in stage 03. The layer infrastructure is wired and tested, but domain-specific MCP layers (rate limiting, caching, auth) are deferred.

---

## 9. Package Exports Structure

### 9.1 Main barrel (`src/index.ts`)

```typescript
// Build
export {
  buildMcpTools,
  type BuildMcpToolsOptions,
  type McpToolDefinition,
  type McpToolResult,
  type McpContent,
  type McpExtra,
} from "./build";

// Tool naming
export { deriveToolName } from "./tool-name";

// Annotations
export { deriveAnnotations, type McpAnnotations } from "./annotations";

// Progress
export { createMcpProgressCallback } from "./progress";

// Blaze
export { blaze, type BlazeMcpOptions } from "./blaze";

// Transport
export { connectStdio } from "./stdio";
```

Single export path. No subpaths needed for MCP (unlike CLI which has the `/commander` subpath). Everything comes from `@ontrails/mcp`.

---

## Testing Requirements

TDD for everything. Tests in `src/__tests__/`.

### Key test scenarios

**build.test.ts** (the critical one):

- Builds tools from a single-trail app
- Builds tools from a multi-trail app
- Tool handler validates input and returns validation error as isError
- Tool handler calls implementation and returns result as text content
- Tool handler maps TrailsError to isError with message
- Include filter limits which trails become tools
- Exclude filter removes specific trails
- Layers compose and execute around the implementation
- AbortSignal propagates from MCP extra to TrailContext
- BlobRef in output converts to image/resource content
- Output schema is not required (some trails are text-only)

**tool-name.test.ts:**

- Comprehensive name derivation examples (see section 2)

**annotations.test.ts:**

- Each marker maps to the correct hint
- Combinations work
- No markers produces clean annotations

**progress.test.ts:**

- Bridge produces correct notifications for each event type
- Graceful degradation when no progressToken

**blaze.test.ts:**

- Integration test: define trails, blaze on MCP, verify tool list
- This may need to mock the stdio transport

**End-to-end test:**

Define a trail in core, register it via `buildMcpTools()`, call the tool handler, verify the response structure matches MCP protocol expectations. This proves the full pipeline: trail definition -> topo -> MCP tool -> handler call -> Result -> MCP response.

---

## Definition of Done

- [ ] `@ontrails/mcp` package exists with all files listed above
- [ ] `deriveToolName()` converts trail IDs to MCP-safe tool names with app prefix
- [ ] `deriveAnnotations()` maps readOnly/destructive/idempotent to MCP hints
- [ ] `buildMcpTools(app)` produces McpToolDefinition[] from the topo
- [ ] Tool input schemas are JSON Schema from `zodToJsonSchema()` (from core)
- [ ] Tool handlers validate input, compose layers, call implementation, return McpToolResult
- [ ] BlobRef values in output are converted to image/resource MCP content
- [ ] Error results map to `isError: true` with error message
- [ ] `createMcpProgressCallback()` bridges ProgressCallback to MCP notifications
- [ ] `blaze(app)` is a working one-liner (build tools + create server + connect stdio)
- [ ] `connectStdio()` wraps MCP SDK's StdioServerTransport
- [ ] Include/exclude trail filters work
- [ ] AbortSignal propagates from MCP client to TrailContext
- [ ] Layer infrastructure is wired (composeLayers used in tool handlers)
- [ ] All tests pass
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] Changeset added
- [ ] End-to-end test: trail -> topo -> MCP tool -> handler -> Result -> MCP response
