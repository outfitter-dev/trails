/**
 * Surface helpers for exposing a topo over MCP.
 */

import { Server } from '@modelcontextprotocol/server';
import type { ServerContext } from '@modelcontextprotocol/server';
import { NotFoundError, PermissionError, Result } from '@ontrails/core';
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
  McpExtra,
  McpToolDefinition,
  ResolveMcpPermit,
} from './build.js';
import { deriveMcpTools } from './build.js';
import {
  resolveMcpResourcePermit,
  runMcpResourceRequest,
} from './resource-access.js';
import type { AuthorizeMcpResourceRead } from './resource-access.js';
import { buildMcpResources } from './resources.js';
import type { BuiltMcpResources, McpResourcesConfig } from './resources.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateServerOptions extends BaseSurfaceOptions {
  /** Optional read policy; permission denials also omit URIs from resource lists. */
  readonly authorizeResourceRead?: AuthorizeMcpResourceRead | undefined;
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

// ---------------------------------------------------------------------------
// Internal: create MCP server with tool handlers
// ---------------------------------------------------------------------------

const requestCredentials = (
  context: ServerContext,
  credentials?: Pick<McpExtra, 'authorization'>
): Pick<McpExtra, '_meta' | 'authorization'> => {
  const token = context.http?.authInfo?.token;
  const authorization =
    credentials?.authorization ??
    (token === undefined ? undefined : `Bearer ${token}`);
  return {
    _meta: context.mcpReq._meta,
    ...(authorization === undefined ? {} : { authorization }),
  };
};

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
  mcpResources: BuiltMcpResources | undefined,
  options: CreateServerOptions,
  credentials?: Pick<McpExtra, 'authorization'>
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
      ...requestCredentials(requestExtra, credentials),
      abortSignal: requestExtra.mcpReq.signal,
      progressToken,
      sendProgress,
    };

    const result = await tool.handler(args, extra);
    // Copy the readonly content list into the SDK result shape.
    return server.projectCallToolResult(
      { ...result, content: [...result.content] },
      tool.outputSchema
    );
  });

  if (mcpResources !== undefined) {
    server.setRequestHandler('resources/list', (_request, requestExtra) =>
      runMcpResourceRequest(undefined, async () => {
        const permit = await resolveMcpResourcePermit(
          options,
          requestCredentials(requestExtra, credentials)
        );
        if (permit.isErr()) {
          return permit;
        }
        const resources = [];
        for (const resource of mcpResources.list) {
          if (options.authorizeResourceRead !== undefined) {
            const allowed = await options.authorizeResourceRead({
              permit: permit.value,
              resource,
            });
            if (allowed.isErr()) {
              if (allowed.error instanceof PermissionError) {
                continue;
              }
              return allowed;
            }
          }
          resources.push({
            description: resource.description,
            mimeType: resource.mimeType,
            name: resource.name,
            uri: resource.uri,
          });
        }
        return Result.ok({ resources });
      })
    );

    server.setRequestHandler('resources/read', (request, requestExtra) =>
      runMcpResourceRequest('resources/read', async () => {
        const permit = await resolveMcpResourcePermit(
          options,
          requestCredentials(requestExtra, credentials)
        );
        if (permit.isErr()) {
          return permit;
        }
        const resource = mcpResources.list.find(
          (entry) => entry.uri === request.params.uri
        );
        if (resource === undefined) {
          return Result.err(
            new NotFoundError(`Resource ${request.params.uri} not found`)
          );
        }
        if (options.authorizeResourceRead !== undefined) {
          const allowed = await options.authorizeResourceRead({
            permit: permit.value,
            resource,
          });
          if (allowed.isErr()) {
            return allowed;
          }
        }
        const content = mcpResources.read(resource.uri);
        if (content === undefined) {
          return Result.err(
            new NotFoundError(`Resource ${resource.uri} not found`)
          );
        }
        return Result.ok({ contents: [content] });
      })
    );
  }

  return server;
};

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

/** Build fresh portable server instances from one derived surface. @internal */
export const createServerFactory = (
  graph: Topo,
  options: CreateServerOptions = {}
): ((credentials?: Pick<McpExtra, 'authorization'>) => Server) => {
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

  return (credentials) =>
    createMcpServer(
      toolsResult.value,
      {
        description: options.description ?? graph.description,
        name: options.name ?? graph.name,
        version: options.version ?? graph.version ?? '0.1.0',
      },
      mcpResources,
      options,
      credentials
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
