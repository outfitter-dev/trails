import { Result, trail } from '@ontrails/core';

import { noThrowInImplementation as rule } from '../rules/no-throw-in-implementation.js';

import { ruleInputSchema, ruleOutputSchema } from './schemas.js';

export const noThrowInImplementationTrail = trail(
  'warden.rule.no-throw-in-implementation',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'clean.ts',
          sourceCode:
            'implementation: (input) => Result.ok({ value: input.name })',
        },
        name: 'Clean implementation',
      },
      {
        input: {
          filePath: 'bad.ts',
          sourceCode: 'implementation: (input) => { throw new Error("bad") }',
        },
        name: 'Throw detected',
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
