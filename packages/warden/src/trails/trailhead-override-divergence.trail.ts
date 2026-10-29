import { trailheadOverrideDivergence } from '../rules/trailhead-override-divergence.js';
import { wrapRule } from './wrap-rule.js';

export const trailheadOverrideDivergenceTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        authoredMcpSurfaceBindingSets: [
          {
            appName: 'demo',
            bindings: { inspect: ['survey', 'survey.brief'] },
            trailIds: ['survey', 'survey.brief'],
          },
        ],
        filePath: 'mcp-options.ts',
        sourceCode: `export const trailheads = {
  inspect: {
    description: "Inspect topo state.",
    trails: ["survey", "survey.brief"],
  },
};`,
      },
      name: 'Aligned call-site override',
    },
    {
      input: {
        authoredMcpSurfaceBindingSets: [
          {
            appName: 'demo',
            bindings: { inspect: ['survey', 'survey.brief'] },
            trailIds: ['survey', 'survey.brief'],
          },
        ],
        filePath: 'mcp-options.ts',
        sourceCode: `export const trailheads = {
  inspect: {
    description: "Inspect topo state.",
    trails: ["survey"],
  },
};`,
      },
      // todo ::: Add an expected diagnostic to this contract example; input alone receives schema-only validation and does not prove divergent selectors are flagged. #coverage
      name: 'Diverging member selectors are flagged',
    },
  ],
  rule: trailheadOverrideDivergence,
});
