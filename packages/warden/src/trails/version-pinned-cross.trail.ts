import { versionPinnedCross } from '../rules/trail-versioning-source.js';
import { wrapRule } from './wrap-rule.js';

export const versionPinnedCrossTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'src/trails/current.ts',
        sourceCode: `
trail('current.parent', {
  blaze: async (_input, ctx) => {
    await ctx.cross('current.child', {});
    return Result.ok({});
  },
});
`,
      },
      name: 'Current composition has no version-pin warning',
    },
  ],
  rule: versionPinnedCross,
});
