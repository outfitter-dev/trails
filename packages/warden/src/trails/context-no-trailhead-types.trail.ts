import { contextNoTrailheadTypes } from '../rules/context-no-trailhead-types.js';
import { wrapRule } from './wrap-rule.js';

export const contextNoTrailheadTypesTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `import { trail, Result } from "@ontrails/core";
trail("entity.show", {
  blaze: async (input, ctx) => {
    return Result.ok({ name: "test" });
  }
})`,
      },
      name: 'Clean trail without trailhead imports',
    },
  ],
  rule: contextNoTrailheadTypes,
});
