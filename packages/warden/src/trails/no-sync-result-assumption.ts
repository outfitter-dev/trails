import { Result, trail } from '@ontrails/core';

import { noSyncResultAssumption as rule } from '../rules/no-sync-result-assumption.js';

import { ruleInputSchema, ruleOutputSchema } from './schemas.js';

export const noSyncResultAssumptionTrail = trail(
  'warden.rule.no-sync-result-assumption',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'src/app.ts',
          sourceCode:
            'const result = await someTrail.implementation(input);\nif (result.isOk()) {}',
        },
        name: 'Properly awaited',
      },
      {
        input: {
          filePath: 'src/app.ts',
          sourceCode:
            'const result = someTrail.implementation(input);\nresult.isOk();',
        },
        name: 'Missing await',
      },
    ],
    implementation: (input) =>
      Result.ok({
        diagnostics: [...rule.check(input.sourceCode, input.filePath)],
      }),
    input: ruleInputSchema,
    output: ruleOutputSchema,
  }
);
