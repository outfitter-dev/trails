import { trail } from '@ontrails/core';
import { z } from 'zod';

import {
  parseLifecycleTarget,
  setVersionStatusSource,
  withLifecycleApp,
} from './version-lifecycle-support.js';

export const deprecateTrail = trail('deprecate', {
  args: ['target'],
  blaze: async (input, ctx) =>
    withLifecycleApp(input, ctx.cwd, async (_app, rootDir) => {
      const target = parseLifecycleTarget(input.target);
      if (target.isErr()) {
        return target;
      }
      return setVersionStatusSource(
        rootDir,
        target.value,
        input.archive ? 'archived' : 'deprecated',
        {
          migration: input.migration,
          note: input.note,
          reason: input.reason,
          successor: input.successor,
        }
      );
    }),
  description: 'Mark a historical trail version deprecated or archived',
  input: z.object({
    archive: z
      .boolean()
      .default(false)
      .describe('Archive instead of deprecate'),
    migration: z
      .array(z.string())
      .default([])
      .describe('Migration guidance entries'),
    module: z.string().optional().describe('Path to the app module'),
    note: z.string().optional().describe('Deprecation note'),
    reason: z.string().optional().describe('Archive reason'),
    rootDir: z.string().optional().describe('Workspace root directory'),
    successor: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Successor version'),
    target: z.string().min(1).describe('Historical version target trail.id@N'),
  }),
  intent: 'write',
  output: z.object({
    file: z.string(),
    trailId: z.string(),
    updated: z.boolean(),
  }),
});
