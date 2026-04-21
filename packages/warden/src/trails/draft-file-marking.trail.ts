import { draftFileMarking } from '../rules/draft-file-marking.js';
import { wrapRule } from './wrap-rule.js';

export const draftFileMarkingTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `export const id = "notes.list";`,
      },
      name: 'File without draft ids passes',
    },
  ],
  rule: draftFileMarking,
});
