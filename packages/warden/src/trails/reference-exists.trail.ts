import { referenceExists } from '../rules/reference-exists.js';
import { wrapRule } from './wrap-rule.js';

export const referenceExistsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'contours.ts',
        knownContourIds: ['gist', 'user'],
        knownTrailIds: [],
        sourceCode: `const user = contour("user", {
  id: z.string().uuid(),
}, { identity: "id" });

const gist = contour("gist", {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: "id" });`,
      },
      name: 'Contour references resolve to known project contours',
    },
  ],
  rule: referenceExists,
});
