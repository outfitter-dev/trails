import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Server } from '@modelcontextprotocol/server';
import type { Topo } from '@ontrails/core';

import { createMcpFetchBoundary } from './fetch-boundary.js';
import type { McpFetchBoundaryOptions } from './fetch-boundary.js';
import { createServerFactory } from './server.js';
import type { CreateServerOptions } from './server.js';

/**
 * Options for the portable MCP HTTP entry, separate from runtime hosting.
 *
 * The entry always builds with the `network` credential posture: identity
 * enters only through `resolvePermit`, a `createContext` permit is
 * discarded at runtime, and protected trails without a resolver are refused
 * at build time. The posture is not configurable here.
 */
export interface CreateMcpFetchHandlerOptions
  extends
    Omit<CreateServerOptions, 'credentialPosture'>,
    McpFetchBoundaryOptions {}

/** Portable request handler with teardown of active server instances and streams. */
export interface McpFetchHandler {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly close: () => Promise<void>;
}

/**
 * Serve modern MCP and legacy stateless HTTP through one fresh server factory.
 *
 * Host and Origin checks run before SDK dispatch. Raw request authorization
 * reaches the existing permit resolver; this entry never fabricates SDK authInfo.
 *
 * @example
 * ```ts
 * import { createFetchHandler } from '@ontrails/mcp/fetch';
 * const mcp = createFetchHandler(graph);
 * const server = Bun.serve({ fetch: mcp.fetch });
 * // On shutdown: await mcp.close(); server.stop();
 * ```
 */
export const createFetchHandler = (
  graph: Topo,
  options: CreateMcpFetchHandlerOptions = {}
): McpFetchHandler => {
  const guard = createMcpFetchBoundary(options);
  const factory = createServerFactory(graph, {
    ...options,
    credentialPosture: 'network',
  });
  const instances = new Set<Server>();
  let closed = false;
  const handler = createMcpHandler(
    (context) => {
      if (closed) {
        throw new Error('This MCP handler has been closed');
      }
      const authorization = context.requestInfo?.headers.get('authorization');
      const server = factory(
        authorization === null || authorization === undefined
          ? undefined
          : { authorization }
      );
      instances.add(server);
      const previousOnClose = server.onclose;
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- SDK Server exposes onclose rather than EventTarget; preserve its callback.
      server.onclose = () => {
        instances.delete(server);
        previousOnClose?.();
      };
      return server;
    },
    { legacy: 'stateless' }
  );
  return {
    close: async () => {
      closed = true;
      await handler.close();
      // SDK teardown tracks modern exchanges only; legacy instances need the same shutdown.
      await Promise.all([...instances].map((server) => server.close()));
      instances.clear();
    },
    fetch: async (request) => guard(request) ?? handler.fetch(request),
  };
};
