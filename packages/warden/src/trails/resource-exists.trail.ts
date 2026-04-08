import { resourceExists } from '../rules/resource-exists.js';
import { wrapRule } from './wrap-rule.js';

export const resourceExistsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        knownResourceIds: ['db.main'],
        knownTrailIds: ['entity.show'],
        sourceCode: `const db = resource("db.main", {
  create: () => Result.ok({ source: "factory" }),
});

trail("entity.show", {
  resources: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(db.from(ctx));
  }
})`,
      },
      name: 'Declared resources resolve to known project resources',
    },
  ],
  rule: resourceExists,
});
