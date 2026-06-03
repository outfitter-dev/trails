import { noRetiredCrossVocabulary } from '../rules/no-retired-cross-vocabulary.js';
import { wrapRule } from './wrap-rule.js';

export const noRetiredCrossVocabularyTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'apps/example/src/trails/play.ts',
        sourceCode: 'export const play = trail("play", { composes: [] });\n',
      },
      name: 'Source files using compose vocabulary are clean',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'apps/example/src/trails/play.ts',
            fix: {
              class: 'term-rewrite',
              edits: [{ end: 43, replacement: 'composes', start: 36 }],
              reason:
                "Retired composition vocabulary 'crosses' has a mechanical beta.19 replacement 'composes'.",
              safety: 'safe',
            },
            line: 1,
            message:
              "Retired composition vocabulary 'crosses' should be 'composes' after the beta.19 compose cutover.",
            rule: 'no-retired-cross-vocabulary',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: 'apps/example/src/trails/play.ts',
        sourceCode: 'export const play = trail("play", { crosses: [] });\n',
      },
      name: 'Retired crosses declarations produce safe migration diagnostics',
    },
  ],
  rule: noRetiredCrossVocabulary,
});
