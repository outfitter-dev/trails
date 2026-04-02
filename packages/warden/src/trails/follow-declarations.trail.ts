import { followDeclarations } from '../rules/follow-declarations.js';
import { wrapRule } from './wrap-rule.js';

export const followDeclarationsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.onboard", {
  follow: ["entity.create"],
  blaze: async (input, ctx) => {
    const result = await ctx.follow("entity.create", input);
    return Result.ok(result);
  }
})`,
      },
      name: 'Matched follow declarations and calls',
    },
  ],
  rule: followDeclarations,
});
