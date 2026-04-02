import { serviceExists } from '../rules/service-exists.js';
import { wrapRule } from './wrap-rule.js';

export const serviceExistsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        knownServiceIds: ['db.main'],
        knownTrailIds: ['entity.show'],
        sourceCode: `const db = service("db.main", {
  create: () => Result.ok({ source: "factory" }),
});

trail("entity.show", {
  services: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(db.from(ctx));
  }
})`,
      },
      name: 'Declared services resolve to known project services',
    },
  ],
  rule: serviceExists,
});
