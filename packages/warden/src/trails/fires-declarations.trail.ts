import { firesDeclarations } from '../rules/fires-declarations.js';
import { wrapRule } from './wrap-rule.js';

export const firesDeclarationsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `const entityCreated = signal("entity.created", { payload: z.object({}) });
trail("entity.onboard", {
  fires: [entityCreated],
  blaze: async (input, ctx) => {
    await ctx.fire(entityCreated, { id: input.id });
    return Result.ok({});
  }
})`,
      },
      name: 'Matched fires declarations and calls',
    },
  ],
  rule: firesDeclarations,
});
