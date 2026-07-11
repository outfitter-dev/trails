import { versionPinnedCompose } from '../rules/trail-versioning-source.js';
import { wrapRule } from './wrap-rule.js';

export const versionPinnedComposeTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'src/trails/current.ts',
        sourceCode: `
trail('current.parent', {
  implementation: async (_input, ctx) => {
    await ctx.compose('current.child', {});
    return Result.ok({});
  },
});
`,
      },
      name: 'Current composition has no version-pin warning',
    },
  ],
  rule: versionPinnedCompose,
});
