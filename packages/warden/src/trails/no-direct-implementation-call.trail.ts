import { noDirectImplementationCall } from '../rules/no-direct-implementation-call.js';
import { wrapRule } from './wrap-rule.js';

export const noDirectImplementationCallTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `const data = await ctx.cross("entity.show", { id: "1" });`,
      },
      name: 'Clean code using ctx.cross instead of .blaze()',
    },
  ],
  rule: noDirectImplementationCall,
});
