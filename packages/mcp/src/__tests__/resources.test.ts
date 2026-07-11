import { describe, expect, test } from 'bun:test';

import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { MCP_TOOL_DEFERRED_META_KEY, deriveMcpTools } from '../build.js';
import {
  MCP_EXAMPLES_RESOURCE_PREFIX,
  MCP_SURFACE_MAP_RESOURCE_URI,
  buildMcpResources,
} from '../resources.js';

const unwrapTools = (...args: Parameters<typeof deriveMcpTools>) => {
  const result = deriveMcpTools(...args);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const parseJson = (text: string | undefined): unknown => {
  expect(text).toBeDefined();
  return JSON.parse(text ?? 'null');
};

describe('buildMcpResources', () => {
  test('projects a surface map resource with trailheaded tool metadata', () => {
    const readTopo = trail('topo.read', {
      description: 'Read topo.',
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const app = topo('myapp', { readTopo });
    const tools = unwrapTools(app, {
      trailheads: {
        topo: {
          description: 'Read topo state.',
          mcp: { loading: 'deferred' },
          trails: 'topo.*',
        },
      },
    });

    const resources = buildMcpResources(app, tools);
    const surfaceMap = resources.read(MCP_SURFACE_MAP_RESOURCE_URI);

    expect(resources.list.map((resource) => resource.uri)).toContain(
      MCP_SURFACE_MAP_RESOURCE_URI
    );
    expect(parseJson(surfaceMap?.text)).toMatchObject({
      surface: 'mcp',
      tools: [
        {
          deferred: true,
          memberTrailIds: ['topo.read'],
          name: 'myapp_topo',
          trailheadId: 'topo',
        },
      ],
    });
    expect(tools[0]?._meta?.[MCP_TOOL_DEFERRED_META_KEY]).toBe(true);
  });

  test('projects examples for trails exposed through a trailhead', () => {
    const readTopo = trail('topo.read', {
      examples: [
        {
          expected: { id: 'topo-1' },
          input: { id: 'topo-1' },
          name: 'basic',
        },
      ],
      implementation: (input) => Result.ok({ id: input.id }),
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
    });
    const app = topo('myapp', { readTopo });
    const tools = unwrapTools(app, {
      trailheads: {
        topo: {
          description: 'Read topo state.',
          trails: 'topo.*',
        },
      },
    });
    const resources = buildMcpResources(app, tools);
    const uri = `${MCP_EXAMPLES_RESOURCE_PREFIX}${encodeURIComponent('topo.read')}`;
    const content = resources.read(uri);

    expect(resources.list.map((resource) => resource.uri)).toContain(uri);
    expect(parseJson(content?.text)).toMatchObject({
      examples: [
        {
          expected: { id: 'topo-1' },
          input: { id: 'topo-1' },
          kind: 'success',
          name: 'basic',
        },
      ],
      trailId: 'topo.read',
    });
  });

  test('can disable surface map and example resources', () => {
    const readTopo = trail('topo.read', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
    });
    const app = topo('myapp', { readTopo });
    const resources = buildMcpResources(app, unwrapTools(app), {
      examples: false,
      surfaceMap: false,
    });

    expect(resources.list).toEqual([]);
    expect(resources.read(MCP_SURFACE_MAP_RESOURCE_URI)).toBeUndefined();
  });
});
