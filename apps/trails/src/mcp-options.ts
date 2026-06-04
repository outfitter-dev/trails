import type { CreateServerOptions, McpSurfaceFacetMap } from '@ontrails/mcp';

export const trailsMcpFacets = {
  artifacts: {
    description:
      'Compile, validate, and manage local topo artifacts for a Trails workspace.',
    mcp: { loading: 'deferred' },
    trails: ['compile', 'validate', 'topo.history', 'topo.pin', 'topo.unpin'],
  },
  authoring: {
    description:
      'Create and evolve Trails projects, surfaces, trails, and version entries.',
    mcp: { loading: 'deferred' },
    trails: [
      'create',
      'create.adapter',
      'add.surface',
      'add.trail',
      'revise',
      'deprecate',
      'draft.promote',
    ],
  },
  execution: {
    description:
      'Run trails and examples from a Trails workspace with traceable outcomes.',
    mcp: { loading: 'deferred' },
    trails: ['run', 'run.examples', 'run.example'],
  },
  governance: {
    description:
      'Run project diagnostics, adapter readiness checks, and Warden guidance.',
    mcp: { loading: 'deferred' },
    trails: ['doctor', 'adapter.check', 'warden', 'warden.guide'],
  },
  inspect: {
    description:
      'Inspect topo structure, contracts, resources, signals, surfaces, and diffs.',
    mcp: { loading: 'deferred' },
    trails: [
      'survey',
      'diff',
      'topo',
      'guide',
      'survey.brief',
      'survey.diff',
      'survey.resource',
      'survey.signal',
      'survey.surfaces',
      'survey.trail',
    ],
  },
  shell: {
    description: 'Render and complete Trails shell completions.',
    mcp: { loading: 'deferred' },
    trails: ['completions', 'completions.__complete'],
  },
  workspace: {
    description:
      'Inspect and maintain local Trails developer state such as snapshots and traces.',
    mcp: { loading: 'deferred' },
    trails: ['dev.stats', 'dev.clean', 'dev.reset'],
  },
} satisfies McpSurfaceFacetMap;

export const trailsMcpSurfaceOptions = {
  description:
    'Trails framework operator surface. Use MCP resources for cold context, then call a facet tool with a trail ID and input payload.',
  facets: trailsMcpFacets,
  mcpResources: { examples: true, surfaceMap: true },
  name: 'trails',
} satisfies CreateServerOptions;
