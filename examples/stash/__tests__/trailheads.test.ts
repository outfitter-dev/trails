/**
 * Trailheads on the MCP surface preserve member trail identity (ADR-0050).
 *
 * A trailhead tool accepts `{ trail, input }`, dispatches the selected member
 * through the ordinary tool pipeline, and answers `{ trail, output }`. Its
 * tool metadata names the trailhead and its member trail ids so clients can
 * inspect the grouping before selecting.
 */

import { describe, expect, test } from 'bun:test';

import { MCP_TOOL_TRAILHEAD_META_KEY, deriveMcpTools } from '@ontrails/mcp';
import type { McpToolDefinition } from '@ontrails/mcp';

import { graph, trailsOverlays } from '../src/app.js';
import { stashTrailheads } from '../src/mcp-options.js';
import { createMockDb, db } from '../src/resources/db.js';

const deriveTools = (conn: ReturnType<typeof createMockDb>) => {
  const tools = deriveMcpTools(graph, {
    resources: { [db.id]: conn },
    trailheads: stashTrailheads,
  });
  if (tools.isErr()) {
    throw tools.error;
  }
  return tools.value;
};

const trailheadTool = (
  tools: readonly McpToolDefinition[],
  trailheadId: string
): McpToolDefinition => {
  const tool = tools.find((candidate) => candidate.trailheadId === trailheadId);
  if (tool === undefined) {
    throw new Error(`No trailhead tool derived for "${trailheadId}"`);
  }
  return tool;
};

describe('MCP trailheads', () => {
  test('every configured trailhead derives a grouped tool with member ids', () => {
    const tools = deriveTools(createMockDb());
    for (const [id, definition] of Object.entries(stashTrailheads)) {
      const tool = trailheadTool(tools, id);
      expect([...(tool.memberTrailIds ?? [])].toSorted()).toEqual(
        [...definition.trails].toSorted()
      );
      expect(tool._meta?.[MCP_TOOL_TRAILHEAD_META_KEY]).toBeDefined();
    }
  });

  test('a trailhead call dispatches the selected member and names it in the response', async () => {
    const tools = deriveTools(createMockDb());
    const snippets = trailheadTool(tools, 'snippets');

    const result = await snippets.handler(
      { input: { id: 'snip_hello' }, trail: 'snippet.get' },
      {}
    );
    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent).toMatchObject({
      output: { id: 'snip_hello' },
      trail: 'snippet.get',
    });
  });

  test('a member outside the trailhead cannot be smuggled through it', async () => {
    const tools = deriveTools(createMockDb());
    const search = trailheadTool(tools, 'search');

    const result = await search.handler(
      { input: { id: 'snip_hello' }, trail: 'snippet.delete' },
      {}
    );
    expect(result.isError).toBe(true);
  });
});

describe('authored overlay / call-site override alignment', () => {
  test('the module overlay authors the same members the call-site map selects', () => {
    const overlay = trailsOverlays.find(
      (entry) => entry.namespace === 'surfaces'
    );
    const mcpBindings = overlay?.bindings.mcp ?? {};

    expect(Object.keys(mcpBindings).toSorted()).toEqual(
      Object.keys(stashTrailheads).toSorted()
    );
    for (const [name, definition] of Object.entries(stashTrailheads)) {
      expect(mcpBindings[name]).toEqual(definition.trails);
    }
  });
});
