import { contourExists } from '../rules/contour-exists.js';
import { wrapRule } from './wrap-rule.js';

export const contourExistsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'entity.ts',
        knownContourIds: ['user'],
        knownTrailIds: ['user.create'],
        sourceCode: `trail("user.create", {
  contours: [user],
  blaze: async (input, ctx) => Result.ok({ ok: true }),
})`,
      },
      name: 'Declared contours resolve to known project contours',
    },
  ],
  rule: contourExists,
});
