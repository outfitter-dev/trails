import { resolvedImportBoundary } from '../rules/resolved-import-boundary.js';
import { wrapRule } from './wrap-rule.js';

export const resolvedImportBoundaryTrail = wrapRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: 'packages/app/src/index.ts',
            line: 1,
            message:
              'Import "@fixture/core/internal/secret" is not exported by @fixture/core. Import the package root or an exported subpath instead.',
            rule: 'resolved-import-boundary',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: 'packages/app/src/index.ts',
        importResolutionsByFile: {
          'packages/app/src/index.ts': [
            {
              crossesPackageBoundary: true,
              errorKind: 'package-path-not-exported',
              importSource: '@fixture/core/internal/secret',
              importerPath: 'packages/app/src/index.ts',
              isInternalTarget: false,
              line: 1,
              packageName: '@fixture/core',
              usesPublicExport: false,
            },
          ],
        },
        knownTrailIds: [],
        sourceCode: "import { secret } from '@fixture/core/internal/secret';\n",
      },
      name: 'Compose-package imports must use exported package subpaths',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'packages/app/src/index.ts',
            line: 1,
            message:
              'Local import "../../core/src/public" composes into @fixture/core. Import the target package public surface instead.',
            rule: 'resolved-import-boundary',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: 'packages/app/src/index.ts',
        importResolutionsByFile: {
          'packages/app/src/index.ts': [
            {
              crossesPackageBoundary: true,
              importSource: '../../core/src/public',
              importerPath: 'packages/app/src/index.ts',
              isInternalTarget: false,
              line: 1,
              packageName: '@fixture/core',
              usesPublicExport: false,
            },
          ],
        },
        knownTrailIds: [],
        sourceCode: "import { pub } from '../../core/src/public';\n",
      },
      name: 'Relative imports must not compose package boundaries',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'packages/app/src/index.ts',
            line: 1,
            message:
              'Import "../../core/src/internal/secret" targets internal/private files in @fixture/core. Import the target package public surface instead.',
            rule: 'resolved-import-boundary',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: 'packages/app/src/index.ts',
        importResolutionsByFile: {
          'packages/app/src/index.ts': [
            {
              crossesPackageBoundary: true,
              importSource: '../../core/src/internal/secret',
              importerPath: 'packages/app/src/index.ts',
              isInternalTarget: true,
              line: 1,
              packageName: '@fixture/core',
              usesPublicExport: false,
            },
          ],
        },
        knownTrailIds: [],
        sourceCode:
          "import { secret } from '../../core/src/internal/secret';\n",
      },
      name: 'Compose-package imports must not target internals',
    },
  ],
  rule: resolvedImportBoundary,
});
