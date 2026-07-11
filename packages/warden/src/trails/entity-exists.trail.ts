import { entityExists } from '../rules/entity-exists.js';
import { wrapRule } from './wrap-rule.js';

export const entityExistsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'entity.ts',
        knownEntityIds: ['user'],
        knownTrailIds: ['user.create'],
        sourceCode: `trail("user.create", {
  entities: [user],
  implementation: async (input, ctx) => Result.ok({ ok: true }),
})`,
      },
      name: 'Declared entities resolve to known project entities',
    },
  ],
  rule: entityExists,
});
