import { provisionDeclarations } from '../rules/provision-declarations.js';
import { wrapRule } from './wrap-rule.js';

export const provisionDeclarationsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
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
      name: 'Matched provision declarations and usage',
    },
  ],
  rule: provisionDeclarations,
});
