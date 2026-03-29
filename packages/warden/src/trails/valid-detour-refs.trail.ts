import { validDetourRefs } from '../rules/valid-detour-refs.js';
import { wrapRule } from './wrap-rule.js';

export const validDetourRefsTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        knownTrailIds: ['entity.fallback', 'entity.show'],
        sourceCode: `trail("entity.fallback", {
  run: async (input, ctx) => Result.ok(data)
})

trail("entity.show", {
  detours: [{ target: "entity.fallback" }],
  run: async (input, ctx) => Result.ok(data)
})`,
      },
      name: 'Valid detour target reference',
    },
  ],
  rule: validDetourRefs,
});
