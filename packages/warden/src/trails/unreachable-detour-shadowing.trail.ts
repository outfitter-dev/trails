import { unreachableDetourShadowing } from '../rules/unreachable-detour-shadowing.js';
import { wrapRule } from './wrap-rule.js';

export const unreachableDetourShadowingTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `trail("entity.save", {
  detours: [
    { on: ConflictError, recover: async () => Result.ok({ winner: "specific" }) },
    { on: TrailsError, recover: async () => Result.ok({ winner: "broad" }) },
  ],
});`,
      },
      name: 'Specific detours can precede broader ones',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'shadowed.ts',
            line: 4,
            message:
              'Trail "entity.save" declares detour on "ConflictError" after earlier detour on "TrailsError". Because "TrailsError" matches "ConflictError" first, the later detour is unreachable.',
            rule: 'unreachable-detour-shadowing',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: 'shadowed.ts',
        sourceCode: `trail("entity.save", {
  detours: [
    { on: TrailsError, recover: async () => Result.ok({ winner: "broad" }) },
    { on: ConflictError, recover: async () => Result.ok({ winner: "specific" }) },
  ],
});`,
      },
      name: 'Broader detours declared first shadow later specific ones',
    },
  ],
  rule: unreachableDetourShadowing,
});
