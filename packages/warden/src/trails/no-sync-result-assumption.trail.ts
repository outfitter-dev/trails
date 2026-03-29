import { noSyncResultAssumption } from '../rules/no-sync-result-assumption.js';
import { wrapRule } from './wrap-rule.js';

export const noSyncResultAssumptionTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `const result = await myTrail.run(input, ctx);
if (result.isOk()) {
  console.log(result.value);
}`,
      },
      name: 'Properly awaited .run() call',
    },
  ],
  rule: noSyncResultAssumption,
});
