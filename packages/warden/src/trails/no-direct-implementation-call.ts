import { Result, trail } from '@ontrails/core';

import { noDirectImplementationCall as rule } from '../rules/no-direct-implementation-call.js';

import { ruleInputSchema, ruleOutputSchema } from './schemas.js';

export const noDirectImplementationCallTrail = trail(
  'warden.rule.no-direct-implementation-call',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'src/app.ts',
          sourceCode:
            "import { Result } from '@ontrails/core';\nconst x = await ctx.follow('b', {});",
        },
        name: 'Uses ctx.follow',
      },
      {
        input: {
          filePath: 'src/app.ts',
          sourceCode:
            "import { Result } from '@ontrails/core';\nconst x = await someTrail.implementation({});",
        },
        name: 'Direct implementation call',
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
