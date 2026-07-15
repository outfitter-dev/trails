import { governedVocabularyPermutationWatch } from '../rules/governed-vocabulary-permutation-watch.js';
import { wrapRule } from './wrap-rule.js';

export const governedVocabularyPermutationWatchTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'packages/example/src/trails/play.ts',
        sourceCode: 'const entityId = "track";\n',
      },
      name: 'Project history watch runs at the project boundary',
    },
  ],
  rule: governedVocabularyPermutationWatch,
});
