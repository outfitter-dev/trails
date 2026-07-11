import { capturedKernel } from '../rules/captured-kernel.js';
import { wrapRule } from './wrap-rule.js';

export const capturedKernelTrail = wrapRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: 'packages/core/src/kernel.ts',
            guidance: {
              steps: [
                'Review whether the public subpath should become an owned package surface, move back behind the package root, or be split into a better-owned package.',
                'If the imported capability is reusable source-code machinery, serves at least two independently owned toolchain capabilities, exposes one genuinely shared contract, and owns no verdict, migration plan, graph query, or surface rendering, consider relocating it to @ontrails/source.',
                'Otherwise, preserve the current owner or choose another doctrinal owner.',
              ],
              summary:
                'Review ownership before an internal re-exported kernel hardens into a public package seam.',
            },
            line: 1,
            message:
              '@ontrails/core export target "@ontrails/core/kernel" re-exports internal target "./internal/kernel.js" and is consumed by external production packages @ontrails/cli, @ontrails/store. Review ownership of the exported subpath and its captured kernel before it becomes a durable public seam.',
            rule: 'captured-kernel',
            severity: 'warn',
          },
        ],
      },
      input: {
        filePath: 'packages/core/src/kernel.ts',
        importResolutionsByFile: {
          'packages/cli/src/index.ts': [
            {
              crossesPackageBoundary: true,
              importSource: '@ontrails/core/kernel',
              importerPath: 'packages/cli/src/index.ts',
              isInternalTarget: false,
              line: 1,
              packageName: '@ontrails/core',
              packageRoot: 'packages/core',
              resolvedPath: 'packages/core/src/kernel.ts',
              usesPublicExport: true,
            },
          ],
          'packages/core/src/kernel.ts': [
            {
              crossesPackageBoundary: false,
              importSource: './internal/kernel.js',
              importerPath: 'packages/core/src/kernel.ts',
              isInternalTarget: true,
              line: 1,
              packageName: '@ontrails/core',
              packageRoot: 'packages/core',
              resolvedPath: 'packages/core/src/internal/kernel.ts',
              usesPublicExport: false,
            },
          ],
          'packages/store/src/index.ts': [
            {
              crossesPackageBoundary: true,
              importSource: '@ontrails/core/kernel',
              importerPath: 'packages/store/src/index.ts',
              isInternalTarget: false,
              line: 1,
              packageName: '@ontrails/core',
              packageRoot: 'packages/core',
              resolvedPath: 'packages/core/src/kernel.ts',
              usesPublicExport: true,
            },
          ],
        },
        knownTrailIds: [],
        publicWorkspaces: {
          '@ontrails/cli': {
            exportTargets: {
              '@ontrails/cli': 'packages/cli/src/index.ts',
            },
            hasExports: true,
            name: '@ontrails/cli',
            packageJsonPath: 'packages/cli/package.json',
            rootDir: 'packages/cli',
          },
          '@ontrails/core': {
            exportTargets: {
              '@ontrails/core': 'packages/core/src/index.ts',
              '@ontrails/core/kernel': 'packages/core/src/kernel.ts',
            },
            hasExports: true,
            name: '@ontrails/core',
            packageJsonPath: 'packages/core/package.json',
            rootDir: 'packages/core',
          },
          '@ontrails/store': {
            exportTargets: {
              '@ontrails/store': 'packages/store/src/index.ts',
            },
            hasExports: true,
            name: '@ontrails/store',
            packageJsonPath: 'packages/store/package.json',
            rootDir: 'packages/store',
          },
        },
        sourceCode: "export { kernel } from './internal/kernel.js';\n",
      },
      name: 'Flags captured kernels consumed by multiple production packages',
    },
  ],
  rule: capturedKernel,
});
