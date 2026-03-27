import { Result, trail } from '@ontrails/core';

import { implementationReturnsResult as rule } from '../rules/implementation-returns-result.js';

import { ruleInputSchema, ruleOutputSchema } from './schemas.js';

export const implementationReturnsResultTrail = trail(
  'warden.rule.implementation-returns-result',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'src/trails/good.ts',
          sourceCode:
            "trail('a', { input: z.object({}), implementation: (input) => Result.ok({ done: true }) })",
        },
        name: 'Returns Result.ok',
      },
      {
        input: {
          filePath: 'src/trails/bad.ts',
          sourceCode:
            "trail('a', { input: z.object({}), implementation: (input) => { return { done: true }; } })",
        },
        name: 'Returns raw value',
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
