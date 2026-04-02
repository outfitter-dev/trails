import { noThrowInImplementation } from '../rules/no-throw-in-implementation.js';
import { wrapRule } from './wrap-rule.js';

export const noThrowInImplementationTrail = wrapRule({
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
      name: 'Clean implementation without throw',
    },
  ],
  rule: noThrowInImplementation,
});
