import { trailForkCoaching } from '../rules/trail-fork-coaching.js';
import { wrapRule } from './wrap-rule.js';

export const trailForkCoachingTrail = wrapRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: 'users.ts',
            line: 9,
            message:
              'Trail "users.manage" branches on input.action ("create", "delete"). This may be a trail fork hidden as a surface accommodation. If branches change semantics (intent, permits, errors, outputs, lifecycle, or side effects) or structure (selected trail identity), split them into distinct trails, a composing trail, or a trailhead that preserves member identity.',
            rule: 'trail-fork-coaching',
            severity: 'warn',
          },
        ],
      },
      input: {
        filePath: 'users.ts',
        sourceCode: `import { Result, trail } from "@ontrails/core";
import { z } from "zod";

export const usersManage = trail("users.manage", {
  input: z.object({
    action: z.enum(["create", "delete"]),
  }),
  implementation: async (input) => {
    switch (input.action) {
      case "create":
        return Result.ok({ created: true });
      case "delete":
        return Result.ok({ deleted: true });
    }
  },
});`,
      },
      name: 'Possible trail fork hidden behind action',
    },
  ],
  rule: trailForkCoaching,
});
