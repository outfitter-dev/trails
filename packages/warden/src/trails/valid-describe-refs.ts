import { Result, trail } from '@ontrails/core';

import { validDescribeRefs as rule } from '../rules/valid-describe-refs.js';
import type { ProjectContext } from '../rules/types.js';

import { projectAwareRuleInputSchema, ruleOutputSchema } from './schemas.js';

export const validDescribeRefsTrail = trail('warden.rule.valid-describe-refs', {
  description: rule.description,
  examples: [
    {
      input: {
        filePath: 'src/trails/clean.ts',
        knownTrailIds: ['a.create'],
        sourceCode: "z.object({ name: z.string().describe('@see a.create') })",
      },
      name: 'Valid @see reference',
    },
    {
      input: {
        filePath: 'src/trails/bad.ts',
        knownTrailIds: [],
        sourceCode:
          "z.object({ name: z.string().describe('@see missing.trail') })",
      },
      name: 'Invalid @see reference',
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
});
