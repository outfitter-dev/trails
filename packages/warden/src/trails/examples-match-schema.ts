import { Result, trail } from '@ontrails/core';

import { examplesMatchSchema as rule } from '../rules/examples-match-schema.js';

import { ruleInputSchema, ruleOutputSchema } from './schemas.js';

export const examplesMatchSchemaTrail = trail(
  'warden.rule.examples-match-schema',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'src/trails/clean.ts',
          sourceCode:
            "trail('a', { input: z.object({ name: z.string() }), examples: [{ name: 'ex', input: { name: 'test' } }], implementation: (i) => Result.ok({}) })",
        },
        name: 'Example matches schema',
      },
      {
        input: {
          filePath: 'src/trails/bad.ts',
          sourceCode:
            "trail('a', { input: z.object({ name: z.string() }), examples: [{ name: 'ex', input: {} }], implementation: (i) => Result.ok({}) })",
        },
        name: 'Example missing required key',
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
