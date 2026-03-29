import { noDirectImplInRoute } from '../rules/no-direct-impl-in-route.js';
import { wrapRule } from './wrap-rule.js';

export const noDirectImplInRouteTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.onboard", {
  follow: ["entity.create"],
  run: async (input, ctx) => {
    const result = await ctx.follow("entity.create", input);
    return Result.ok(result);
  }
})`,
      },
      name: 'Trail with follow using ctx.follow()',
    },
  ],
  rule: noDirectImplInRoute,
});
