/**
 * Thin wrapper around MCP SDK's StdioServerTransport.
 *
 * Exists as a separate function so it can be swapped for other transports
 * (SSE, streamable HTTP) without changing surface().
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Connect an MCP server to stdio transport.
 */
export const connectStdio = async (server: Server): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
