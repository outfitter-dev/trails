import { surfaceTrailheadCoherence } from '../rules/surface-trailhead-coherence.js';
import { wrapRule } from './wrap-rule.js';

export const surfaceTrailheadCoherenceTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'mcp-options.ts',
        sourceCode: `export const trailheads = {
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
      name: 'Reviewable trailhead map',
    },
  ],
  rule: surfaceTrailheadCoherence,
});
