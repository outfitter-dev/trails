import { describe, expect, test } from 'bun:test';

import {
  MCP_EXAMPLES_RESOURCE_PREFIX,
  MCP_SURFACE_MAP_RESOURCE_URI,
  MCP_TRAIL_RESOURCE_PREFIX,
  MCP_TOOL_DEFERRED_META_KEY,
  buildMcpResources,
  deriveMcpTools,
} from '@ontrails/mcp';

import { trailsMcpApp } from '../mcp-app.js';
import {
  trailsMcpFacets,
  trailsMcpIncludedTrails,
  trailsMcpSurfaceOptions,
} from '../mcp-options.js';

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

const requireTool = (
  tools: ReturnType<typeof unwrapTools>,
  name: string
): ReturnType<typeof unwrapTools>[number] => {
  const tool = tools.find((item) => item.name === name);
  expect(tool).toBeDefined();
  return tool as ReturnType<typeof unwrapTools>[number];
};

describe('Trails MCP surface shaping', () => {
  test('projects selected high-signal operator and Wayfinder tools directly', () => {
    const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);

    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      'trails_adapter_check',
      'trails_add_surface',
      'trails_add_trail',
      'trails_compile',
      'trails_create',
      'trails_create_adapter',
      'trails_deprecate',
      'trails_dev_clean',
      'trails_dev_reset',
      'trails_dev_stats',
      'trails_doctor',
      'trails_draft_promote',
      'trails_inspect',
      'trails_release_check',
      'trails_release_smoke',
      'trails_revise',
      'trails_run',
      'trails_run_example',
      'trails_run_examples',
      'trails_topo_pin',
      'trails_topo_unpin',
      'trails_validate',
      'trails_warden',
      'trails_warden_guide',
      'trails_wayfind_adapters',
      'trails_wayfind_contract',
      'trails_wayfind_errors',
      'trails_wayfind_examples',
      'trails_wayfind_impact',
      'trails_wayfind_nearby',
      'trails_wayfind_outline',
      'trails_wayfind_overview',
      'trails_wayfind_search',
      'trails_wayfind_trails',
    ]);

    const inspectTool = requireTool(tools, 'trails_inspect');
    expect(inspectTool?.trailId).toBeUndefined();
    expect(inspectTool?.facetId).toBe('inspect');
    expect(inspectTool?.memberTrailIds?.toSorted()).toEqual([
      'guide',
      'survey',
      'survey.brief',
      'survey.diff',
      'survey.resource',
      'survey.signal',
      'survey.surfaces',
      'survey.trail',
      'topo',
      'topo.history',
    ]);
    expect(inspectTool?._meta?.[MCP_TOOL_DEFERRED_META_KEY]).toBe(true);
    expect(inspectTool?.inputSchema).toMatchObject({
      required: ['trail', 'input'],
      type: 'object',
    });

    for (const tool of tools.filter((item) => item.name !== 'trails_inspect')) {
      expect(tool.trailId).toBeDefined();
      expect(tool.facetId).toBeUndefined();
      expect(tool.memberTrailIds).toBeUndefined();
      expect(tool._meta?.[MCP_TOOL_DEFERRED_META_KEY]).toBeUndefined();
    }
  });

  test('preserves MCP descriptions and permission annotations', () => {
    const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
    const wayfindAdapters = requireTool(tools, 'trails_wayfind_adapters');
    const wayfindErrors = requireTool(tools, 'trails_wayfind_errors');
    const wayfindOutline = requireTool(tools, 'trails_wayfind_outline');
    const wayfindSearch = requireTool(tools, 'trails_wayfind_search');
    const warden = requireTool(tools, 'trails_warden');
    const devClean = requireTool(tools, 'trails_dev_clean');
    const topoUnpin = requireTool(tools, 'trails_topo_unpin');
    const inspect = requireTool(tools, 'trails_inspect');

    expect(wayfindAdapters.description).toBe(
      'List adapter facts with package and conformance provenance'
    );
    expect(wayfindAdapters.annotations).toMatchObject({
      readOnlyHint: true,
      title: 'List adapter facts with package and conformance provenance',
    });

    expect(wayfindErrors.description).toBe(
      'List saved trail error facts with provenance'
    );
    expect(wayfindErrors.annotations).toMatchObject({
      readOnlyHint: true,
      title: 'List saved trail error facts with provenance',
    });

    expect(wayfindOutline.description).toBe(
      'Outline one source file and connect source structure to saved Trails graph facts'
    );
    expect(wayfindOutline.annotations).toMatchObject({
      readOnlyHint: true,
      title:
        'Outline one source file and connect source structure to saved Trails graph facts',
    });

    expect(wayfindSearch.description).toBe(
      'Find topo graph entities with typed filters'
    );
    expect(wayfindSearch.annotations).toMatchObject({
      readOnlyHint: true,
      title: 'Find topo graph entities with typed filters',
    });

    expect(warden.description).toBe('Run governance checks (lint + drift)');
    expect(warden.annotations).toEqual({
      title: 'Run governance checks (lint + drift)',
    });

    expect(devClean.annotations).toMatchObject({
      destructiveHint: true,
      title: 'Prune unpinned topo snapshots and old trace records',
    });
    expect(topoUnpin.annotations).toMatchObject({
      destructiveHint: true,
      title: 'Remove a named topo pin',
    });
    expect(inspect.description).toBe(
      'Inspect saved topo structure, resources, signals, surfaces, and diffs.'
    );
    expect(inspect.annotations).toMatchObject({
      readOnlyHint: true,
      title:
        'Inspect saved topo structure, resources, signals, surfaces, and diffs.',
    });
  });

  test('projects only the selected trail IDs without shell or generic Wayfinder tools', () => {
    const shapedTools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
    const shapedTrailIds = shapedTools
      .flatMap((tool) =>
        tool.trailId === undefined ? (tool.memberTrailIds ?? []) : tool.trailId
      )
      .toSorted();

    expect(shapedTrailIds).toEqual([...trailsMcpIncludedTrails].toSorted());
    expect(shapedTrailIds).not.toContain('add.verify');
    expect(shapedTrailIds).not.toContain('create.scaffold');
    expect(shapedTrailIds).not.toContain('completions');
    expect(shapedTrailIds).not.toContain('completions.__complete');
    expect(shapedTrailIds).toContain('wayfind.adapters');
    expect(shapedTrailIds).toContain('wayfind.errors');
    expect(shapedTrailIds).toContain('wayfind.outline');
    expect(shapedTrailIds).not.toContain('wayfind.query');
  });

  test('keeps app-authored facet selectors explicit enough for review', () => {
    expect(trailsMcpFacets.inspect.trails).toContain('survey');
    expect(trailsMcpFacets.inspect.trails).not.toContain('survey.*');
    expect(Object.keys(trailsMcpFacets)).toEqual(['inspect']);
    expect(trailsMcpIncludedTrails).toContain('release.check');
    expect(trailsMcpIncludedTrails).toContain('release.smoke');
    expect(trailsMcpIncludedTrails).toContain('warden');
    expect(trailsMcpIncludedTrails).toContain('wayfind.adapters');
    expect(trailsMcpIncludedTrails).toContain('wayfind.errors');
    expect(trailsMcpIncludedTrails).toContain('wayfind.outline');
    expect(trailsMcpIncludedTrails).toContain('wayfind.search');
  });

  test('exposes cold context resources for the shaped surface', () => {
    const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
    const resources = buildMcpResources(
      trailsMcpApp,
      tools,
      trailsMcpSurfaceOptions.mcpResources
    );
    const surfaceMap = resources.read(MCP_SURFACE_MAP_RESOURCE_URI);
    const runExampleUri = `${MCP_EXAMPLES_RESOURCE_PREFIX}${encodeURIComponent('run.example')}`;
    const wayfindSearchGraphUri = `${MCP_TRAIL_RESOURCE_PREFIX}${encodeURIComponent('wayfind.search')}`;

    expect(resources.list.map((resource) => resource.uri)).toContain(
      MCP_SURFACE_MAP_RESOURCE_URI
    );
    expect(resources.list.map((resource) => resource.uri)).toContain(
      runExampleUri
    );
    expect(resources.list.map((resource) => resource.uri)).toContain(
      `${MCP_EXAMPLES_RESOURCE_PREFIX}${encodeURIComponent('wayfind.search')}`
    );
    expect(resources.list.map((resource) => resource.uri)).toContain(
      wayfindSearchGraphUri
    );
    const wayfindSearchGraph = parseJson(
      resources.read(wayfindSearchGraphUri)?.text
    ) as {
      readonly intent?: string | undefined;
      readonly surface?: string | undefined;
      readonly tools?: readonly {
        readonly name?: string | undefined;
        readonly trailId?: string | undefined;
      }[];
      readonly trailId?: string | undefined;
      readonly visibility?: string | undefined;
    };
    expect(wayfindSearchGraph).toMatchObject({
      intent: 'read',
      surface: 'mcp',
      trailId: 'wayfind.search',
      visibility: 'internal',
    });
    expect(wayfindSearchGraph.tools).toEqual([
      expect.objectContaining({
        name: 'trails_wayfind_search',
        trailId: 'wayfind.search',
      }),
    ]);
    const projectedMap = parseJson(surfaceMap?.text) as {
      readonly tools?: readonly {
        readonly deferred?: boolean | undefined;
        readonly facetId?: string | undefined;
        readonly name?: string | undefined;
        readonly trailId?: string | undefined;
      }[];
    };
    expect(
      projectedMap.tools?.find((tool) => tool.facetId === 'inspect')
    ).toEqual(
      expect.objectContaining({
        deferred: true,
        facetId: 'inspect',
        name: 'trails_inspect',
      })
    );
    expect(
      projectedMap.tools?.find((tool) => tool.name === 'trails_wayfind_search')
    ).toEqual(
      expect.objectContaining({
        name: 'trails_wayfind_search',
        trailId: 'wayfind.search',
      })
    );
  });
});
