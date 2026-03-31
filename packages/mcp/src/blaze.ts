/**
 * blaze() -- the one-liner MCP server launcher.
 *
 * Three lines to expose trails as MCP tools:
 *
 * ```ts
 * const app = topo("myapp", entity);
 * await blaze(app);
 * ```
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  Layer,
  ServiceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';
import { validateTopo } from '@ontrails/core';

import type { McpToolDefinition } from './build.js';
import { buildMcpTools } from './build.js';
import { connectStdio } from './stdio.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface BlazeMcpOptions {
  /** Config values for services that declare a `config` schema, keyed by service ID. */
  readonly configValues?:
    | Readonly<Record<string, Record<string, unknown>>>
    | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly excludeTrails?: readonly string[] | undefined;
  readonly includeTrails?: readonly string[] | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly serverInfo?:
    | {
        readonly name?: string | undefined;
        readonly version?: string | undefined;
      }
    | undefined;
  readonly transport?: 'stdio' | undefined;
  readonly services?: ServiceOverrideMap | undefined;
  /** Set to `false` to skip topo validation at startup. Defaults to `true`. */
  readonly validate?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Internal: create MCP server with tool handlers
// ---------------------------------------------------------------------------

/**
 * Create an MCP Server instance and register all tools.
 */
export const createMcpServer = (
  tools: McpToolDefinition[],
  info: { readonly name: string; readonly version: string }
): Server => {
  const server = new Server(
    { name: info.name, version: info.version },
    { capabilities: { tools: {} } }
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
      annotations: t.annotations,
      description: t.description,
      inputSchema: t.inputSchema,
      name: t.name,
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
                progressToken: progressToken,
                total,
              },
            });
          };

    const extra = {
      progressToken,
      sendProgress,
      signal: undefined as AbortSignal | undefined,
    };

    const result = await tool.handler(args, extra);
    // Spread to satisfy MCP SDK's index-signature requirement
    return { ...result } as Record<string, unknown>;
  });

  return server;
};

// ---------------------------------------------------------------------------
// blaze
// ---------------------------------------------------------------------------

/**
 * Build MCP tools from an App, create a server, and connect via stdio.
 */
export const blaze = async (
  app: Topo,
  options: BlazeMcpOptions = {}
): Promise<void> => {
  if (options.validate !== false) {
    const validated = validateTopo(app);
    if (validated.isErr()) {
      throw validated.error;
    }
  }

  const toolsResult = buildMcpTools(app, {
    configValues: options.configValues,
    createContext: options.createContext,
    excludeTrails: options.excludeTrails,
    includeTrails: options.includeTrails,
    layers: options.layers,
    services: options.services,
  });

  if (toolsResult.isErr()) {
    throw toolsResult.error;
  }

  const server = createMcpServer(toolsResult.value, {
    name: options.serverInfo?.name ?? app.name,
    version: options.serverInfo?.version ?? '0.1.0',
  });

  await connectStdio(server);
};
