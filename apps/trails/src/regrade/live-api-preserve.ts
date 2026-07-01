import { escapeRegExp } from '@ontrails/core';
import type {
  VocabularyPreserveInventoryEntry,
  VocabularyRegradePlan,
} from '@ontrails/regrade';
import { deriveTopoGraph } from '@ontrails/topographer';
import type { TopoGraphFacetDeclaration } from '@ontrails/topographer';
import { getGovernedVocabularyTransition } from '@ontrails/warden';

import { trailsMcpFacets } from '../mcp-options.js';

const facetTransitionId = 'v1-facet-trailhead';

const containedPattern = (value: string): string =>
  `\\b${escapeRegExp(value)}\\b`;

const sourceCodePaths = [
  '**/*.cjs',
  '**/*.cts',
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.mts',
  '**/*.ts',
  '**/*.tsx',
];

const mcpFacetDeclarations = (): readonly TopoGraphFacetDeclaration[] =>
  Object.entries(trailsMcpFacets).map(([id, facet]) => ({
    description: facet.description,
    id,
    surfaces: ['mcp'],
    trails: facet.trails,
  }));

const addInventoryEntry = (
  entries: VocabularyPreserveInventoryEntry[],
  options: Omit<VocabularyPreserveInventoryEntry, 'source'>
): void => {
  entries.push({
    ...options,
    disposition: options.disposition ?? 'preserve-current-live-api',
    source: 'derived-live-api',
  });
};

const matchesFacetTransition = (plan: VocabularyRegradePlan): boolean => {
  const transition = getGovernedVocabularyTransition(facetTransitionId);
  return (
    transition !== undefined &&
    transition.from === plan.from &&
    transition.target.kind === 'single' &&
    transition.target.to === plan.to
  );
};

export const deriveLiveApiPreserveInventory = async (
  plan: VocabularyRegradePlan
): Promise<readonly VocabularyPreserveInventoryEntry[]> => {
  if (!matchesFacetTransition(plan)) {
    return [];
  }

  const [{ app }, { trailsMcpApp }] = await Promise.all([
    import('../app.js'),
    import('../mcp-app.js'),
  ]);
  const cliGraph = deriveTopoGraph(app);
  const mcpGraph = deriveTopoGraph(trailsMcpApp, {
    facets: mcpFacetDeclarations(),
  });
  const inventory: VocabularyPreserveInventoryEntry[] = [];
  const transition = getGovernedVocabularyTransition(facetTransitionId);
  if (transition === undefined) {
    return [];
  }
  const identifiers = new Set(transition.codeIdentifiers);
  const hasMcpFacetFacts = (mcpGraph.facets ?? []).length > 0;

  if (
    identifiers.has('wayfind.facets') &&
    cliGraph.entries.some((entry) => entry.id === 'wayfind.facets')
  ) {
    addInventoryEntry(inventory, {
      evidence: ['topo.entry:wayfind.facets'],
      forms: ['facets'],
      pattern: containedPattern('wayfind.facets'),
      reason: 'current-live-trail-id',
    });
  }

  if (hasMcpFacetFacts && identifiers.has('facetId')) {
    addInventoryEntry(inventory, {
      evidence: mcpGraph.facets?.map((facet) => `topo.facet:${facet.id}`) ?? [],
      forms: ['facetId'],
      paths: sourceCodePaths,
      pattern: String.raw`\bfacetId\b\s*[:?=]`,
      reason: 'current-live-mcp-facet-field',
    });
  }

  if (hasMcpFacetFacts && identifiers.has('McpSurfaceFacetMap')) {
    addInventoryEntry(inventory, {
      evidence: ['mcp.surface.facets', 'topo.facets'],
      forms: ['McpSurfaceFacetMap'],
      paths: sourceCodePaths,
      pattern: String.raw`(?:\b(?:import\s+type\s+\{[^;\n]*|(?:export\s+)?type\s+|satisfies\s+)|:\s*)McpSurfaceFacetMap\b`,
      reason: 'current-live-mcp-facet-type',
    });
  }

  if (hasMcpFacetFacts && identifiers.has('facets')) {
    addInventoryEntry(inventory, {
      evidence: ['mcp.surface.facets', 'topo.facets'],
      forms: ['facets'],
      paths: sourceCodePaths,
      pattern: String.raw`\bfacets\b\s*(?:\?:|:)|^(?:\s*export\s+)?\s*const\s+facets\b`,
      reason: 'current-live-mcp-facets-property',
    });
  }

  return inventory.toSorted((left, right) =>
    left.pattern.localeCompare(right.pattern)
  );
};
