import { missingVisibility } from '../rules/missing-visibility.js';
import { wrapRule } from './wrap-rule.js';

export const missingVisibilityTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        composeTargetTrailIds: ['entity.resolve'],
        filePath: 'clean.ts',
        knownTrailIds: ['entity.resolve'],
        sourceCode: `trail('entity.resolve', {
  visibility: 'internal',
  composeInput: z.object({ forkedFrom: z.string() }),
  blaze: async () => Result.ok({}),
});`,
      },
      name: 'Composition-only trails stay quiet when already internal',
    },
  ],
  rule: missingVisibility,
});
