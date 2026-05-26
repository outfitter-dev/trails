import { publicInternalDeepImports } from '../rules/public-internal-deep-imports.js';
import { wrapRule } from './wrap-rule.js';

export const publicInternalDeepImportsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'packages/store/src/trails/example.ts',
        importResolutionsByFile: {
          'packages/store/src/trails/example.ts': [
            {
              crossesPackageBoundary: true,
              importSource: '@ontrails/core/trails',
              importerPath: 'packages/store/src/trails/example.ts',
              isInternalTarget: false,
              line: 1,
              packageName: '@ontrails/core',
              packageRoot: 'packages/core',
              resolvedPath: 'packages/core/src/trails/index.ts',
              usesPublicExport: true,
            },
          ],
        },
        knownTrailIds: [],
        publicWorkspaces: {
          '@ontrails/core': {
            hasExports: true,
            name: '@ontrails/core',
            packageJsonPath: 'packages/core/package.json',
            rootDir: 'packages/core',
          },
          '@ontrails/store': {
            hasExports: true,
            name: '@ontrails/store',
            packageJsonPath: 'packages/store/package.json',
            rootDir: 'packages/store',
          },
        },
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
              '@ontrails specifier "@ontrails/core/src/internal/hidden" is not exported by @ontrails/core. Use the package root or an exported subpath; if the API is missing, add an owner export follow-up instead of importing internals.',
            rule: 'public-internal-deep-imports',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: 'packages/store/src/trails/example.ts',
        importResolutionsByFile: {
          'packages/store/src/trails/example.ts': [
            {
              crossesPackageBoundary: true,
              errorKind: 'package-path-not-exported',
              importSource: '@ontrails/core/src/internal/hidden',
              importerPath: 'packages/store/src/trails/example.ts',
              isInternalTarget: false,
              line: 1,
              packageName: '@ontrails/core',
              usesPublicExport: false,
            },
          ],
        },
        knownTrailIds: [],
        publicWorkspaces: {
          '@ontrails/core': {
            hasExports: true,
            name: '@ontrails/core',
            packageJsonPath: 'packages/core/package.json',
            rootDir: 'packages/core',
          },
          '@ontrails/store': {
            hasExports: true,
            name: '@ontrails/store',
            packageJsonPath: 'packages/store/package.json',
            rootDir: 'packages/store',
          },
        },
        sourceCode: `import { hidden } from '@ontrails/core/src/internal/hidden';\n`,
      },
      name: 'Flags compose-package imports into owner internals',
    },
  ],
  rule: publicInternalDeepImports,
});
