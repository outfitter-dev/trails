/**
 * MCP integration test harness.
 *
 * Builds MCP tools from an App, invokes them directly (no transport),
 * and returns the MCP tool response.
 */

import { deriveMcpTools } from '@ontrails/mcp';
import type { McpToolDefinition } from '@ontrails/mcp';

import type {
  McpHarness,
  McpHarnessOptions,
  McpHarnessResult,
} from './types.js';

// ---------------------------------------------------------------------------
// createMcpHarness
// ---------------------------------------------------------------------------

/**
 * Create an MCP harness for integration testing.
 *
 * Builds MCP tools from the app's topo and provides a `callTool()` method
 * that invokes tools directly without any transport boundary.
 *
 * ```ts
 * const harness = createMcpHarness({ app });
 * const result = await harness.callTool("myapp_entity_show", { name: "Alpha" });
 * expect(result.isError).toBe(false);
 * ```
 */
export const createMcpHarness = (options: McpHarnessOptions): McpHarness => {
  const toolsResult = deriveMcpTools(options.app);
  if (toolsResult.isErr()) {
    throw toolsResult.error;
  }
  const toolMap = new Map<string, McpToolDefinition>();
  for (const tool of toolsResult.value) {
    toolMap.set(tool.name, tool);
  }

  return {
    async callTool(
      name: string,
      args: Record<string, unknown>
    ): Promise<McpHarnessResult> {
      const tool = toolMap.get(name);
      if (tool === undefined) {
        return {
          content: [{ text: `Unknown tool: ${name}`, type: 'text' }],
          isError: true,
        };
      }

      const result = await tool.handler(args, {
        abortSignal: undefined,
        progressToken: undefined,
        sendProgress: undefined,
      });

      return {
        content: result.content,
        isError: result.isError ?? false,
      };
    },
  };
};
