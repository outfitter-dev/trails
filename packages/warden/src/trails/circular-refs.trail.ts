import { circularRefs } from '../rules/circular-refs.js';
import { wrapRule } from './wrap-rule.js';

export const circularRefsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        contourReferencesByName: {
          gist: ['user'],
          user: [],
        },
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
      name: 'Acyclic contour references stay clean',
    },
  ],
  rule: circularRefs,
});
