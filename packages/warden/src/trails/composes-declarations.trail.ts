import { composesDeclarations } from '../rules/composes-declarations.js';
import { wrapRule } from './wrap-rule.js';

export const composesDeclarationsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.onboard", {
  composes: ["entity.create"],
  implementation: async (input, ctx) => {
    const result = await ctx.compose("entity.create", input);
    return Result.ok(result);
  }
})`,
      },
      name: 'Matched composing declarations and calls',
    },
  ],
  rule: composesDeclarations,
});
