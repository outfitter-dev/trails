import { noLegacyLayerImports } from '../rules/no-legacy-layer-imports.js';
import { wrapRule } from './wrap-rule.js';

export const noLegacyLayerImportsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'apps/example/src/cli.ts',
        sourceCode: `import { tokenPreset } from '@ontrails/cli';\n`,
      },
      name: 'Source files without legacy layer references are clean',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'apps/example/src/cli.ts',
            line: 1,
            message:
              "Legacy layer 'authLayer' was removed in TRL-475. Permit enforcement is intrinsic to executeTrail. See docs/adr/drafts/20260409-layer-evolution.md.",
            rule: 'no-legacy-layer-imports',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: 'apps/example/src/cli.ts',
        sourceCode: `import { authLayer } from '@ontrails/permits';\n`,
      },
      name: 'Legacy layer imports produce migration diagnostics',
    },
  ],
  rule: noLegacyLayerImports,
});
