import { Result, ValidationError, trail } from '@ontrails/core';
import { z } from 'zod';

import { resetDevState } from './dev-support.js';
import { createIsolatedExampleInput } from './topo-support.js';

export const devResetTrail = trail('dev.reset', {
  blaze: (input, ctx) => {
    if (input.dryRun !== true && input.yes !== true) {
      return Result.err(
        new ValidationError(
          'Refusing to reset local state without `--yes` or `--dry-run`.'
        )
      );
    }

    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    return Result.ok(resetDevState({ dryRun: input.dryRun, rootDir }));
  },
  description: 'Remove local Trails database artifacts',
  examples: [
    {
      input: {
        dryRun: true,
        rootDir: createIsolatedExampleInput('dev-reset').rootDir,
      },
      name: 'Preview local reset',
    },
  ],
  input: z.object({
    dryRun: z
      .boolean()
      .default(true)
      .describe('Preview reset without changing state'),
    rootDir: z.string().optional().describe('Workspace root directory'),
    yes: z.boolean().default(false).describe('Confirm destructive changes'),
  }),
  intent: 'destroy',
  output: z.object({
    dryRun: z.boolean(),
    removedCount: z.number(),
    removedFiles: z.array(z.string()),
  }),
});
