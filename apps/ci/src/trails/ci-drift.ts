/**
 * `ci.drift` trail — runs drift detection with CI-friendly output.
 */

import { Result, trail } from '@ontrails/core';
import { checkDrift } from '@ontrails/warden';
import { z } from 'zod';

import { createDriftOnlyReport, evaluateCiGovernance } from '../governance.js';

import { resolveCiRootDir } from './root-dir.js';

export const ciDriftTrail = trail('ci.drift', {
  blaze: async (input, ctx) => {
    const rootDirResult = resolveCiRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return Result.err(rootDirResult.error);
    }
    const rootDir = rootDirResult.value;
    const driftResult = await checkDrift(rootDir);
    const output = evaluateCiGovernance({
      driftResult,
      failOn: 'error',
      format: 'summary',
      wardenReport: createDriftOnlyReport(driftResult),
    });

    return Result.ok({
      hasDrift: driftResult.stale,
      output: output.output,
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
