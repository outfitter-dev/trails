/**
 * `ci.drift` trail — runs drift detection with CI-friendly output.
 */

import { Result, trail } from '@ontrails/core';
import { checkDrift } from '@ontrails/warden';
import { z } from 'zod';

import { formatCiOutput } from '../formatters.js';

export const ciDriftTrail = trail('ci.drift', {
  blaze: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const driftResult = await checkDrift(rootDir);

    const output = formatCiOutput('summary', {
      driftResult,
      wardenReport: {
        diagnostics: [],
        drift: driftResult,
        errorCount: 0,
        passed: !driftResult.stale,
        warnCount: 0,
      },
    });

    return Result.ok({
      hasDrift: driftResult.stale,
      output,
    });
  },
  description: 'Run trailhead lock drift detection',
  examples: [
    {
      input: {},
      name: 'Default drift check',
    },
  ],
  input: z.object({
    rootDir: z.string().optional().describe('Root directory to scan'),
  }),
  intent: 'read',
  output: z.object({
    hasDrift: z.boolean(),
    output: z.string(),
  }),
});
