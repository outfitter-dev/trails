import { Result, trail } from '@ontrails/core';

import { contextNoSurfaceTypes as rule } from '../rules/context-no-surface-types.js';

import { ruleInputSchema, ruleOutputSchema } from './schemas.js';

export const contextNoSurfaceTypesTrail = trail(
  'warden.rule.context-no-surface-types',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'clean.ts',
          sourceCode:
            "import { Result } from '@ontrails/core';\nconst t = trail('a', { input: z.object({}) });",
        },
        name: 'Clean trail file',
      },
      {
        input: {
          filePath: 'bad.ts',
          sourceCode:
            "import { Request } from 'express';\nconst t = trail('a', { input: z.object({}) });",
        },
        name: 'Surface type import detected',
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
