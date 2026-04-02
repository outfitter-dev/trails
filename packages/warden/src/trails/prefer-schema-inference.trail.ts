import { preferSchemaInference } from '../rules/prefer-schema-inference.js';
import { wrapRule } from './wrap-rule.js';

export const preferSchemaInferenceTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.show", {
  input: z.object({ name: z.string() }),
  blaze: async (input, ctx) => {
    return Result.ok({ name: input.name });
  }
})`,
      },
      name: 'Trail without redundant field overrides',
    },
  ],
  rule: preferSchemaInference,
});
