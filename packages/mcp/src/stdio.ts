/** Protocol-aware MCP stdio serving through the official SDK. */

import type { McpServerFactory } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';

/**
 * Serve stdio using a fresh server factory for protocol-era selection.
 *
 * The SDK may create a discovery probe before pinning a connection instance.
 * Returning one previously connected server from the factory is unsupported.
 *
 * @example
 * ```ts
 * import { connectStdio, createServer } from '@ontrails/mcp';
 *
 * const connection = await connectStdio(() => createServer(graph));
 * await connection.close();
 * ```
 */
export const connectStdio = async (
  factory: McpServerFactory
): Promise<StdioServerHandle> => serveStdio(factory);
