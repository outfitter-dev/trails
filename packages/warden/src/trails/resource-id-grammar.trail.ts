import { resourceIdGrammar } from '../rules/resource-id-grammar.js';
import { wrapRule } from './wrap-rule.js';

export const resourceIdGrammarTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `const db = resource("db.main", {
  create: () => Result.ok({}),
});`,
      },
      name: 'Resource ids stay free of the scope separator',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'invalid.ts',
            line: 1,
            message:
              'Resource "billing:primary" is invalid because resource ids may not contain ":".',
            rule: 'resource-id-grammar',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: 'invalid.ts',
        sourceCode: `const db = resource("billing:primary", {
  create: () => Result.ok({}),
});`,
      },
      name: 'Colon-separated resource ids are rejected',
    },
  ],
  rule: resourceIdGrammar,
});
