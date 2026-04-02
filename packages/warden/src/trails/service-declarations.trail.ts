import { serviceDeclarations } from '../rules/service-declarations.js';
import { wrapRule } from './wrap-rule.js';

export const serviceDeclarationsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
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
      name: 'Matched service declarations and usage',
    },
  ],
  rule: serviceDeclarations,
});
