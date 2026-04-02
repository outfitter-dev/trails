import { provisionExists } from '../rules/provision-exists.js';
import { wrapRule } from './wrap-rule.js';

export const provisionExistsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        knownProvisionIds: ['db.main'],
        knownTrailIds: ['entity.show'],
        sourceCode: `const db = provision("db.main", {
  create: () => Result.ok({ source: "factory" }),
});

trail("entity.show", {
  provisions: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(db.from(ctx));
  }
})`,
      },
      name: 'Declared provisions resolve to known project provisions',
    },
  ],
  rule: provisionExists,
});
