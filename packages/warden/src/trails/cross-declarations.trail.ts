import { crossDeclarations } from '../rules/cross-declarations.js';
import { wrapRule } from './wrap-rule.js';

export const crossDeclarationsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.onboard", {
  crosses: ["entity.create"],
  blaze: async (input, ctx) => {
    const result = await ctx.cross("entity.create", input);
    return Result.ok(result);
  }
})`,
      },
      name: 'Matched crossing declarations and calls',
    },
  ],
  rule: crossDeclarations,
});
