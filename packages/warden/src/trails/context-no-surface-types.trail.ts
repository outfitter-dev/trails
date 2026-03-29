import { contextNoSurfaceTypes } from '../rules/context-no-surface-types.js';
import { wrapRule } from './wrap-rule.js';

export const contextNoSurfaceTypesTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `import { trail, Result } from "@ontrails/core";
trail("entity.show", {
  run: async (input, ctx) => {
    return Result.ok({ name: "test" });
  }
})`,
      },
      name: 'Clean trail without surface imports',
    },
  ],
  rule: contextNoSurfaceTypes,
});
