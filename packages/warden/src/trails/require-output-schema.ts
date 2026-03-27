import { Result, trail } from '@ontrails/core';

import { requireOutputSchema as rule } from '../rules/require-output-schema.js';

import { ruleInputSchema, ruleOutputSchema } from './schemas.js';

export const requireOutputSchemaTrail = trail(
  'warden.rule.require-output-schema',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'clean.ts',
          sourceCode:
            "trail('a', { input: z.object({}), output: z.object({}), surfaces: ['mcp'] })",
        },
        name: 'Trail with output schema',
      },
      {
        input: {
          filePath: 'bad.ts',
          sourceCode: "trail('a', { input: z.object({}), surfaces: ['mcp'] })",
        },
        name: 'Missing output for MCP surface',
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
