import { Result, trail } from '@ontrails/core';

import { followsTrailsExist as rule } from '../rules/follows-trails-exist.js';
import type { ProjectContext } from '../rules/types.js';

import { projectAwareRuleInputSchema, ruleOutputSchema } from './schemas.js';

export const followsTrailsExistTrail = trail(
  'warden.rule.follows-trails-exist',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'src/trails/clean.ts',
          knownTrailIds: ['a', 'b'],
          sourceCode:
            "hike('c', { follows: ['a', 'b'], implementation: async (i, ctx) => Result.ok({}) })",
        },
        name: 'All followed trails exist',
      },
      {
        input: {
          filePath: 'src/trails/bad.ts',
          knownTrailIds: ['a'],
          sourceCode:
            "hike('c', { follows: ['a', 'missing'], implementation: async (i, ctx) => Result.ok({}) })",
        },
        name: 'Missing followed trail',
      },
    ],
    implementation: (input) => {
      const context: ProjectContext = {
        knownTrailIds: new Set(input.knownTrailIds),
      };
      return Result.ok({
        diagnostics: [
          ...rule.checkWithContext(input.sourceCode, input.filePath, context),
        ],
      });
    },
    input: projectAwareRuleInputSchema,
    output: ruleOutputSchema,
  }
);
