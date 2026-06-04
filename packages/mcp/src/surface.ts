/**
 * Surface helpers for exposing a topo over MCP.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  BaseSurfaceOptions,
  Layer,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';

import type {
  McpSurfaceFacetMap,
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
  readonly facets?: McpSurfaceFacetMap | undefined;
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
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      _meta: t._meta,
      annotations: t.annotations,
      description: t.description,
      inputSchema: t.inputSchema,
      name: t.name,
      outputSchema: t.outputSchema,
    })),
  }));

  // Register tools/call handler
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request, requestExtra) => {
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
        } as Record<string, unknown>;
      }

      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const progressToken = request.params._meta?.progressToken;
      const { authInfo } = requestExtra as {
        readonly authInfo?:
          | {
              readonly accessToken?: string | undefined;
              readonly sessionId?: string | undefined;
              readonly token?: string | undefined;
            }
          | undefined;
      };
      const authorizationToken = authInfo?.accessToken ?? authInfo?.token;

      const sendProgress =
        progressToken === undefined
          ? undefined
          : async (current: number, total: number) => {
              await server.notification({
                method: 'notifications/progress',
                params: {
                  progress: current,
                  progressToken,
                  total,
                },
              });
            };

      const extra = {
        abortSignal: requestExtra.signal,
        ...(authorizationToken === undefined
          ? {}
          : { authorization: `Bearer ${authorizationToken}` }),
        progressToken,
        sendProgress,
        ...(authInfo?.sessionId === undefined
          ? {}
          : { sessionId: authInfo.sessionId }),
      };

      const result = await tool.handler(args, extra);
      // Spread to satisfy MCP SDK's index-signature requirement
      return { ...result } as Record<string, unknown>;
    }
  );

  if (mcpResources !== undefined) {
    // oxlint-disable-next-line require-await -- MCP SDK requires async handler
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: mcpResources.list.map((resource) => ({
        description: resource.description,
        mimeType: resource.mimeType,
        name: resource.name,
        uri: resource.uri,
      })),
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const content = mcpResources.read(request.params.uri);
      return {
        contents: [
          content ?? {
            mimeType: 'text/plain',
            text: `Unknown MCP resource: ${request.params.uri}`,
            uri: request.params.uri,
          },
        ],
      };
    });
  }

  return server;
};

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

/**
 * Build MCP tools from a topo and create an MCP server.
 *
 * @remarks This is a host materialization boundary. Derivation failures are
 * thrown for server bootstrap code after `deriveMcpTools` has already
 * represented the framework error as a Result.
 *
 * @example
 * ```ts
 * import { connectStdio, createServer } from '@ontrails/mcp';
 *
 * const server = createServer(graph, { name: 'demo' });
 * await connectStdio(server);
 * ```
 */
export const createServer = (
  graph: Topo,
  options: CreateServerOptions = {}
): Server => {
  const toolsResult = deriveMcpTools(graph, {
    configValues: options.configValues,
    createContext: options.createContext,
    exclude: options.exclude,
    facets: options.facets,
    include: options.include,
    intent: options.intent,
    layers: options.layers,
    resolvePermit: options.resolvePermit,
    resources: options.resources,
    validate: options.validate,
  });

  if (toolsResult.isErr()) {
    throw toolsResult.error;
  }

  const mcpResources =
    options.mcpResources === false
      ? undefined
      : buildMcpResources(graph, toolsResult.value, options.mcpResources);

  return createMcpServer(
    toolsResult.value,
    {
      description: options.description ?? graph.description,
      name: options.name ?? graph.name,
      version: options.version ?? graph.version ?? '0.1.0',
    },
    mcpResources
  );
};

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------

/**
 * Build MCP tools from a topo, create a server, and connect via stdio.
 *
 * @remarks Opens the MCP server on stdio. For custom transports, use
 * `createServer(graph)` with `connectStdio` or your own adapter.
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
  const server = createServer(graph, options);
  await connectStdio(server);

  return {
    close: async () => {
      await server.close();
    },
  };
};
