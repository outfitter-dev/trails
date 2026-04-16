import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { createMcpServer, createServer, trailhead } from '../trailhead.js';
import { buildMcpTools, deriveMcpTools } from '../build.js';
import type { McpToolDefinition } from '../build.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const unwrapOk = <T>(result: Result<T, Error>): T =>
  result.match({
    err: (error) => {
      throw error;
    },
    ok: (value) => value,
  });

const requireTool = (tools: McpToolDefinition[], name: string) => {
  const tool = tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  if (!tool) {
    throw new Error(`Expected tool: ${name}`);
  }
  return tool;
};

/**
 * Unwrap buildMcpTools result, throwing on error so test failures show up clearly.
 */
const buildTools = (
  ...args: Parameters<typeof buildMcpTools>
): McpToolDefinition[] => {
  const result = buildMcpTools(...args);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const createIntegrationTools = () => {
  const greetTrail = trail('greet', {
    blaze: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
    description: 'Greet someone',
    input: z.object({ name: z.string() }),
    intent: 'read',
  });

  const deleteTrail = trail('item.delete', {
    blaze: (_input) => Result.ok({ deleted: true }),
    description: 'Delete an item',
    input: z.object({ id: z.string() }),
    intent: 'destroy',
  });

  return buildTools(topo('myapp', { deleteTrail, greetTrail }));
};

describe('trailhead', () => {
  test('trailhead throws on invalid topo', async () => {
    const t = trail('broken', {
      blaze: () => Result.ok({}),
      crosses: ['nonexistent.trail'],
      input: z.object({}),
      output: z.object({}),
    });
    const app = topo('test', { t });
    await expect(trailhead(app)).rejects.toThrow(/validation/i);
  });

  test('trailhead skips validation when validate: false', async () => {
    const t = trail('broken', {
      blaze: () => Result.ok({}),
      crosses: ['nonexistent.trail'],
      input: z.object({}),
      output: z.object({}),
    });
    const app = topo('test', { t });
    const result = await Promise.race([
      trailhead(app, { validate: false }).then(() => 'resolved' as const),
      // oxlint-disable-next-line avoid-new -- Promise constructor needed for setTimeout-based timeout
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => {
          resolve('timeout');
        }, 50);
      }),
    ]);
    expect(['resolved', 'timeout']).toContain(result);
  });

  test('TrailheadMcpOptions accepts flattened identity and resource fields', () => {
    const opts: Parameters<typeof trailhead>[1] = {
      description: 'Test MCP server',
      name: 'testapp',
      resources: {},
      validate: false,
      version: '1.2.3',
    };
    expect(opts.description).toBe('Test MCP server');
    expect(opts.name).toBe('testapp');
    expect(opts.resources).toEqual({});
    expect(opts.validate).toBe(false);
    expect(opts.version).toBe('1.2.3');
  });

  test('createMcpServer registers tools that can be listed', () => {
    const echoTrail = trail('echo', {
      blaze: (input) => Result.ok({ reply: input.message }),
      description: 'Echo',
      input: z.object({ message: z.string() }),
      intent: 'read',
    });

    const app = topo('testapp', { echoTrail });
    const tools = buildTools(app);
    const server = createMcpServer(tools, {
      name: 'testapp',
      version: '0.1.0',
    });

    // Server is created successfully
    expect(server).toBeDefined();
  });

  test('createMcpServer handles multiple tools', () => {
    const echoTrail = trail('echo', {
      blaze: (input) => Result.ok({ reply: input.message }),
      description: 'Echo',
      input: z.object({ message: z.string() }),
    });

    const searchTrail = trail('search', {
      blaze: (input) => Result.ok({ results: [input.query] }),
      description: 'Search',
      input: z.object({ query: z.string() }),
      intent: 'read',
    });

    const app = topo('testapp', { echoTrail, searchTrail });
    const tools = buildTools(app);

    expect(tools).toHaveLength(2);

    const server = createMcpServer(tools, {
      name: 'testapp',
      version: '0.1.0',
    });
    expect(server).toBeDefined();
  });

  test('deriveMcpTools aliases buildMcpTools and createServer materializes the server', () => {
    const echoTrail = trail('echo', {
      blaze: (input) => Result.ok({ reply: input.message }),
      description: 'Echo',
      input: z.object({ message: z.string() }),
    });
    const app = topo('surface-api', { echoTrail });

    const tools = unwrapOk(deriveMcpTools(app));
    expect(tools).toHaveLength(1);

    const server = createServer(app, {
      description: 'Surface API smoke',
      version: '2.0.0',
    });
    expect(server).toBeDefined();
  });

  test('buildMcpTools + createMcpServer integration', () => {
    const tools = createIntegrationTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('myapp_greet');
    expect(names).toContain('myapp_item_delete');

    expect(requireTool(tools, 'myapp_greet').annotations?.readOnlyHint).toBe(
      true
    );
    expect(
      requireTool(tools, 'myapp_item_delete').annotations?.destructiveHint
    ).toBe(true);

    const server = createMcpServer(tools, {
      name: 'myapp',
      version: '1.0.0',
    });
    expect(server).toBeDefined();
  });
});
