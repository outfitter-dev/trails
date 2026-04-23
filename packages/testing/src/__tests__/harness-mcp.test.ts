import { describe, expect, test } from 'bun:test';

import { resource, Result, topo, trail } from '@ontrails/core';
import { deriveToolName } from '@ontrails/mcp';
import { z } from 'zod';

import { createMcpHarness } from '../harness-mcp.js';

describe('createMcpHarness', () => {
  test('threads resource overrides through MCP projection options', async () => {
    const dbResource = resource('db.main', {
      create: () => Result.ok({ source: 'factory' }),
    });
    const readResource = trail('resource.read', {
      blaze: (_input, ctx) =>
        Result.ok({ source: dbResource.from(ctx).source as string }),
      input: z.object({}),
      output: z.object({ source: z.string() }),
      resources: [dbResource],
    });
    const graph = topo('test-app', { dbResource, readResource });
    const harness = createMcpHarness({
      graph,
      resources: {
        'db.main': { source: 'override' },
      },
    });

    const result = await harness.callTool(
      deriveToolName(graph.name, readResource.id),
      {}
    );

    expect(result.isError).toBe(false);
    expect(JSON.stringify(result.content)).toContain('override');
  });
});
