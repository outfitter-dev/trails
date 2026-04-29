/**
 * Surface helpers for exposing a topo over MCP.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  Intent,
  Layer,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';

import type { McpToolDefinition } from './build.js';
import { deriveMcpTools } from './build.js';
import { connectStdio } from './stdio.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateServerOptions {
  /** Config values for resources that declare a `config` schema, keyed by resource ID. */
  readonly configValues?:
    | Readonly<Record<string, Record<string, unknown>>>
    | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly description?: string | undefined;
  readonly exclude?: readonly string[] | undefined;
  readonly include?: readonly string[] | undefined;
  readonly intent?: readonly Intent[] | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly name?: string | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  /** Set to `false` to skip topo validation at startup. Defaults to `true`. */
  readonly validate?: boolean | undefined;
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
  }
): Server => {
  const server = new Server(
    { name: info.name, version: info.version },
    {
      capabilities: { tools: {} },
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
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
      abortSignal: undefined as AbortSignal | undefined,
      progressToken,
      sendProgress,
    };

    const result = await tool.handler(args, extra);
    // Spread to satisfy MCP SDK's index-signature requirement
    return { ...result } as Record<string, unknown>;
  });

  return server;
};

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

/**
 * Build MCP tools from a topo and create an MCP server.
 */
export const createServer = (
  graph: Topo,
  options: CreateServerOptions = {}
): Server => {
  const toolsResult = deriveMcpTools(graph, {
    configValues: options.configValues,
    createContext: options.createContext,
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
    layers: options.layers,
    resources: options.resources,
    validate: options.validate,
  });

  if (toolsResult.isErr()) {
    throw toolsResult.error;
  }

  return createMcpServer(toolsResult.value, {
    description: options.description ?? graph.description,
    name: options.name ?? graph.name,
    version: options.version ?? graph.version ?? '0.1.0',
  });
};

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------

/**
 * Build MCP tools from a topo, create a server, and connect via stdio.
 *
 * @remarks Opens the MCP server on stdio. For custom transports, use
 * `createServer(graph)` with `connectStdio` or your own connector.
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
