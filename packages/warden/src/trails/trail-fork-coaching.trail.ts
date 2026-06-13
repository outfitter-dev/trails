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
              'Trail "users.manage" branches on input.action ("create", "delete"). This may be a trail fork hidden as a surface accommodation. If branches change intent, permits, errors, outputs, lifecycle, side effects, or selected trail identity, split them into distinct trails, a composing trail, or an honest facet.',
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
  blaze: async (input) => {
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
