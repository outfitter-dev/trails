import { wardenExportSymmetry } from '../rules/warden-export-symmetry.js';
import { wrapRule } from './wrap-rule.js';

export const wardenExportSymmetryTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'packages/other-pkg/src/index.ts',
        sourceCode: `export { somethingElse } from './other.js';\n`,
      },
      name: 'Ignores files outside the warden barrel',
    },
  ],
  rule: wardenExportSymmetry,
});
