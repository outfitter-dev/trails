import { describe, expect, test } from 'bun:test';

import {
  MCP_EXAMPLES_RESOURCE_PREFIX,
  MCP_SURFACE_MAP_RESOURCE_URI,
  MCP_TOOL_DEFERRED_META_KEY,
  buildMcpResources,
  deriveMcpTools,
} from '@ontrails/mcp';

import { app } from '../app.js';
import { trailsMcpFacets, trailsMcpSurfaceOptions } from '../mcp-options.js';

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

describe('Trails MCP surface shaping', () => {
  test('projects the Trails operator app as deferred facet tools', () => {
    const tools = unwrapTools(app, trailsMcpSurfaceOptions);

    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      'trails_artifacts',
      'trails_authoring',
      'trails_execution',
      'trails_governance',
      'trails_inspect',
      'trails_shell',
      'trails_workspace',
    ]);

    for (const tool of tools) {
      expect(tool.trailId).toBeUndefined();
      expect(tool.facetId).toBeDefined();
      expect(tool.memberTrailIds?.length).toBeGreaterThan(0);
      expect(tool._meta?.[MCP_TOOL_DEFERRED_META_KEY]).toBe(true);
      expect(tool.inputSchema).toMatchObject({
        required: ['trail', 'input'],
        type: 'object',
      });
    }
  });

  test('accounts for every public operator trail without widening internal trails', () => {
    const rawTools = unwrapTools(app);
    const shapedTools = unwrapTools(app, trailsMcpSurfaceOptions);
    const rawTrailIds = rawTools
      .map((tool) => tool.trailId)
      .filter((trailId) => trailId !== undefined)
      .toSorted();
    const shapedTrailIds = shapedTools
      .flatMap((tool) => tool.memberTrailIds ?? [])
      .toSorted();

    expect(shapedTrailIds).toEqual(rawTrailIds);
    expect(shapedTrailIds).not.toContain('add.verify');
    expect(shapedTrailIds).not.toContain('create.scaffold');
  });

  test('keeps app-authored facet selectors explicit enough for review', () => {
    expect(trailsMcpFacets.inspect.trails).toContain('survey');
    expect(trailsMcpFacets.inspect.trails).not.toContain('survey.*');
    expect(trailsMcpFacets.authoring.trails).toContain('draft.promote');
    expect(trailsMcpFacets.workspace.trails).toEqual([
      'dev.stats',
      'dev.clean',
      'dev.reset',
    ]);
  });

  test('exposes cold context resources for the shaped surface', () => {
    const tools = unwrapTools(app, trailsMcpSurfaceOptions);
    const resources = buildMcpResources(
      app,
      tools,
      trailsMcpSurfaceOptions.mcpResources
    );
    const surfaceMap = resources.read(MCP_SURFACE_MAP_RESOURCE_URI);
    const runExampleUri = `${MCP_EXAMPLES_RESOURCE_PREFIX}${encodeURIComponent('run.example')}`;

    expect(resources.list.map((resource) => resource.uri)).toContain(
      MCP_SURFACE_MAP_RESOURCE_URI
    );
    expect(resources.list.map((resource) => resource.uri)).toContain(
      runExampleUri
    );
    const projectedMap = parseJson(surfaceMap?.text) as {
      readonly tools?: readonly {
        readonly deferred?: boolean | undefined;
        readonly facetId?: string | undefined;
        readonly name?: string | undefined;
      }[];
    };
    expect(
      projectedMap.tools?.find((tool) => tool.facetId === 'artifacts')
    ).toEqual(
      expect.objectContaining({
        deferred: true,
        facetId: 'artifacts',
        name: 'trails_artifacts',
      })
    );
  });
});
