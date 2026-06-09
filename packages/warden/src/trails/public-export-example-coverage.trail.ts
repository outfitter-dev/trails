import { publicExportExampleCoverage } from '../rules/public-export-example-coverage.js';
import { wrapRule } from './wrap-rule.js';

export const publicExportExampleCoverageTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'packages/other-pkg/src/index.ts',
        sourceCode: `export { somethingElse } from './other.js';\n`,
      },
      name: 'Ignores barrels outside the public API example policy',
    },
  ],
  rule: publicExportExampleCoverage,
});
