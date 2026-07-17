import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  createTrailContext,
  resolveSurfaceOverlayBindings,
} from '@ontrails/core';
import {
  MCP_EXAMPLES_RESOURCE_PREFIX,
  MCP_SURFACE_MAP_RESOURCE_URI,
  MCP_TRAIL_RESOURCE_PREFIX,
  MCP_TOOL_DEFERRED_META_KEY,
  buildMcpResources,
  deriveMcpTools,
} from '@ontrails/mcp';
import {
  getGovernedVocabularyTransition,
  trailheadOverrideDivergenceTrail,
} from '@ontrails/warden';

import { trailsOverlays } from '../app.js';
import { trailsMcpApp } from '../mcp-app.js';
import {
  trailsMcpTrailheads,
  trailsMcpIncludedTrails,
  trailsMcpSurfaceOptions,
} from '../mcp-options.js';
import { planRegradeTrail } from '../trails/regrade.js';
import { wayfindOutlineTrail } from '../trails/wayfind-outline.js';

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

const makeTempDir = (): string => {
  const dir = mkdtempSync(
    join(tmpdir(), `trails-mcp-regrade-test-${Date.now()}-`)
  );
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Trails Test',
      '-c',
      'user.email=trails@example.test',
      'commit',
      '--allow-empty',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: dir }
  );
  return dir;
};
const facetTrailheadRegistryExcludes = [
  '.scratch/**',
  '**/.scratch/**',
  '**/.tmp-tests/**',
];

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
  test('renders selected high-signal operator and Wayfinder tools directly', () => {
    const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);

    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      'trails_adapter_check',
      'trails_add_surface',
      'trails_add_trail',
      'trails_adjust_regrade',
      'trails_apply_regrade',
      'trails_audit_regrade',
      'trails_check_regrade',
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
      'trails_list_regrades',
      'trails_plan_regrade',
      'trails_preview_regrade',
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
    expect(inspectTool?.trailheadId).toBe('inspect');
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
      expect(tool.trailheadId).toBeUndefined();
      expect(tool.memberTrailIds).toBeUndefined();
      expect(tool._meta?.[MCP_TOOL_DEFERRED_META_KEY]).toBeUndefined();
    }
  });

  test('preserves MCP descriptions and permission annotations', () => {
    const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
    const wayfindAdapters = requireTool(tools, 'trails_wayfind_adapters');
    const wayfindErrors = requireTool(tools, 'trails_wayfind_errors');
    const wayfindSearch = requireTool(tools, 'trails_wayfind_search');
    const planRegrade = requireTool(tools, 'trails_plan_regrade');
    const applyRegrade = requireTool(tools, 'trails_apply_regrade');
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

    expect(planRegrade.description).toBe(
      'Write or update a reviewed Regrade plan'
    );
    expect(planRegrade.annotations).toMatchObject({
      title: 'Write or update a reviewed Regrade plan',
    });
    expect(planRegrade.inputSchema).toMatchObject({
      properties: {
        configPath: expect.objectContaining({ type: 'string' }),
        exclude: expect.objectContaining({
          items: expect.objectContaining({ type: 'string' }),
          type: 'array',
        }),
        fileRenames: expect.objectContaining({ type: 'array' }),
        from: expect.objectContaining({ type: 'string' }),
        policyClassified: expect.objectContaining({ type: 'array' }),
        teachingSurfaces: expect.objectContaining({ type: 'array' }),
        to: expect.objectContaining({ type: 'string' }),
      },
      type: 'object',
    });
    expect(JSON.stringify(planRegrade.inputSchema)).toContain('disposition');
    expect(JSON.stringify(planRegrade.inputSchema)).toContain('forms');
    expect(JSON.stringify(planRegrade.inputSchema)).toContain(
      'preserve-current-live-api'
    );
    expect(applyRegrade.description).toBe(
      'Apply a saved Regrade plan and move it to history'
    );
    expect(applyRegrade.inputSchema).toMatchObject({
      properties: {
        includeEntries: expect.objectContaining({ type: 'string' }),
        plan: expect.objectContaining({ type: 'string' }),
        rootDir: expect.objectContaining({ type: 'string' }),
      },
      type: 'object',
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

  test('renders only the selected trail IDs without shell or generic Wayfinder tools', () => {
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
    expect(shapedTrailIds).toContain('plan.regrade');
    expect(shapedTrailIds).toContain('apply.regrade');
    expect(shapedTrailIds).toContain('wayfind.errors');
    expect(shapedTrailIds).not.toContain('wayfind.outline');
    expect(shapedTrailIds).not.toContain('wayfind.query');
  });

  test('keeps the app-owned outline contract in the MCP operator topo', () => {
    expect(trailsMcpApp.get('wayfind.outline')).toBe(wayfindOutlineTrail);
    expect(trailsMcpIncludedTrails).not.toContain('wayfind.outline');
  });

  test('executes regrade plan and preview through MCP tool handlers', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/surface.ts',
        'export const facet = "facet";\nexport const facetId = facet;\n'
      );
      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const planRegrade = requireTool(tools, 'trails_plan_regrade');
      const previewRegrade = requireTool(tools, 'trails_preview_regrade');

      const planResult = await planRegrade.handler(
        {
          from: 'facet',
          rootDir: dir,
          to: 'trailhead',
        },
        {}
      );

      expect(planResult.isError).toBeUndefined();
      expect(planResult.structuredContent).toMatchObject({
        derivation: {
          forms: expect.arrayContaining([
            expect.objectContaining({
              from: 'facet',
              provenance: 'authored',
              to: 'trailhead',
            }),
          ]),
        },
        kind: 'regrade-plan',
        path: '.trails/regrade/facet-to-trailhead.json',
        plan: { from: 'facet', to: 'trailhead' },
      });
      const result = await previewRegrade.handler({ rootDir: dir }, {});

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
        plan: {
          path: '.trails/regrade/facet-to-trailhead.json',
          status: 'active',
        },
        run: {
          plan: { from: 'facet', to: 'trailhead' },
          report: {
            dispositions: {
              'code-context-out-of-engine': 1,
              'historical-by-policy': 14,
            },
            gate: {
              remaining: 1,
              status: 'open',
            },
            modified: 1,
            open: 1,
            scopeTiers: { 'in-scope': 1, 'policy-classified': 14 },
          },
        },
        scan: {
          byDirectory: [{ files: 1, path: 'src' }],
          byExtension: [{ extension: '.ts', files: 1 }],
          files: { matched: 1, scanned: 2, skipped: 2 },
        },
      });
      expect(result.structuredContent).toMatchObject({
        scan: {
          files: { skipped: 2 },
          skippedByReason: {
            'ignored-directory': 2,
          },
        },
      });
      expect(structured.selectedClassIds).toContain(
        'ast-symbol-rename:v1-facet-trailhead:facet->trailhead'
      );
      expect(structured.selectedClassIds).toContain(
        'ast-symbol-rename:v1-facet-trailhead:facetId->trailheadId'
      );
      expect(structured.run?.ledger?.occurrences).toHaveLength(14);
      expect(structured.run?.ledger?.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: '.trails/regrade/facet-to-trailhead.json',
            scopeTier: 'policy-classified',
            verdict: 'skipped',
          }),
        ])
      );
      expect(readFileSync(join(dir, 'src', 'surface.ts'), 'utf8')).toContain(
        'facetId'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('seeds classified governed Regrade plans through MCP', async () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Projection docs project facts.\n');
      const transition = getGovernedVocabularyTransition(
        'v1-projection-derive-render'
      );
      expect(transition).toBeDefined();
      for (const rename of transition?.fileRenames ?? []) {
        writeFile(dir, rename.from, '');
      }
      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const planRegrade = requireTool(tools, 'trails_plan_regrade');
      const progress: { readonly current: number; readonly total: number }[] =
        [];

      const result = await planRegrade.handler(
        { from: 'projection', rootDir: dir, to: 'render' },
        {
          progressToken: 'regrade-plan',
          sendProgress: async (current, total) => {
            progress.push({ current, total });
          },
        }
      );

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        derivation: {
          forms: expect.arrayContaining([
            expect.objectContaining({
              from: 'projection',
              kind: 'review',
              source: 'plan-defer',
            }),
          ]),
        },
        lifecycle: {
          durationMs: expect.any(Number),
          phases: [
            expect.objectContaining({ name: 'resolve-root' }),
            expect.objectContaining({ name: 'load-config' }),
            expect.objectContaining({ name: 'derive-plan' }),
          ],
        },
        path: '.trails/regrade/v1-projection-derive-render.json',
        plan: {
          deferForms: [
            'projection',
            'projections',
            'project',
            'projects',
            'Projects',
            'projecting',
            'Projecting',
            'projected',
            'Projected',
          ],
          id: 'v1-projection-derive-render',
          to: 'render',
        },
      });
      expect(JSON.stringify(result.structuredContent)).not.toContain(
        '"safe-rewrite"'
      );
      expect(progress).toContainEqual({ current: 0, total: 1 });
      expect(progress).toContainEqual({ current: 1, total: 1 });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('MCP inventories the same structured classified TSDoc review entry', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/project.ts',
        [
          '/**',
          ' * Project an error through the shared public policy.',
          ' */',
          '// Use the project root consistently.',
          'export const project = 1;',
          '',
        ].join('\n')
      );
      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const planRegrade = requireTool(tools, 'trails_plan_regrade');
      const previewRegrade = requireTool(tools, 'trails_preview_regrade');
      const plan = await planRegrade.handler(
        { from: 'projection', rootDir: dir, to: 'derive' },
        {}
      );
      expect(plan.isError).toBeUndefined();

      const preview = await previewRegrade.handler({ rootDir: dir }, {});
      expect(preview.isError).toBeUndefined();
      expect(preview.structuredContent).toMatchObject({
        entries: [
          {
            outcome: 'needs-review',
            path: 'src/project.ts',
            reason: 'vocabulary-judgment-deferred',
            reviewDetails: [
              expect.objectContaining({
                context: '* Project an error through the shared public policy.',
                judgment: 'unresolved',
                matchedForm: 'Project',
                nodeKind: 'TSDocComment',
                reason: 'source-comment-requires-review',
                span: expect.objectContaining({ line: 2 }),
              }),
            ],
          },
        ],
        run: {
          ledger: {
            occurrences: expect.arrayContaining([
              expect.objectContaining({
                form: 'Project',
                path: 'src/project.ts',
                sourceKind: 'tsdoc',
                verdict: 'deferred',
              }),
              expect.objectContaining({
                form: 'project',
                path: 'src/project.ts',
                sourceKind: 'source-comment',
                verdict: 'skipped',
              }),
            ]),
          },
          report: {
            gate: { remaining: 1, status: 'open' },
          },
        },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('executes governed file moves through MCP plan, preview, and apply', async () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/old.md', '# Old\n');
      writeFile(dir, 'docs/index.md', '[Old](docs/old.md)\n');
      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const planRegrade = requireTool(tools, 'trails_plan_regrade');
      const checkRegrade = requireTool(tools, 'trails_check_regrade');
      const previewRegrade = requireTool(tools, 'trails_preview_regrade');
      const applyRegrade = requireTool(tools, 'trails_apply_regrade');

      const plan = await planRegrade.handler(
        {
          fileRenames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
          from: 'alpha',
          rootDir: dir,
          to: 'omega',
        },
        {}
      );
      expect(plan.isError).toBeUndefined();
      expect(plan.structuredContent).toMatchObject({
        plan: {
          fileRenames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
        },
      });

      const preview = await previewRegrade.handler({ rootDir: dir }, {});
      expect(preview.isError).toBeUndefined();
      expect(preview.structuredContent).toMatchObject({
        run: {
          report: {
            fileRenames: [
              expect.objectContaining({
                from: 'docs/old.md',
                rewritten: 1,
                to: 'docs/new.md',
              }),
            ],
          },
        },
      });

      const preApplyCheck = await checkRegrade.handler({ rootDir: dir }, {});
      expect(preApplyCheck.isError).toBe(true);

      writeFile(dir, 'docs/later.md', '[Old](docs/old.md)\n');
      const stalePreview = await previewRegrade.handler({ rootDir: dir }, {});
      expect(stalePreview.isError).toBeUndefined();
      expect(stalePreview.structuredContent).toMatchObject({
        plan: { status: 'stale' },
      });
      rmSync(join(dir, 'docs/later.md'));

      const applied = await applyRegrade.handler({ rootDir: dir }, {});
      expect(applied.isError).toBeUndefined();
      expect(existsSync(join(dir, 'docs/old.md'))).toBe(false);
      expect(existsSync(join(dir, 'docs/new.md'))).toBe(true);
      expect(readFileSync(join(dir, 'docs/index.md'), 'utf8')).toContain(
        'docs/new.md'
      );
      expect(applied.structuredContent).toMatchObject({
        history: { status: 'applied' },
        run: { plan: { fileRenames: [expect.any(Object)] } },
      });
      const transitionId = (
        applied.structuredContent as {
          readonly history?: { readonly id?: string };
        }
      ).history?.id;
      expect(transitionId).toBeDefined();

      const historyCheck = await checkRegrade.handler(
        { plan: transitionId ?? 'missing', rootDir: dir },
        {}
      );
      expect(historyCheck.isError).toBeUndefined();
      expect(historyCheck.structuredContent).toMatchObject({
        check: { status: 'passed' },
        history: {
          path: '.trails/regrade/history/alpha-to-omega.json',
          status: 'checked',
        },
        run: { plan: { fileRenames: [expect.any(Object)] } },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('executes the Regrade plan lifecycle through MCP tool handlers', async () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Trailhead docs are already clean.\n');
      writeFile(dir, 'CHANGELOG.md', 'The facet API shipped in beta.\n');
      writeFile(
        dir,
        'src/regrade-fixture.ts',
        'export const facet = "facet";\n'
      );
      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const planRegrade = requireTool(tools, 'trails_plan_regrade');
      const auditRegrade = requireTool(tools, 'trails_audit_regrade');
      const listRegrades = requireTool(tools, 'trails_list_regrades');
      const checkRegrade = requireTool(tools, 'trails_check_regrade');
      const previewRegrade = requireTool(tools, 'trails_preview_regrade');
      const applyRegrade = requireTool(tools, 'trails_apply_regrade');

      const planResult = await planRegrade.handler(
        {
          from: 'facet',
          policyClassified: [
            {
              disposition: 'explicit-preserve',
              expectMatches: true,
              paths: ['src/regrade-fixture.ts'],
              reason: 'Preserve the MCP lifecycle before-state fixture.',
            },
          ],
          rootDir: dir,
          to: 'trailhead',
        },
        {}
      );
      expect(planResult.isError).toBeUndefined();
      expect(planResult.structuredContent).toMatchObject({
        path: '.trails/regrade/facet-to-trailhead.json',
        plan: { from: 'facet', to: 'trailhead' },
      });

      const listed = await listRegrades.handler({ rootDir: dir }, {});
      expect(listed.isError).toBeUndefined();
      expect(listed.structuredContent).toMatchObject({
        plans: [
          {
            path: '.trails/regrade/facet-to-trailhead.json',
            status: 'active',
          },
        ],
      });

      const checked = await checkRegrade.handler({ rootDir: dir }, {});
      expect(checked.isError).toBeUndefined();
      expect(checked.structuredContent).toMatchObject({
        check: {
          plan: '.trails/regrade/facet-to-trailhead.json',
          status: 'passed',
        },
        plan: {
          path: '.trails/regrade/facet-to-trailhead.json',
          status: 'active',
        },
      });

      const previewed = await previewRegrade.handler({ rootDir: dir }, {});
      expect(previewed.isError).toBeUndefined();
      expect(previewed.structuredContent).toMatchObject({
        plan: {
          path: '.trails/regrade/facet-to-trailhead.json',
          status: 'active',
        },
        run: {
          report: {
            dispositions: {
              'explicit-preserve': 2,
              'historical-by-policy': 14,
            },
            scopeTiers: { 'in-scope': 0, 'policy-classified': 16 },
          },
        },
      });
      const previewOccurrences = (
        previewed.structuredContent as {
          readonly run?: {
            readonly ledger?: {
              readonly occurrences?: readonly {
                readonly path?: string;
                readonly scopeTier?: string;
                readonly verdict?: string;
              }[];
            };
          };
        }
      ).run?.ledger?.occurrences;
      expect(previewOccurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'src/regrade-fixture.ts',
            scopeTier: 'policy-classified',
            verdict: 'skipped',
          }),
        ])
      );

      const applied = await applyRegrade.handler({ rootDir: dir }, {});
      expect(applied.isError).toBeUndefined();
      expect(applied.structuredContent).toMatchObject({
        history: {
          id: expect.stringMatching(/^[0-9a-f]{12}$/),
          schemaVersion: 3,
          status: 'applied',
        },
      });
      const historyPath = (
        applied.structuredContent as {
          readonly history?: { readonly id?: string; readonly path?: string };
        }
      ).history?.path;
      const transitionId = (
        applied.structuredContent as {
          readonly history?: { readonly id?: string };
        }
      ).history?.id;
      expect(historyPath).toBeDefined();
      expect(transitionId).toBeDefined();
      expect(existsSync(join(dir, historyPath ?? 'missing'))).toBe(true);
      expect(
        existsSync(join(dir, '.trails/regrade/facet-to-trailhead.json'))
      ).toBe(false);

      const listedAfterApply = await listRegrades.handler({ rootDir: dir }, {});
      expect(listedAfterApply.isError).toBeUndefined();
      expect(listedAfterApply.structuredContent).toEqual({ plans: [] });
      expect(readFileSync(join(dir, 'docs', 'surface.md'), 'utf8')).toBe(
        'Trailhead docs are already clean.\n'
      );
      expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).toBe(
        'The facet API shipped in beta.\n'
      );
      expect(readFileSync(join(dir, 'src', 'regrade-fixture.ts'), 'utf8')).toBe(
        'export const facet = "facet";\n'
      );

      const audited = await auditRegrade.handler(
        { rootDir: dir, transitionIds: ['v1-facet-trailhead'] },
        {}
      );
      expect(audited.isError).toBeUndefined();
      expect(audited.structuredContent).toMatchObject({
        gate: { open: 0, status: 'green' },
        transitions: [
          {
            source: '.trails/regrade/history/facet-to-trailhead.json',
            transitionId: 'v1-facet-trailhead',
          },
        ],
      });

      const absoluteHistoryPath = join(dir, historyPath ?? 'missing');
      const tampered = JSON.parse(
        readFileSync(absoluteHistoryPath, 'utf8')
      ) as {
        runs?: { transitionId?: string }[];
      };
      if (tampered.runs?.[0] === undefined) {
        throw new Error('Expected governed MCP receipt run.');
      }
      tampered.runs[0].transitionId = 'v1-contour-entity';
      writeFileSync(
        absoluteHistoryPath,
        `${JSON.stringify(tampered, null, 2)}\n`
      );
      const tamperedCheck = await checkRegrade.handler(
        { plan: transitionId ?? 'missing', rootDir: dir },
        {}
      );
      expect(tamperedCheck.isError).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('writes Regrade plan artifacts through the MCP tool handler', async () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'docs/surface.md', 'Facet docs mention facet.\n');
      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const planRegrade = requireTool(tools, 'trails_plan_regrade');

      const result = await planRegrade.handler(
        {
          from: 'facet',
          rootDir: dir,
          to: 'trailhead',
        },
        {}
      );

      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        readonly path?: string;
        readonly kind?: string;
        readonly schemaVersion?: number;
        readonly plan?: {
          readonly from?: string;
        };
      };
      expect(structured).toMatchObject({
        kind: 'regrade-plan',
        path: '.trails/regrade/facet-to-trailhead.json',
        plan: { from: 'facet' },
        schemaVersion: 1,
      });
      expect(
        JSON.parse(
          readFileSync(join(dir, structured.path ?? 'missing'), 'utf8')
        )
      ).toMatchObject({
        kind: 'regrade-plan',
        plan: {
          from: 'facet',
          to: 'trailhead',
        },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('executes trailhead to trailhead dogfood reports through MCP', async () => {
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
      const planRegrade = requireTool(tools, 'trails_plan_regrade');
      const previewRegrade = requireTool(tools, 'trails_preview_regrade');

      const planResult = await planRegrade.handler(
        {
          exclude: ['.agents/notes/**', '.scratch/**'],
          from: 'facet',
          rootDir: dir,
          to: 'trailhead',
        },
        {}
      );
      expect(planResult.isError).toBeUndefined();
      const result = await previewRegrade.handler(
        {
          includeEntries: 'all',
          rootDir: dir,
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
        scope: {
          exclude: [...facetTrailheadRegistryExcludes, '.agents/notes/**'],
        },
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
        modified: 5,
        open: 6,
      });
      expect(structured.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            classId: expect.stringContaining(
              'ast-symbol-rename:v1-facet-trailhead:facet->trailhead'
            ),
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

  test('executes contour plan code facts and review inventory through MCP', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'src/rewrite.ts',
        [
          "import { contour, contours } from './runtime';",
          'export type ContourRecord = { contour: typeof contour };',
          'export const contourSummarySchema = contour;',
          'export const contoursSummarySchema = contours;',
          'const label = "contourSummarySchema contoursList contoured";',
          '',
        ].join('\n')
      );
      writeFile(
        dir,
        'src/literal.ts',
        "ctx.compose('wayfind.contours', { entities: [] });\n"
      );
      writeFile(
        dir,
        'src/review.ts',
        [
          "import { contour } from './runtime';",
          'export function render(contour: () => void) {',
          '  return contour();',
          '}',
          '',
        ].join('\n')
      );

      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const planRegrade = requireTool(tools, 'trails_plan_regrade');
      const previewRegrade = requireTool(tools, 'trails_preview_regrade');

      const planResult = await planRegrade.handler(
        {
          from: 'contour',
          rootDir: dir,
          to: 'entity',
        },
        {}
      );
      expect(planResult.isError).toBeUndefined();
      const result = await previewRegrade.handler(
        {
          includeEntries: 'all',
          rootDir: dir,
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
          readonly reviewDetails?: readonly {
            readonly candidateReplacement?: string;
            readonly classId?: string;
            readonly matchedForm?: string;
            readonly reason?: string;
            readonly symbol?: string;
          }[];
        }[];
        readonly run?: {
          readonly plan?: {
            readonly from?: string;
            readonly id?: string;
            readonly scope?: { readonly exclude?: readonly string[] };
            readonly to?: string;
          };
          readonly report?: {
            readonly gate?: {
              readonly reasons?: readonly string[];
              readonly status?: string;
            };
          };
        };
        readonly selectedClassIds?: readonly string[];
      };

      expect(structured.selectedClassIds).toEqual(
        expect.arrayContaining([
          'ast-string-literal-rename:v1-contour-entity:contour->entity',
          'ast-string-literal-rename:v1-contour-entity:contours->entities',
          'ast-string-literal-rename:v1-contour-entity:wayfind.contours->wayfind.entities',
          'ast-symbol-rename:v1-contour-entity:contour->entity',
          'ast-symbol-rename:v1-contour-entity:contours->entities',
          'v1-contour-entity',
        ])
      );
      expect(structured.run?.plan).toMatchObject({
        from: 'contour',
        id: 'v1-contour-entity',
        scope: {
          exclude: facetTrailheadRegistryExcludes,
        },
        to: 'entity',
      });
      expect(structured.run?.report?.gate).toMatchObject({
        reasons: [
          'deferred-forms-or-occurrences',
          'safe-modifications-not-yet-applied',
        ],
        remaining: 3,
        remainingByDisposition: {
          'code-context-out-of-engine': 3,
        },
        status: 'open',
      });
      expect(structured.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            classId: expect.stringContaining(
              'ast-string-literal-rename:v1-contour-entity:wayfind.contours->wayfind.entities'
            ),
            outcome: 'rewrite',
            path: 'src/literal.ts',
          }),
          expect.objectContaining({
            classId: 'ast-symbol-rename:v1-contour-entity:contour->entity',
            outcome: 'needs-review',
            path: 'src/rewrite.ts',
            reason: 'ast-identifier-module-boundary',
            reviewDetails: expect.arrayContaining([
              expect.objectContaining({
                reason: 'ast-identifier-module-boundary',
                symbol: 'contour',
              }),
            ]),
          }),
          expect.objectContaining({
            classId: 'ast-symbol-rename:v1-contour-entity:contour->entity',
            notes: expect.arrayContaining([
              'Identifier "contour" resolves to FunctionParam; routed to review.',
            ]),
            outcome: 'needs-review',
            path: 'src/review.ts',
            reason: 'ast-identifier-module-boundary',
            reviewDetails: expect.arrayContaining([
              expect.objectContaining({
                reason: 'ast-identifier-module-boundary',
                symbol: 'contour',
              }),
              expect.objectContaining({
                candidateReplacement: 'entity',
                classId: 'ast-symbol-rename:v1-contour-entity:contour->entity',
                matchedForm: 'contour',
                preserveCautions: expect.arrayContaining([
                  'Identifier "contour" resolves to FunctionParam; routed to review.',
                ]),
                reason: 'ast-identifier-review-declaration',
                symbol: 'contour',
              }),
            ]),
          }),
        ])
      );
      expect(readFileSync(join(dir, 'src', 'rewrite.ts'), 'utf8')).toContain(
        'contourSummarySchema contoursList contoured'
      );
      expect(readFileSync(join(dir, 'src', 'review.ts'), 'utf8')).toContain(
        'render(contour: () => void)'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('executes registry-backed regrade review forms through MCP', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'docs/alpha.md',
        'The alpha path is safe.\nThe alphaing path needs review.\n'
      );
      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const planRegrade = requireTool(tools, 'trails_plan_regrade');
      const previewRegrade = requireTool(tools, 'trails_preview_regrade');

      const input = {
        expand: true,
        from: 'alpha',
        rootDir: dir,
        to: 'omega',
      };
      const direct = await planRegradeTrail.implementation(input, {
        cwd: dir,
        dryRun: true,
        env: {},
      } as never);
      expect(direct.isOk()).toBe(true);
      if (direct.isErr()) {
        throw direct.error;
      }
      const planResult = await planRegrade.handler(input, {});
      expect(planResult.isError).toBeUndefined();
      const { lifecycle: directLifecycle, ...directArtifact } = direct.value;
      const { lifecycle: mcpLifecycle, ...mcpArtifact } =
        planResult.structuredContent as typeof direct.value;
      expect(mcpArtifact).toEqual(directArtifact);
      expect(mcpLifecycle).toMatchObject({
        phases: directLifecycle.phases.map((phase) => ({
          name: phase.name,
          status: phase.status,
        })),
      });
      const result = await previewRegrade.handler({ rootDir: dir }, {});

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
            readonly from?: string;
            readonly to?: string;
          };
        };
      };
      expect(structured.run?.plan).toMatchObject({
        from: 'alpha',
        to: 'omega',
      });
      expect(structured.run?.ledger?.forms).toMatchObject({
        alpha: 'modified',
        alphaing: 'deferred',
      });
      expect(structured.run?.ledger?.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ form: 'alphaing', verdict: 'deferred' }),
        ])
      );
      expect(planResult.structuredContent).toMatchObject({
        expansion: {
          candidates: [
            expect.objectContaining({
              kind: 'form',
              provenance: 'derived',
              status: 'pending',
              suggestedClassification: 'in-family-unresolved',
              value: 'alphaing',
            }),
          ],
        },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('executes governed package route rewrites and preserves through MCP', async () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        'package.json',
        `${JSON.stringify({ dependencies: { '@ontrails/source': '^1.0.0' }, name: 'consumer' })}\n`
      );
      writeFile(
        dir,
        'src/rewrite.ts',
        [
          "import { parse } from '@ontrails/warden/ast';",
          'const route = "@ontrails/warden/ast";',
          'const near = "@ontrails/warden/ast-extra";',
          '',
        ].join('\n')
      );
      writeFile(
        dir,
        'src/preserved.ts',
        "import { walk } from '@ontrails/warden/ast';\n"
      );
      const tools = unwrapTools(trailsMcpApp, trailsMcpSurfaceOptions);
      const planRegrade = requireTool(tools, 'trails_plan_regrade');
      const previewRegrade = requireTool(tools, 'trails_preview_regrade');
      const applyRegrade = requireTool(tools, 'trails_apply_regrade');

      const planResult = await planRegrade.handler(
        {
          from: '@ontrails/warden/ast',
          include: ['src/**'],
          preserve: [
            {
              forms: ['@ontrails/warden/ast'],
              paths: ['src/preserved.ts'],
              pattern: '@ontrails/warden/ast',
              reason: 'intentional negative fixture',
            },
          ],
          rootDir: dir,
          to: '@ontrails/source',
        },
        {}
      );
      expect(planResult.isError).toBeUndefined();
      expect(planResult.structuredContent).toMatchObject({
        kind: 'regrade-plan',
        path: '.trails/regrade/ontrails-warden-ast-to-ontrails-source.json',
        plan: {
          from: '@ontrails/warden/ast',
          to: '@ontrails/source',
        },
      });

      const previewResult = await previewRegrade.handler(
        { includeEntries: 'all', rootDir: dir },
        {}
      );
      expect(previewResult.isError).toBeUndefined();
      const structured = previewResult.structuredContent as {
        readonly entries?: readonly {
          readonly classId?: string;
          readonly outcome?: string;
          readonly path?: string;
        }[];
        readonly run?: {
          readonly plan?: {
            readonly from?: string;
            readonly preserve?: readonly {
              readonly paths?: readonly string[];
              readonly pattern?: string;
              readonly reason?: string;
            }[];
            readonly to?: string;
          };
          readonly report?: {
            readonly gate?: {
              readonly reasons?: readonly string[];
              readonly status?: string;
            };
          };
        };
        readonly selectedClassIds?: readonly string[];
      };
      expect(structured.selectedClassIds).toContain(
        'ast-string-literal-rename:v1-warden-ast-source:@ontrails/warden/ast->@ontrails/source'
      );
      expect(structured.run?.plan).toMatchObject({
        from: '@ontrails/warden/ast',
        id: 'v1-warden-ast-source',
        to: '@ontrails/source',
      });
      expect(structured.run?.plan?.preserve).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            paths: ['src/preserved.ts'],
            pattern: '@ontrails/warden/ast',
            reason: 'intentional negative fixture',
          }),
        ])
      );
      expect(structured.run?.report?.gate).toMatchObject({
        reasons: ['safe-modifications-not-yet-applied'],
        status: 'open',
      });
      expect(structured.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            classId: expect.stringContaining(
              'ast-string-literal-rename:v1-warden-ast-source:@ontrails/warden/ast->@ontrails/source'
            ),
            outcome: 'rewrite',
            path: 'src/rewrite.ts',
          }),
          expect.objectContaining({
            outcome: 'no-op',
            path: 'src/preserved.ts',
          }),
        ])
      );

      const applyResult = await applyRegrade.handler({ rootDir: dir }, {});
      expect(applyResult.isError).toBeUndefined();
      expect(applyResult.structuredContent).toMatchObject({
        history: {
          status: 'applied',
        },
      });
      const applied = readFileSync(join(dir, 'src', 'rewrite.ts'), 'utf8');
      expect(applied).toContain("from '@ontrails/source'");
      expect(applied).toContain('const route = "@ontrails/source";');
      expect(applied).toContain('const near = "@ontrails/warden/ast-extra";');
      expect(readFileSync(join(dir, 'src', 'preserved.ts'), 'utf8')).toBe(
        "import { walk } from '@ontrails/warden/ast';\n"
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('keeps app-authored trailhead selectors explicit enough for review', () => {
    expect(trailsMcpTrailheads.inspect.trails).toContain('survey');
    expect(trailsMcpTrailheads.inspect.trails).not.toContain('survey.*');
    expect(Object.keys(trailsMcpTrailheads)).toEqual(['inspect']);
    expect(trailsMcpIncludedTrails).toContain('release.check');
    expect(trailsMcpIncludedTrails).toContain('release.smoke');
    expect(trailsMcpIncludedTrails).toContain('plan.regrade');
    expect(trailsMcpIncludedTrails).toContain('apply.regrade');
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
    const regradeGraphUri = `${MCP_TRAIL_RESOURCE_PREFIX}${encodeURIComponent('plan.regrade')}`;

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
      trailId: 'plan.regrade',
    });
    expect(regradeGraph.tools).toEqual([
      expect.objectContaining({
        name: 'trails_plan_regrade',
        trailId: 'plan.regrade',
      }),
    ]);
    const projectedMap = parseJson(surfaceMap?.text) as {
      readonly tools?: readonly {
        readonly deferred?: boolean | undefined;
        readonly trailheadId?: string | undefined;
        readonly name?: string | undefined;
        readonly trailId?: string | undefined;
      }[];
    };
    expect(
      projectedMap.tools?.find((tool) => tool.trailheadId === 'inspect')
    ).toEqual(
      expect.objectContaining({
        deferred: true,
        name: 'trails_inspect',
        trailheadId: 'inspect',
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

  test('the authored overlay inspect binding matches the call-site override', async () => {
    const bindings = resolveSurfaceOverlayBindings(trailsOverlays);
    const authoredMembers = bindings?.mcp?.['inspect'];
    expect(Array.isArray(authoredMembers)).toBe(true);
    expect([...(authoredMembers ?? [])].toSorted()).toEqual(
      [...trailsMcpTrailheads.inspect.trails].toSorted()
    );

    const sourceCode = readFileSync(
      fileURLToPath(new URL('../mcp-options.ts', import.meta.url)),
      'utf8'
    );
    const divergence = await trailheadOverrideDivergenceTrail.implementation(
      {
        ...(bindings?.mcp === undefined
          ? {}
          : {
              authoredMcpSurfaceBindingSets: [
                {
                  appName: trailsMcpApp.name,
                  bindings: bindings.mcp,
                  trailIds: [...trailsMcpApp.trails.keys()],
                },
              ],
            }),
        filePath: 'apps/trails/src/mcp-options.ts',
        sourceCode,
      },
      createTrailContext({})
    );

    expect(divergence.isOk()).toBe(true);
    expect(divergence.isOk() ? divergence.value.diagnostics : null).toEqual([]);
  });
});
