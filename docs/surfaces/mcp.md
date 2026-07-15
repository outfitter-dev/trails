# MCP Surface

The MCP surface adapter turns every trail into an MCP tool. Annotations are auto-derived from trail intent, idempotency, and description. Progress callbacks bridge to MCP notifications. One `surface()` call starts a server.

## Setup

```bash
bun add @ontrails/mcp@beta
```

```typescript
import { surface } from '@ontrails/mcp';
import { graph } from './app';

await surface(graph);
```

That starts an MCP server over stdio with every trail registered as a tool.

## How Trail IDs Map to Tool Names

Tool names are derived from the app name and trail ID:

| App name   | Trail ID       | Tool name               |
| ---------- | -------------- | ----------------------- |
| `myapp`    | `entity.show`  | `myapp_entity_show`     |
| `myapp`    | `search`       | `myapp_search`          |
| `patches`  | `patch.search` | `patches_patch_search`  |

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

## Output Schema and Examples

When a trail declares `output`, the MCP tool definition includes an `outputSchema` derived from that Zod schema. Schemas whose JSON representation has a top-level `type: "object"` render directly into `structuredContent`. All other schemas -- arrays, scalars, discriminated unions (`anyOf`), intersections (`allOf`), and `z.any()` -- are wrapped in `{ data: ... }` because MCP requires the root of `outputSchema` to be `type: "object"`.

Trail examples are exposed as structured tool metadata under `_meta["ontrails/examples"]`. Each example keeps the authored input, expected output or error, a success/error kind, and provenance pointing back to `trail.examples`; clients do not need to scrape example JSON from prose descriptions.

## Trailheads

Dense MCP surfaces can use trailheads to group related trails into fewer agent-facing tools while preserving the underlying trail contracts. Trailheads are surface accommodations on the entry axis: they group and select without merging. The full guide is [Trailheads](surface-trailheads.md), and the accepted cross-surface doctrine is [ADR-0050](../adr/0050-surface-accommodations-preserve-trail-identity.md). The short version:

- author the grouped entry as an `mcp` list binding in the app's `surfaceOverlay({ mcp })` — this is the authored, lockable default, embedded in `trails.lock` and rendered into the graph's trailhead facts;
- optionally pass a call-site trailhead map in MCP surface options when the running surface needs richer metadata (description, deferred loading) — the call-site map is an override-in-context and wins at runtime;
- each trailhead becomes one MCP tool;
- call the trailhead with `{ trail, input }`;
- successful responses return `{ trail, output }`;
- inspect `trails://surface-map` for trailhead IDs, member trail IDs, schemas, and deferred-loading hints, and use `trails://examples/<trailId>` for member examples.

## Overlay Bindings

The `surfaces` overlay's `mcp` bindings feed the MCP surface the same way `cli` bindings feed the CLI:

```typescript
export const trailsOverlays = [
  surfaceOverlay({
    mcp: {
      // List binding: a grouped trailhead tool over the expanded members.
      snippets: ['snippet.create', 'snippet.get', 'snippet.fork'],
      // Scalar binding: an additional tool synonym for exactly one trail.
      snippet_new: 'snippet.create',
    },
  }),
];

await surface(graph, { overlays: trailsOverlays });
```

A list binding is exactly a trailhead: one derived grouped tool per binding name, with member selection in the input and member identity preserved in the response. The derived tool uses a deterministic default description over the expanded members; author a call-site trailhead map when the entry needs richer prose or deferred loading.

A scalar binding is a tool synonym: an additional MCP tool whose name is the binding name, sharing the target trail's schema, annotations, and handler. Synonym names are published verbatim, so they must be MCP-safe (`[a-z0-9_]+`), and a scalar selector must expand to exactly one trail.

Binding selectors use dotted trail-id globs (`snippet.*`), the same grammar as CLI bindings and surface filters. `trails compile` embeds the bindings in `trails.lock` under `overlays.surfaces` and derives the graph's trailhead facts from the `mcp` list bindings, so `trails wayfind --trailheads`-style reads flow from the committed lock.

## MCP Resources For Cold Context

Cold context belongs in **MCP resources**, not in extra tools and not in Trails `resource()` declarations. The MCP surface exposes resources by default when using `surface(graph)` or `createServer(graph)`:

| Resource URI | Contents |
| --- | --- |
| `trails://surface-map` | Resolved MCP surface rendering: tool names, trail IDs, `trailheadId` values, member trail IDs, input/output schemas, versions, annotations, and deferred hints |
| `trails://examples/<trailId>` | Structured examples for an exposed trail, when the trail defines examples |
| `trails://trail/<trailId>` | MCP-visible graph facts for an exposed trail: identity, intent, visibility, composition, resource and signal references, and rendered MCP tool metadata |

Use `mcpResources: false` to disable MCP resource registration:

```typescript
await surface(graph, { mcpResources: false });
```

Use `mcpResources` to keep only a subset:

```typescript
await surface(graph, {
  mcpResources: { examples: false, graph: true, surfaceMap: true },
});
```

Graph resources are opt-in for general MCP hosts because they widen cold context for every exposed trail. The Trails operator enables them so agents can inspect high-signal graph facts without invoking another tool.

The resource naming is intentionally qualified: `McpResource`, `McpResources`, and `mcpResources` refer to MCP protocol resources. Trails `resource()` remains the infrastructure dependency primitive.

## Deferred Loading Hint

Trailhead tools may opt into deferred loading:

```typescript
await surface(graph, {
  trailheads: {
    governance: {
      description: 'Run project diagnostics and Warden guidance.',
      mcp: { loading: 'deferred' },
      trails: ['doctor', 'warden', 'warden.guide'],
    },
  },
});
```

Deferred loading is a compatibility hint under `_meta["ontrails/deferred"]`. It does not omit required tool schemas from `tools/list` in this release, so older MCP clients still receive a complete tool definition. Clients that understand the hint can prefer the surface-map resource and defer expensive schema inspection until they need the trailhead.

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
// -> {
//   content: [{ type: "text", text: '{"name":"Alpha","type":"concept"}' }],
//   structuredContent: { name: "Alpha", type: "concept" }
// }
```

**Error:**

```typescript
Result.err(new NotFoundError('Entity not found'));
// -> {
//   content: [{ type: "text", text: "Entity not found" }],
//   isError: true,
//   _meta: {
//     "ontrails/error": {
//       name: "NotFoundError",
//       category: "not_found",
//       code: -32601,
//       retryable: false,
//       message: "Entity not found",
//       surface: "mcp"
//     }
//   }
// }
```

Trail failures are MCP tool-result errors, not JSON-RPC protocol errors. The model-visible payload stays text-only on error, while `_meta["ontrails/error"]` contains the same JSON-RPC-family code rendering used by `mapSurfaceError('mcp', error)`. Both fields use the shared public error rendering: `TrailsError` messages are redacted, and unknown native errors return the generic `Internal server error` text without framework error metadata. Internal-category `TrailsError` instances also use the generic public message while keeping their taxonomy metadata. Protocol errors remain reserved for invalid MCP requests such as malformed methods or unknown tools.

**Binary data:**

If the result contains a `BlobRef` declared with `blobRefSchema`, MCP renders the core descriptor into `structuredContent` and materializes bytes through MCP content entries. Image MIME types become image content:

```typescript
// -> { content: [{ type: "image", data: "<base64>", mimeType: "image/png" }] }
// -> { structuredContent: { file: { kind: "blob", name, mimeType, size, uri } } }
```

## Progress Bridging

A trail's implementation can report progress via `ctx.progress`. On the MCP surface, these are bridged to MCP `notifications/progress`:

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

The MCP client receives progress notifications: `{ current: 1, total: 100 }`, `{ current: 2, total: 100 }`, etc.

Progress bridging activates only when the MCP client includes a `progressToken` in the tool call. Otherwise, `ctx.progress` calls are silently ignored.

## Filtering Trails

Not every trail should be exposed as an MCP tool. Use include/exclude filters:

```typescript
await surface(graph, {
  include: ['entity.**', 'search'],
});

// Or exclude specific trails
await surface(graph, {
  exclude: ['internal.debug', 'admin.reset'],
});
```

`*` matches one dotted namespace segment and `**` matches any depth. Excludes apply before include narrowing, and trails marked `visibility: 'internal'` stay hidden unless you include their exact trail ID.

## Operator Wayfinder Exposure

Wayfinder trails are internal read tools over saved graph artifacts and package evidence. Expose them on MCP only when the host operator wants agents to inspect facts directly, and include explicit trail IDs instead of widening the whole `wayfind.*` namespace.

The Trails operator MCP surface starts with selected first-class Wayfinder tools: `wayfind.overview`, `wayfind.search`, `wayfind.trails`, `wayfind.contract`, `wayfind.examples`, `wayfind.errors`, `wayfind.nearby`, `wayfind.impact`, `wayfind.adapters`, and `wayfind.diff`. It also enables `trails://trail/<trailId>` graph resources for exposed trails. The tools remain direct rather than one broad Wayfinder trailhead so agents can see read-only annotations, descriptions, output schemas, and permission boundaries at the tool boundary. The cohesive `trails wayfind` navigation grammar is a CLI accommodation over these graph-read trails; MCP keeps explicit tools until a server-owned workspace-root binding can safely expose file outline and combined selector behavior. Live-source outline stays on the local CLI until that binding exists. Adjacent saved-topo inspection stays grouped in the operator's existing `inspect` trailhead; unselected Wayfinder queries are not exposed by default.

Do not document or expose deferred Wayfinder ideas as if they exist. V0 has no semantic search, signposts, or `wayfind.implications`; the CLI text-query selector is deterministic indexed graph filtering, not semantic search.

## Trailhead Field Notes

Dense MCP surfaces can use trailheads to group related trails into fewer agent-facing tools. The current evidence ledger lives in [Trailhead Field Notes](surface-trailhead-field-notes.md). Read it before generalizing trailhead behavior to another app or surface. It records the first Trails operator MCP shaping pass, the shortened evidence window, what survived contact, and what remains deferred.

## Server Configuration

```typescript
await surface(graph, {
  name: 'myapp',
  version: '1.0.0',
  transport: 'stdio', // Only stdio for now; SSE/streamable HTTP planned
  layers: [myAuthLayer, myRateLimitLayer],
  createContext: () => createTrailContext({ logger: myLogger }),
});
```

`surface(graph)` already derives the MCP server name and version from the topo identity. Pass `name` or `version` only when a specific surface instance needs to override them.

## AbortSignal Propagation

The MCP client's abort signal is propagated through to `TrailContext.abortSignal`. If the client cancels a tool call, the trail's implementation sees the aborted signal.

```typescript
const longTask = trail('long.task', {
  implementation: async (input, ctx) => {
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

The MCP surface accepts execution layers in its options and uses `composeLayers()` from `@ontrails/core` to wrap execution before the implementation.

No MCP-specific layers ship in v1. The infrastructure is wired for surface-scoped behavior such as rate limiting, caching, or auth layers, but these layers are not topo primitives or graph nodes.

## Building Tools Without `surface()`

For advanced use cases, build the tool definitions directly:

```typescript
import { deriveMcpTools } from '@ontrails/mcp';

const result = deriveMcpTools(graph, {
  include: ['entity.**', 'search'],
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

Each `McpToolDefinition` includes a `trailId` field containing the original trail ID (e.g. `'entity.show'`). This is useful for logging, filtering, or routing when managing tool definitions outside of `surface()`.

For versioned trails, the tool input schema includes a surface-owned `trailVersion` parameter. MCP handlers strip it before trail input validation and forward the selected live version or marker prefix to the shared execution pipeline. The `versions` field on each tool lists the live rendered versions; archived historical entries remain inspectable through topo artifacts but are not runtime tool targets.
