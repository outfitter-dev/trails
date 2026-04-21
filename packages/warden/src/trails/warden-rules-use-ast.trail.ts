import { fileURLToPath } from 'node:url';
import { wardenRulesUseAst } from '../rules/warden-rules-use-ast.js';
import { wrapRule } from './wrap-rule.js';

/**
 * Resolve a filePath inside this package's `src/rules/` directory so the
 * positive example fires the path-anchored scope check. Anchoring via
 * `import.meta.url` keeps the example robust to the cwd under which tests run.
 */
const fakeRulePath = fileURLToPath(
  new URL('../rules/fake-rule.ts', import.meta.url)
);

export const wardenRulesUseAstTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'packages/other-pkg/src/index.ts',
        sourceCode: `const lines = sourceCode.split('\\n');\n`,
      },
      name: 'Ignores files outside the warden rules directory',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: fakeRulePath,
            line: 1,
            message:
              'warden-rules-use-ast: sourceCode.split(...) treats source text as a string. Warden rules must inspect the AST via packages/warden/src/rules/ast.ts helpers, not regex-scan raw source text. Use findStringLiterals, findTrailDefinitions, findConfigProperty, or a similar AST walker. Raw-text scanning produces false positives on string literals, template payloads, and docstrings — see TRL-335, ADR-0036.',
            rule: 'warden-rules-use-ast',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: fakeRulePath,
        sourceCode: `export const r = { check(sourceCode: string) { return sourceCode.split('\\n'); } };\n`,
      },
      name: 'Flags sourceCode.split(...) in a rule file',
    },
  ],
  rule: wardenRulesUseAst,
});
