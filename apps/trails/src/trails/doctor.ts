import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  deriveDoctorSummary,
  withLifecycleApp,
} from './version-lifecycle-support.js';

export const doctorTrail = trail('doctor', {
  blaze: async (input, ctx) =>
    withLifecycleApp(input, ctx.cwd, async (app) =>
      Result.ok(deriveDoctorSummary(app))
    ),
  description: 'Diagnose trail versioning lifecycle state',
  input: z.object({
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: z.object({
    archived: z.number(),
    deprecated: z.number(),
    forceEvents: z.number(),
    mode: z.literal('doctor'),
    trails: z.number(),
    versioned: z.number(),
  }),
});
