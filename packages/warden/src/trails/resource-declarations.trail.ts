import { resourceDeclarations } from '../rules/resource-declarations.js';
import { wrapRule } from './wrap-rule.js';

export const resourceDeclarationsTrail = wrapRule({
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
  blaze: async (_input, ctx) => {
    return Result.ok(db.from(ctx));
  }
})`,
      },
      name: 'Matched resource declarations and usage',
    },
  ],
  rule: resourceDeclarations,
});
