import { Result, trail } from '@ontrails/core';

import { preferSchemaInference as rule } from '../rules/prefer-schema-inference.js';

import { ruleInputSchema, ruleOutputSchema } from './schemas.js';

export const preferSchemaInferenceTrail = trail(
  'warden.rule.prefer-schema-inference',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'src/trails/clean.ts',
          sourceCode:
            "trail('a', { input: z.object({ name: z.string() }), implementation: (i) => Result.ok({}) })",
        },
        name: 'No redundant field overrides',
      },
      {
        input: {
          filePath: 'src/trails/redundant.ts',
          sourceCode:
            "trail('a', { input: z.object({ name: z.string() }), fields: { name: { label: 'Name' } }, implementation: (i) => Result.ok({}) })",
        },
        name: 'Redundant label override',
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
