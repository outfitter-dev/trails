import { referenceExists } from '../rules/reference-exists.js';
import { wrapRule } from './wrap-rule.js';

export const referenceExistsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'entities.ts',
        knownEntityIds: ['gist', 'user'],
        knownTrailIds: [],
        sourceCode: `const user = entity("user", {
  id: z.string().uuid(),
}, { identity: "id" });

const gist = entity("gist", {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: "id" });`,
      },
      name: 'Entity references resolve to known project entities',
    },
  ],
  rule: referenceExists,
});
