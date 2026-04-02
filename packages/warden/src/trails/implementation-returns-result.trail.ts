import { implementationReturnsResult } from '../rules/implementation-returns-result.js';
import { wrapRule } from './wrap-rule.js';

export const implementationReturnsResultTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.show", {
  blaze: async (input, ctx) => {
    return Result.ok({ name: "test" });
  }
})`,
      },
      name: 'Implementation returning Result.ok()',
    },
  ],
  rule: implementationReturnsResult,
});
