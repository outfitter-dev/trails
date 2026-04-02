import { noDirectImplInRoute } from '../rules/no-direct-impl-in-route.js';
import { wrapRule } from './wrap-rule.js';

export const noDirectImplInRouteTrail = wrapRule({
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
      name: 'Trail with crossings using ctx.cross()',
    },
  ],
  rule: noDirectImplInRoute,
});
