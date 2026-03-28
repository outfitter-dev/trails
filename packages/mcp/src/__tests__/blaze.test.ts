import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { createMcpServer } from '../blaze.js';
import { buildMcpTools } from '../build.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const requireTool = (tools: ReturnType<typeof buildMcpTools>, name: string) => {
  const tool = tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  if (!tool) {
    throw new Error(`Expected tool: ${name}`);
  }
  return tool;
};

const createIntegrationTools = () => {
  const greetTrail = trail('greet', {
    description: 'Greet someone',
    input: z.object({ name: z.string() }),
    intent: 'read',
    run: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
  });

  const deleteTrail = trail('item.delete', {
    description: 'Delete an item',
    input: z.object({ id: z.string() }),
    intent: 'destroy',
    run: (_input) => Result.ok({ deleted: true }),
  });

  return buildMcpTools(topo('myapp', { deleteTrail, greetTrail }));
};

describe('blaze', () => {
  test('createMcpServer registers tools that can be listed', () => {
    const echoTrail = trail('echo', {
      description: 'Echo',
      input: z.object({ message: z.string() }),
      intent: 'read',
      run: (input) => Result.ok({ reply: input.message }),
    });

    const app = topo('testapp', { echoTrail });
    const tools = buildMcpTools(app);
    const server = createMcpServer(tools, {
      name: 'testapp',
      version: '0.1.0',
    });

    // Server is created successfully
    expect(server).toBeDefined();
  });

  test('createMcpServer handles multiple tools', () => {
    const echoTrail = trail('echo', {
      description: 'Echo',
      input: z.object({ message: z.string() }),
      run: (input) => Result.ok({ reply: input.message }),
    });

    const searchTrail = trail('search', {
      description: 'Search',
      input: z.object({ query: z.string() }),
      intent: 'read',
      run: (input) => Result.ok({ results: [input.query] }),
    });

    const app = topo('testapp', { echoTrail, searchTrail });
    const tools = buildMcpTools(app);

    expect(tools).toHaveLength(2);

    const server = createMcpServer(tools, {
      name: 'testapp',
      version: '0.1.0',
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
