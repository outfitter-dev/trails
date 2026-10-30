/** Protocol-aware stdio entry; portable HTTP consumers use @ontrails/mcp/fetch. */
import type { Topo } from '@ontrails/core';

import { createServerFactory } from './server.js';
import type { CreateServerOptions } from './server.js';
import { connectStdio } from './stdio.js';

/**
 * Build a server for custom MCP hosts.
 * @example
 * ```ts
 * const server = createServer(graph);
 * ```
 */
export { createServer, type CreateServerOptions } from './server.js';

export interface SurfaceMcpResult {
  readonly close: () => Promise<void>;
}

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
  return connectStdio(() => factory());
};
