import { noThrowInDetourRecover } from '../rules/no-throw-in-detour-recover.js';
import { wrapRule } from './wrap-rule.js';

export const noThrowInDetourRecoverTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.save", {
  detours: [
    {
      on: ConflictError,
      recover: async () => Result.ok({ recovered: true }),
    },
  ],
  blaze: () => Result.err(new ConflictError("conflict")),
})`,
      },
      name: 'Detour recover without throw',
    },
  ],
  rule: noThrowInDetourRecover,
});
