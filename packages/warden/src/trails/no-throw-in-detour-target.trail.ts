import { noThrowInDetourTarget } from '../rules/no-throw-in-detour-target.js';
import { wrapRule } from './wrap-rule.js';

export const noThrowInDetourTargetTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.fallback", {
  run: async (input, ctx) => {
    return Result.ok({ recovered: true });
  }
})`,
      },
      name: 'Detour target without throw',
    },
  ],
  rule: noThrowInDetourTarget,
});
