import { staticResourceAccessorPreference } from '../rules/static-resource-accessor-preference.js';
import { wrapRule } from './wrap-rule.js';

export const staticResourceAccessorPreferenceTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `const db = resource("db.main", {
  create: () => Result.ok({ source: "factory" }),
});

trail("entity.show", {
  resources: [db],
  implementation: async (_input, ctx) => {
    return Result.ok(db.from(ctx));
  }
})`,
      },
      name: 'Static resource helper access',
    },
  ],
  rule: staticResourceAccessorPreference,
});
