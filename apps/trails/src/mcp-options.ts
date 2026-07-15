import type {
  CreateServerOptions,
  McpSurfaceTrailheadMap,
} from '@ontrails/mcp';

import { trailsOverlays } from './app.js';

export const trailsMcpIncludedTrails = [
  'adapter.check',
  'add.surface',
  'add.trail',
  'compile',
  'create',
  'create.adapter',
  'deprecate',
  'dev.clean',
  'dev.reset',
  'dev.stats',
  'doctor',
  'draft.promote',
  'guide',
  'adjust.regrade',
  'apply.regrade',
  'audit.regrade',
  'check.regrade',
  'list.regrades',
  'plan.regrade',
  'preview.regrade',
  'release.check',
  'release.smoke',
  'revise',
  'run',
  'run.example',
  'run.examples',
  'survey',
  'survey.brief',
  'survey.diff',
  'survey.resource',
  'survey.signal',
  'survey.surfaces',
  'survey.trail',
  'topo',
  'topo.history',
  'topo.pin',
  'topo.unpin',
  'validate',
  'warden',
  'warden.guide',
  'wayfind.adapters',
  'wayfind.contract',
  'wayfind.diff',
  'wayfind.errors',
  'wayfind.examples',
  'wayfind.impact',
  'wayfind.nearby',
  'wayfind.overview',
  'wayfind.search',
  'wayfind.trails',
] as const;

export const trailsMcpTrailheads = {
  inspect: {
    description:
      'Inspect saved topo structure, resources, signals, surfaces, and diffs.',
    mcp: { loading: 'deferred' },
    trails: [
      'survey',
      'topo',
      'guide',
      'survey.brief',
      'survey.diff',
      'survey.resource',
      'survey.signal',
      'survey.surfaces',
      'survey.trail',
      'topo.history',
    ],
  },
} satisfies McpSurfaceTrailheadMap;

export const trailsMcpSurfaceOptions = {
  description:
    'Trails framework operator surface. Use MCP resources for cold context, direct tools for high-signal work, and the inspect trailhead for saved topo reads.',
  include: trailsMcpIncludedTrails,
  mcpResources: { examples: true, graph: true, surfaceMap: true },
  name: 'trails',
  // The overlay authors the lockable `inspect` default; the call-site map
  // below is the runtime override-in-context with richer metadata
  // (description, deferred loading) over the same member selectors.
  overlays: trailsOverlays,
  trailheads: trailsMcpTrailheads,
} satisfies CreateServerOptions;
