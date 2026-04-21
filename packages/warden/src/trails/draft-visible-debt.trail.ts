import { draftVisibleDebt } from '../rules/draft-visible-debt.js';
import { wrapRule } from './wrap-rule.js';

export const draftVisibleDebtTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `export const id = "notes.list";`,
      },
      name: 'File without draft ids emits no visible-debt diagnostics',
    },
  ],
  rule: draftVisibleDebt,
});
