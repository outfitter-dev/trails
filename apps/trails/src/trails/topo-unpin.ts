import { Result, ValidationError, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  createIsolatedExampleInput,
  removeTopoPin,
  topoPinOutput,
} from './topo-support.js';

export const topoUnpinTrail = trail('topo.unpin', {
  blaze: (input, ctx) => {
    if (input.dryRun !== true && input.yes !== true) {
      return Result.err(
        new ValidationError(
          'Refusing to remove a pin without `--yes` or `--dry-run`.'
        )
      );
    }

    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    return Result.ok(
      removeTopoPin({ dryRun: input.dryRun, name: input.name, rootDir })
    );
  },
  description: 'Remove a named topo pin',
  examples: [
    {
      input: {
        ...createIsolatedExampleInput('topo-unpin'),
        dryRun: true,
        name: 'before-auth-refactor',
      },
      name: 'Preview pin removal',
    },
  ],
  input: z.object({
    dryRun: z
      .boolean()
      .default(true)
      .describe('Preview the removal without changing state'),
    name: z.string().describe('Pin name'),
    rootDir: z.string().optional().describe('Workspace root directory'),
    yes: z.boolean().default(false).describe('Confirm destructive changes'),
  }),
  intent: 'destroy',
  output: z.object({
    dryRun: z.boolean(),
    pin: topoPinOutput.optional(),
    removed: z.boolean(),
  }),
});
