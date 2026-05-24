import { noRedundantResultErrorWrap } from '../rules/no-redundant-result-error-wrap.js';
import { wrapRule } from './wrap-rule.js';

export const noRedundantResultErrorWrapTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'entity.ts',
        sourceCode: `import { Result, trail } from "@ontrails/core";

trail("entity.load", {
  blaze: async (input, ctx) => {
    const loaded = await ctx.cross("entity.fetch", input);
    if (loaded.isErr()) {
      return loaded;
    }
    return Result.ok(loaded.value);
  },
});`,
      },
      name: 'Existing Result values pass through directly',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'entity.ts',
            line: 7,
            message:
              'Trail "entity.load": Result.err(loaded.error) re-wraps a Result that already carries that error. Return loaded directly to preserve the original Result boundary.',
            rule: 'no-redundant-result-error-wrap',
            severity: 'warn',
          },
        ],
      },
      input: {
        filePath: 'entity.ts',
        sourceCode: `import { Result, trail } from "@ontrails/core";

trail("entity.load", {
  blaze: async (input, ctx) => {
    const loaded = await ctx.cross("entity.fetch", input);
    if (loaded.isErr()) {
      return Result.err(loaded.error);
    }
    return Result.ok(loaded.value);
  },
});`,
      },
      name: 'Warns when an existing Result error is re-wrapped',
    },
  ],
  rule: noRedundantResultErrorWrap,
});
