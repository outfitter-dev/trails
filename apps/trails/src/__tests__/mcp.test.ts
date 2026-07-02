import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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

const makeTempDir = (): string =>
  mkdtempSync(join(tmpdir(), `trails-mcp-regrade-test-${Date.now()}-`));

const writeFile = (root: string, path: string, value: string): void => {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
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
      'trails_regrade',
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
      'trails_wayfind_diff',
      'trails_wayfind_errors',
      'trails_wayfind_examples',
      'trails_wayfind_impact',
      'trails_wayfind_nearby',
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
    const wayfindSearch = requireTool(tools, 'trails_wayfind_search');
    const regrade = requireTool(tools, 'trails_regrade');
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

    expect(wayfindSearch.description).toBe(
      'Find topo graph entities with typed filters'
    );
    expect(wayfindSearch.annotations).toMatchObject({
      readOnlyHint: true,
      title: 'Find topo graph entities with typed filters',
    });

    expect(regrade.description).toBe(
      'Run downstream migration checks and safe rewrites'
    );
    expect(regrade.annotations).toMatchObject({
      title: 'Run downstream migration checks and safe rewrites',
    });
    expect(regrade.inputSchema).toMatchObject({
      properties: {
        configPath: expect.objectContaining({ type: 'string' }),
        exclude: expect.objectContaining({
          items: expect.objectContaining({ type: 'string' }),
          type: 'array',
        }),
        from: expect.objectContaining({ type: 'string' }),
        to: expect.objectContaining({ type: 'string' }),
      },
      type: 'object',
    });
    expect(JSON.stringify(regrade.inputSchema)).toContain('disposition');
    expect(JSON.stringify(regrade.inputSchema)).toContain('forms');
    expect(JSON.stringify(regrade.inputSchema)).toContain(
      'preserve-current-live-api'
    );

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
    expect(shapedTrailIds).toContain('regrade');
    expect(shapedTrailIds).toContain('wayfind.errors');
    expect(shapedTrailIds).not.toContain('wayfind.outline');
    expect(shapedTrailIds).not.toContain('wayfind.query');
  });

  test('executes regrade through the MCP tool handler', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'export const facet = "facet";\nexport const facetId = facet;\n'
      );
      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const regrade = requireTool(tools, 'trails_regrade');

      const result = await regrade.handler(
        {
          from: 'facet',
          rootDir: dir,
          to: 'trailhead',
        },
        {}
      );

      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        readonly selectedClassIds?: readonly string[];
        readonly run?: {
          readonly ledger?: {
            readonly occurrences?: readonly {
              readonly disposition?: string;
              readonly form?: string;
              readonly verdict?: string;
            }[];
          };
          readonly preserveInventory?: readonly {
            readonly evidence?: readonly string[];
            readonly pattern?: string;
            readonly reason?: string;
            readonly source?: string;
          }[];
        };
      };
      expect(result.structuredContent).toMatchObject({
        run: {
          plan: { from: 'facet', to: 'trailhead' },
          preserveInventory: expect.arrayContaining([
            expect.objectContaining({
              evidence: expect.arrayContaining(['topo.facet:inspect']),
              paths: expect.arrayContaining(['**/*.ts']),
              pattern: expect.stringContaining('facetId'),
              reason: 'current-live-mcp-facet-field',
              source: 'derived-live-api',
            }),
          ]),
          report: { modified: 0, open: 0 },
        },
        scan: {
          byDirectory: [{ files: 1, path: 'src' }],
          byExtension: [{ extension: '.ts', files: 1 }],
          files: { matched: 1, scanned: 1, skipped: 1 },
        },
      });
      expect(structured.selectedClassIds).toContain(
        'ast-symbol-rename:v1-facet-trailhead:facet->trailhead'
      );
      expect(structured.selectedClassIds).toContain(
        'ast-symbol-rename:v1-facet-trailhead:facetId->trailheadId'
      );
      expect(structured.run?.ledger?.occurrences).toEqual([]);
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toContain(
        'facet'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('executes facet to trailhead dogfood reports through MCP', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/surface.md',
        'The facet docs mention facets. facetId stays review.\n'
      );
      writeFile(
        dir,
        'src/surface.ts',
        [
          'export const facet = "facet";',
          'export const facetId = facet;',
          'export const facets = [facet];',
          '',
        ].join('\n')
      );
      writeFile(dir, '.agents/notes/history.md', 'facet\n');
      writeFile(dir, '.agents/skills/trails/SKILL.md', 'facet\n');
      writeFile(dir, '.scratch/history.md', 'facet\n');
      writeFile(dir, 'plugin/skills/trails/SKILL.md', 'facet\n');

      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const regrade = requireTool(tools, 'trails_regrade');

      const result = await regrade.handler(
        {
          exclude: ['.agents/notes/**', '.scratch/**'],
          from: 'facet',
          includeEntries: 'all',
          rootDir: dir,
          to: 'trailhead',
        },
        {}
      );

      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        readonly entries?: readonly {
          readonly classId?: string;
          readonly outcome?: string;
          readonly path?: string;
          readonly reason?: string;
        }[];
        readonly run?: {
          readonly ledger?: {
            readonly forms?: Record<string, string>;
            readonly occurrences?: readonly {
              readonly form?: string;
              readonly path?: string;
              readonly replacement?: string;
              readonly verdict?: string;
            }[];
          };
          readonly plan?: {
            readonly from?: string;
            readonly id?: string;
            readonly scope?: { readonly exclude?: readonly string[] };
            readonly to?: string;
          };
          readonly report?: {
            readonly gate?: { readonly status?: string };
            readonly modified?: number;
            readonly open?: number;
          };
        };
        readonly selectedClassIds?: readonly string[];
      };

      expect(structured.selectedClassIds).toEqual(
        expect.arrayContaining([
          'ast-symbol-rename:v1-facet-trailhead:facet->trailhead',
          'ast-symbol-rename:v1-facet-trailhead:facetId->trailheadId',
          'ast-symbol-rename:v1-facet-trailhead:facets->trailheads',
          'v1-facet-trailhead',
        ])
      );
      expect(structured.run?.plan).toMatchObject({
        from: 'facet',
        id: 'v1-facet-trailhead',
        scope: { exclude: ['.agents/notes/**', '.scratch/**'] },
        to: 'trailhead',
      });
      expect(structured.run?.ledger?.forms).toMatchObject({
        facet: 'modified',
        facetId: 'deferred',
        facets: 'modified',
      });
      expect(structured.run?.ledger?.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            form: 'facet',
            path: '.agents/skills/trails/SKILL.md',
            replacement: 'trailhead',
            verdict: 'modified',
          }),
          expect.objectContaining({
            form: 'facetId',
            path: 'docs/surface.md',
            verdict: 'deferred',
          }),
        ])
      );
      expect(
        structured.run?.ledger?.occurrences?.map((entry) => entry.path)
      ).not.toContain('.agents/notes/history.md');
      expect(
        structured.run?.ledger?.occurrences?.map((entry) => entry.path)
      ).not.toContain('.scratch/history.md');
      expect(structured.run?.report).toMatchObject({
        gate: { status: 'open' },
        modified: 4,
        open: 5,
      });
      expect(structured.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            classId: 'ast-symbol-rename:v1-facet-trailhead:facet->trailhead',
            outcome: 'rewrite',
            path: 'src/surface.ts',
          }),
          expect.objectContaining({
            outcome: 'needs-review',
            path: 'docs/surface.md',
            reason: 'vocabulary-judgment-deferred',
          }),
        ])
      );
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        'The facet docs mention facets. facetId stays review.\n'
      );
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toBe(
        [
          'export const facet = "facet";',
          'export const facetId = facet;',
          'export const facets = [facet];',
          '',
        ].join('\n')
      );
      expect(
        readFileSync(join(dir, '.agents', 'notes', 'history.md'), 'utf8')
      ).toBe('facet\n');
      expect(
        readFileSync(
          join(dir, '.agents', 'skills', 'trails', 'SKILL.md'),
          'utf8'
        )
      ).toBe('facet\n');
      expect(readFileSync(join(dir, '.scratch', 'history.md'), 'utf8')).toBe(
        'facet\n'
      );
      expect(
        readFileSync(
          join(dir, 'plugin', 'skills', 'trails', 'SKILL.md'),
          'utf8'
        )
      ).toBe('facet\n');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('executes registry-backed regrade review forms through MCP', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/blaze.md',
        'The blaze path is safe.\nThe blazing path needs review.\n'
      );
      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const regrade = requireTool(tools, 'trails_regrade');

      const result = await regrade.handler(
        {
          from: 'blaze',
          rootDir: dir,
          to: 'implementation',
        },
        {}
      );

      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        readonly run?: {
          readonly ledger?: {
            readonly forms?: Record<string, string>;
            readonly occurrences?: readonly {
              readonly form?: string;
              readonly verdict?: string;
            }[];
          };
          readonly plan?: {
            readonly deferForms?: readonly string[];
            readonly id?: string;
          };
        };
      };
      expect(structured.run?.plan).toMatchObject({
        deferForms: expect.arrayContaining(['blazing']),
        id: 'v1-blaze-implementation',
      });
      expect(structured.run?.ledger?.forms).toMatchObject({
        blaze: 'modified',
        blazing: 'deferred',
      });
      expect(structured.run?.ledger?.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ form: 'blazing', verdict: 'deferred' }),
        ])
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps app-authored facet selectors explicit enough for review', () => {
    expect(trailsMcpFacets.inspect.trails).toContain('survey');
    expect(trailsMcpFacets.inspect.trails).not.toContain('survey.*');
    expect(Object.keys(trailsMcpFacets)).toEqual(['inspect']);
    expect(trailsMcpIncludedTrails).toContain('release.check');
    expect(trailsMcpIncludedTrails).toContain('release.smoke');
    expect(trailsMcpIncludedTrails).toContain('regrade');
    expect(trailsMcpIncludedTrails).toContain('warden');
    expect(trailsMcpIncludedTrails).toContain('wayfind.adapters');
    expect(trailsMcpIncludedTrails).toContain('wayfind.diff');
    expect(trailsMcpIncludedTrails).toContain('wayfind.errors');
    expect(trailsMcpIncludedTrails).not.toContain('wayfind.outline');
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
    const regradeGraphUri = `${MCP_TRAIL_RESOURCE_PREFIX}${encodeURIComponent('regrade')}`;

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
    expect(resources.list.map((resource) => resource.uri)).toContain(
      regradeGraphUri
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
    const regradeGraph = parseJson(resources.read(regradeGraphUri)?.text) as {
      readonly intent?: string | undefined;
      readonly tools?: readonly {
        readonly name?: string | undefined;
        readonly trailId?: string | undefined;
      }[];
      readonly trailId?: string | undefined;
    };
    expect(regradeGraph).toMatchObject({
      intent: 'write',
      trailId: 'regrade',
    });
    expect(regradeGraph.tools).toEqual([
      expect.objectContaining({
        name: 'trails_regrade',
        trailId: 'regrade',
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
