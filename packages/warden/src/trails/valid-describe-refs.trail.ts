import { validDescribeRefs } from '../rules/valid-describe-refs.js';
import { wrapRule } from './wrap-rule.js';

export const validDescribeRefsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `const schema = z.object({
  name: z.string().describe("User display name"),
});`,
      },
      name: 'Describe without @see refs',
    },
  ],
  rule: validDescribeRefs,
});
