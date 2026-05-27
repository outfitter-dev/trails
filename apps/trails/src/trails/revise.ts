import { Result, ValidationError, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  findLifecycleTrail,
  forkVersionEntrySource,
  parseLifecycleTarget,
  reviseTrailSource,
  withLifecycleApp,
} from './version-lifecycle-support.js';

export const reviseTrail = trail('revise', {
  args: ['target'],
  blaze: async (input, ctx) =>
    withLifecycleApp(input, ctx.cwd, async (app, rootDir) => {
      const target = parseLifecycleTarget(input.target);
      if (target.isErr()) {
        return target;
      }
      if (target.value.version !== undefined) {
        return input.as === 'fork'
          ? forkVersionEntrySource(rootDir, target.value)
          : Result.err(
              new ValidationError(
                'Revising a specific historical entry requires --as fork'
              )
            );
      }
      const found = findLifecycleTrail(app, target.value.trailId);
      if (found.isErr()) {
        return found;
      }
      return reviseTrailSource(rootDir, found.value, input.as);
    }),
  description: 'Scaffold the next trail version entry',
  input: z.object({
    as: z
      .enum(['revision', 'fork'])
      .default('revision')
      .describe('Version entry shape to scaffold'),
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
    target: z.string().min(1).describe('Trail target, optionally trail.id@N'),
  }),
  intent: 'write',
  output: z.object({
    file: z.string(),
    trailId: z.string(),
    updated: z.boolean(),
    warnings: z.array(z.string()).optional(),
  }),
  permit: { scopes: ['version:write'] },
});
