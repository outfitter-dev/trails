/**
 * MCP integration test harness.
 *
 * Builds MCP tools from a graph, invokes them directly (no transport),
 * and returns the MCP tool response.
 */

import { deriveMcpTools } from '@ontrails/mcp';
import type {
  DeriveMcpToolsOptions,
  McpExtra,
  McpToolDefinition,
} from '@ontrails/mcp';
import type { Topo } from '@ontrails/core';

/** Options for creating an MCP harness. */
export interface McpHarnessOptions extends DeriveMcpToolsOptions {
  readonly extra?: Partial<McpExtra> | undefined;
  readonly graph: Topo;
}

/** A test harness for MCP tools. */
export interface McpHarness {
  /** Call an MCP tool by name with arguments. */
  callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<McpHarnessResult>;
}

/** The result of an MCP harness tool invocation. */
export interface McpHarnessResult {
  readonly content: unknown;
  readonly isError: boolean;
  readonly meta?: Record<string, unknown> | undefined;
  readonly structuredContent?: Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// createMcpHarness
// ---------------------------------------------------------------------------

/**
 * Create an MCP harness for integration testing.
 *
 * Builds MCP tools from the graph's topo and provides a `callTool()` method
 * that invokes tools directly without any transport boundary.
 *
 * ```ts
 * import { createMcpHarness } from '@ontrails/testing/mcp';
 *
 * const harness = createMcpHarness({ graph });
 * const result = await harness.callTool("myapp_entity_show", { name: "Alpha" });
 * expect(result.isError).toBe(false);
 * ```
 */
export const createMcpHarness = (options: McpHarnessOptions): McpHarness => {
  const { extra, graph, ...deriveOptions } = options;
  const toolsResult = deriveMcpTools(graph, deriveOptions);
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
        abortSignal: extra?.abortSignal,
        progressToken: extra?.progressToken,
        sendProgress: extra?.sendProgress,
      });

      return {
        content: result.content,
        isError: result.isError ?? false,
        meta: result._meta,
        structuredContent: result.structuredContent,
      };
    },
  };
};
