/**
 * Surface helpers for exposing a topo over MCP.
 */

import { ProtocolError, Server } from '@modelcontextprotocol/server';
import { NotFoundError, renderJsonRpcError } from '@ontrails/core';
import type {
  BaseSurfaceOptions,
  Layer,
  OverlayEnvelopeLike,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';

import type {
  McpSurfaceTrailheadMap,
  McpToolDefinition,
  ResolveMcpPermit,
} from './build.js';
import { deriveMcpTools } from './build.js';
import { buildMcpResources } from './resources.js';
import type { BuiltMcpResources, McpResourcesConfig } from './resources.js';
import { connectStdio } from './stdio.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateServerOptions extends BaseSurfaceOptions {
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly description?: string | undefined;
  /**
   * App-authored overlay envelopes (the same collection compile embeds in
   * `trails.lock`). The `surfaces` overlay's `mcp` bindings are the authored,
   * lockable default: list bindings become grouped trailhead tools and scalar
   * bindings become tool synonyms.
   */
  readonly overlays?: readonly OverlayEnvelopeLike[] | undefined;
  /**
   * Call-site trailhead map. Override-in-context by design: when both this
   * map and overlay `mcp` list bindings are present, the call-site map wins
   * at runtime.
   */
  readonly trailheads?: McpSurfaceTrailheadMap | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly mcpResources?: McpResourcesConfig | false | undefined;
  readonly name?: string | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  readonly resolvePermit?: ResolveMcpPermit | undefined;
  readonly version?: string | undefined;
}

export interface SurfaceMcpResult {
  readonly close: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal: create MCP server with tool handlers
// ---------------------------------------------------------------------------

/**
 * Create an MCP Server instance and register all tools.
 *
 * When provided, `info.description` is forwarded to the MCP SDK as the
 * server's `instructions` field — the SDK's documented channel for
 * "optional instructions describing how to use the server and its features."
 */
const createMcpServer = (
  tools: McpToolDefinition[],
  info: {
    readonly name: string;
    readonly version: string;
    readonly description?: string | undefined;
  },
  mcpResources?: BuiltMcpResources | undefined
): Server => {
  const server = new Server(
    { name: info.name, version: info.version },
    {
      capabilities: {
        ...(mcpResources === undefined ? {} : { resources: {} }),
        tools: {},
      },
      ...(info.description === undefined
        ? {}
        : { instructions: info.description }),
    }
  );

  // Build a lookup map for tool dispatch
  const toolMap = new Map<string, McpToolDefinition>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  // Register tools/list handler
  // oxlint-disable-next-line require-await -- MCP SDK requires async handler
  server.setRequestHandler('tools/list', async () => ({
    tools: tools.map((t) => ({
      _meta: t._meta,
      annotations: t.annotations,
      description: t.description,
      inputSchema: { ...t.inputSchema, type: 'object' as const },
      name: t.name,
      outputSchema:
        t.outputSchema === undefined
          ? undefined
          : { ...t.outputSchema, type: 'object' as const },
    })),
  }));

  // Register tools/call handler
  server.setRequestHandler('tools/call', async (request, requestExtra) => {
    const tool = toolMap.get(request.params.name);
    if (tool === undefined) {
      return {
        content: [
          {
            text: `Unknown tool: ${request.params.name}`,
            type: 'text' as const,
          },
        ],
        isError: true,
      };
    }

    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const progressToken = requestExtra.mcpReq._meta?.progressToken;
    const authorizationToken = requestExtra.http?.authInfo?.token;

    const sendProgress =
      progressToken === undefined
        ? undefined
        : async (current: number, total: number) => {
            await requestExtra.mcpReq.notify({
              method: 'notifications/progress',
              params: { progress: current, progressToken, total },
            });
          };

    const extra = {
      abortSignal: requestExtra.mcpReq.signal,
      ...(authorizationToken === undefined
        ? {}
        : { authorization: `Bearer ${authorizationToken}` }),
      progressToken,
      sendProgress,
      ...(requestExtra.sessionId === undefined
        ? {}
        : { sessionId: requestExtra.sessionId }),
    };

    const result = await tool.handler(args, extra);
    // Copy the readonly content list into the SDK result shape.
    return server.projectCallToolResult(
      { ...result, content: [...result.content] },
      tool.outputSchema
    );
  });

  if (mcpResources !== undefined) {
    // oxlint-disable-next-line require-await -- MCP SDK requires async handler
    server.setRequestHandler('resources/list', async () => ({
      resources: mcpResources.list.map((resource) => ({
        description: resource.description,
        mimeType: resource.mimeType,
        name: resource.name,
        uri: resource.uri,
      })),
    }));

    server.setRequestHandler('resources/read', async (request) => {
      const content = mcpResources.read(request.params.uri);
      if (content === undefined) {
        const error = renderJsonRpcError(
          'mcp',
          new NotFoundError(`Resource ${request.params.uri} not found`),
          'resources/read'
        );
        throw new ProtocolError(error.code, error.message, error.data);
      }
      return {
        contents: [content],
      };
    });
  }

  return server;
};

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

const createServerFactory = (
  graph: Topo,
  options: CreateServerOptions = {}
): (() => Server) => {
  const toolsResult = deriveMcpTools(graph, {
    configValues: options.configValues,
    createContext: options.createContext,
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
    layers: options.layers,
    overlays: options.overlays,
    resolvePermit: options.resolvePermit,
    resources: options.resources,
    trailheads: options.trailheads,
    validate: options.validate,
  });

  if (toolsResult.isErr()) {
    throw toolsResult.error;
  }

  const mcpResources =
    options.mcpResources === false
      ? undefined
      : buildMcpResources(graph, toolsResult.value, options.mcpResources);

  return () =>
    createMcpServer(
      toolsResult.value,
      {
        description: options.description ?? graph.description,
        name: options.name ?? graph.name,
        version: options.version ?? graph.version ?? '0.1.0',
      },
      mcpResources
    );
};

/**
 * Build a server for custom MCP hosts. Use surface() for protocol-aware stdio.
 *
 * Derivation failures throw at this host bootstrap boundary after
 * deriveMcpTools has represented the framework failure as a Result.
 *
 * @example
 * ```ts
 * const server = createServer(graph, { name: 'demo' });
 * ```
 */
export const createServer = (
  graph: Topo,
  options: CreateServerOptions = {}
): Server => createServerFactory(graph, options)();

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------

/**
 * Build MCP tools from a topo, create a server, and connect via stdio.
 *
 * @remarks Opens the MCP server on stdio. For custom transports, use
 * `createServer(graph)` with your own adapter.
 *
 * @example
 * ```ts
 * import { surface } from '@ontrails/mcp';
 *
 * await surface(graph, { name: 'demo' });
 * ```
 */
export const surface = async (
  graph: Topo,
  options: CreateServerOptions = {}
): Promise<SurfaceMcpResult> => {
  const factory = createServerFactory(graph, options);
  return connectStdio(factory);
};
