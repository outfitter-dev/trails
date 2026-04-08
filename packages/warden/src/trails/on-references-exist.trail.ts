import { onReferencesExist } from '../rules/on-references-exist.js';
import { wrapRule } from './wrap-rule.js';

export const onReferencesExistTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'consumer.ts',
        knownSignalIds: ['entity.created'],
        knownTrailIds: ['notify'],
        sourceCode: `trail("notify", {
  on: ["entity.created"],
  blaze: async (input, ctx) => Result.ok({}),
})`,
      },
      name: 'Resolved on: reference',
    },
  ],
  rule: onReferencesExist,
});
