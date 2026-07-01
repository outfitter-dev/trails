import { duplicateExportedSymbol } from '../rules/duplicate-exported-symbol.js';
import { wrapRule } from './wrap-rule.js';

export const duplicateExportedSymbolTrail = wrapRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: '/repo/packages/core/src/index.ts',
            line: 1,
            message:
              'Exported symbol "createClient" is defined by @ontrails/core and also by @ontrails/store (/repo/packages/store/src/index.ts:1). Keep one package as the owner, rename one side, or document a deliberate ownership mirror before exporting both symbols.',
            rule: 'duplicate-exported-symbol',
            severity: 'warn',
          },
        ],
      },
      input: {
        exportedSymbolDefinitionsByName: {
          createClient: [
            {
              filePath: '/repo/packages/core/src/index.ts',
              kind: 'function',
              line: 1,
              name: 'createClient',
              workspaceName: '@ontrails/core',
              workspaceRoot: '/repo/packages/core',
            },
            {
              filePath: '/repo/packages/store/src/index.ts',
              kind: 'function',
              line: 1,
              name: 'createClient',
              workspaceName: '@ontrails/store',
              workspaceRoot: '/repo/packages/store',
            },
          ],
        },
        filePath: '/repo/packages/core/src/index.ts',
        knownTrailIds: [],
        sourceCode: 'export function createClient() {}',
      },
      name: 'Flags duplicate exported symbol definitions across packages',
    },
  ],
  rule: duplicateExportedSymbol,
});
