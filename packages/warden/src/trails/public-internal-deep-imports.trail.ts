import { publicInternalDeepImports } from '../rules/public-internal-deep-imports.js';
import { wrapRule } from './wrap-rule.js';

export const publicInternalDeepImportsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'packages/store/src/trails/example.ts',
        sourceCode: `import { deriveTrail } from '@ontrails/core/trails';\n`,
      },
      name: 'Allows exported package subpaths',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'packages/store/src/trails/example.ts',
            line: 1,
            message:
              'public-internal-deep-imports: cross-package import "@ontrails/core/src/internal/hidden" is not exported by @ontrails/core. Use the package root or an exported subpath; if the API is missing, add an owner export follow-up instead of importing internals.',
            rule: 'public-internal-deep-imports',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: 'packages/store/src/trails/example.ts',
        sourceCode: `import { hidden } from '@ontrails/core/src/internal/hidden';\n`,
      },
      name: 'Flags cross-package imports into owner internals',
    },
  ],
  rule: publicInternalDeepImports,
});
