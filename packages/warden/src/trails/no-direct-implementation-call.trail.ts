import { noDirectImplementationCall } from '../rules/no-direct-implementation-call.js';
import { wrapRule } from './wrap-rule.js';

export const noDirectImplementationCallTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `const data = await ctx.follow("entity.show", { id: "1" });`,
      },
      name: 'Clean code using ctx.follow instead of .blaze()',
    },
  ],
  rule: noDirectImplementationCall,
});
