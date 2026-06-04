import { surfaceFacetCoherence } from '../rules/surface-facet-coherence.js';
import { wrapRule } from './wrap-rule.js';

export const surfaceFacetCoherenceTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'mcp-options.ts',
        sourceCode: `export const facets = {
  inspect: {
    description: "Inspect topo state.",
    trails: ["survey", "survey.brief"],
  },
  governance: {
    description: "Run diagnostics.",
    trails: ["warden", "doctor"],
  },
};`,
      },
      name: 'Reviewable surface facet map',
    },
  ],
  rule: surfaceFacetCoherence,
});
