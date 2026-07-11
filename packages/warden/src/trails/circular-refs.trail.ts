import { circularRefs } from '../rules/circular-refs.js';
import { wrapRule } from './wrap-rule.js';

export const circularRefsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        entityReferencesByName: {
          gist: ['user'],
          user: [],
        },
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
      name: 'Acyclic entity references stay clean',
    },
  ],
  rule: circularRefs,
});
