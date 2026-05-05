import { noDevPermitInSource } from '../rules/no-dev-permit-in-source.js';
import { wrapRule } from './wrap-rule.js';

export const noDevPermitInSourceTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'apps/example/src/cli.ts',
        sourceCode: `import { tokenPreset } from '@ontrails/cli';\n`,
      },
      name: 'Source files without --dev-permit are clean',
    },
  ],
  rule: noDevPermitInSource,
});
