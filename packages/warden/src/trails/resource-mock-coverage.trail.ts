import { resourceMockCoverage } from '../rules/resource-mock-coverage.js';
import { wrapRule } from './wrap-rule.js';

export const resourceMockCoverageTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `const db = resource("db.main", {
  create: () => Result.ok(openDatabase()),
  mock: () => createInMemoryDb(),
});`,
      },
      name: 'Resource declaring a mock factory passes',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'missing-mock.ts',
            line: 1,
            message:
              'Resource "db.main" declares no mock factory. Add a mock() so testAll(app) runs without configuration, or declare unmockable: { reason } if it intentionally cannot be mocked.',
            rule: 'resource-mock-coverage',
            severity: 'warn',
          },
        ],
      },
      input: {
        filePath: 'missing-mock.ts',
        sourceCode: `const db = resource("db.main", {
  create: () => Result.ok(openDatabase()),
});`,
      },
      name: 'Resource without a mock factory or unmockable reason is flagged',
    },
  ],
  rule: resourceMockCoverage,
});
