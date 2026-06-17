import { deadPublicTrail } from '../rules/dead-public-trail.js';
import { wrapRule } from './wrap-rule.js';

export const deadPublicTrailTrail = wrapRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: 'packages/regrade/src/downstream/report.ts',
            line: 1,
            message:
              'Exported public trail "regrade.downstream.report" is not registered in a configured app topo, composed by another trail, or activated by on:. Anchor the contract in a topo, compose it, mark it internal, or remove the public export.',
            rule: 'dead-public-trail',
            severity: 'warn',
          },
        ],
      },
      input: {
        filePath: 'packages/regrade/src/downstream/report.ts',
        knownTrailIds: ['regrade.downstream.report', 'regrade'],
        sourceCode: `export const regradeReportTrail = trail('regrade.downstream.report', {
  blaze: async () => Result.ok({}),
});`,
        topoTrailIds: ['regrade'],
      },
      name: 'Exported package trail missing from registered app topos',
    },
  ],
  rule: deadPublicTrail,
});
