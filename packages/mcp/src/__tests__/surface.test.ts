import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { createServer, surface } from '../surface.js';
import { deriveMcpTools } from '../build.js';
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
 * Unwrap deriveMcpTools result, throwing on error so test failures show up clearly.
 */
const deriveTools = (
  ...args: Parameters<typeof deriveMcpTools>
): McpToolDefinition[] => {
  const result = deriveMcpTools(...args);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const createIntegrationFixtures = () => {
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

  const app = topo('myapp', { deleteTrail, greetTrail });
  return { app, tools: deriveTools(app) };
};

describe('surface', () => {
  test('surface throws on invalid topo', async () => {
    const t = trail('broken', {
      blaze: () => Result.ok({}),
      crosses: ['nonexistent.trail'],
      input: z.object({}),
      output: z.object({}),
    });
    const app = topo('test', { t });
    await expect(surface(app)).rejects.toThrow(/validation/i);
  });

  test('surface skips validation when validate: false', async () => {
    const t = trail('broken', {
      blaze: () => Result.ok({}),
      crosses: ['nonexistent.trail'],
      input: z.object({}),
      output: z.object({}),
    });
    const app = topo('test', { t });
    const result = await Promise.race([
      surface(app, { validate: false }).then(() => 'resolved' as const),
      // oxlint-disable-next-line avoid-new -- Promise constructor needed for setTimeout-based timeout
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => {
          resolve('timeout');
        }, 50);
      }),
    ]);
    expect(['resolved', 'timeout']).toContain(result);
  });

  test('CreateServerOptions accepts flattened identity and resource fields', () => {
    const opts: Parameters<typeof surface>[1] = {
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

  test('createServer registers tools that can be listed', () => {
    const echoTrail = trail('echo', {
      blaze: (input) => Result.ok({ reply: input.message }),
      description: 'Echo',
      input: z.object({ message: z.string() }),
      intent: 'read',
    });

    const app = topo('testapp', { echoTrail });
    const server = createServer(app, {
      name: 'testapp',
      version: '0.1.0',
    });

    // Server is created successfully
    expect(server).toBeDefined();
  });

  test('createServer handles multiple tools', () => {
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
    const tools = deriveTools(app);

    expect(tools).toHaveLength(2);

    const server = createServer(app, {
      name: 'testapp',
      version: '0.1.0',
    });
    expect(server).toBeDefined();
  });

  test('deriveMcpTools returns tools and createServer materializes the server', () => {
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

  test('deriveMcpTools + createServer integration', () => {
    const { app, tools } = createIntegrationFixtures();
    const names = tools.map((t) => t.name);
    expect(names).toContain('myapp_greet');
    expect(names).toContain('myapp_item_delete');

    expect(requireTool(tools, 'myapp_greet').annotations?.readOnlyHint).toBe(
      true
    );
    expect(
      requireTool(tools, 'myapp_item_delete').annotations?.destructiveHint
    ).toBe(true);

    const server = createServer(app, {
      name: 'myapp',
      version: '1.0.0',
    });
    expect(server).toBeDefined();
  });
});
