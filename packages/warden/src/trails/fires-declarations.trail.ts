import { firesDeclarations } from '../rules/fires-declarations.js';
import { wrapRule } from './wrap-rule.js';

export const firesDeclarationsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.onboard", {
  fires: ["entity.created"],
  blaze: async (input, ctx) => {
    await ctx.fire("entity.created", { id: input.id });
    return Result.ok({});
  }
})`,
      },
      name: 'Matched fires declarations and calls',
    },
  ],
  rule: firesDeclarations,
});
