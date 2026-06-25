/**
 * `regrade` trail -- Run downstream migration checks and safe rewrites.
 */

import { NotFoundError, Result, trail, validateOutput } from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import {
  regradeReportOutput,
  runRegrade,
  wardenTermRewriteClasses,
} from '@ontrails/regrade';
import type { RegradeReport } from '@ontrails/regrade';
import { z } from 'zod';

import { resolveTrailRootDir } from './root-dir.js';

const regradeInputSchema = z.object({
  apply: z
    .boolean()
    .default(false)
    .describe('Write safe rewrites to disk; dry-run report only by default'),
  classIds: z
    .array(z.string())
    .optional()
    .describe('Regrade class ids to run (defaults to all built-in classes)'),
  includeEntries: z
    .enum(['actionable', 'all'])
    .default('actionable')
    .describe(
      'Report entry detail to include; counts always cover the full run'
    ),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

export const regradeTrail = trail('regrade', {
  blaze: (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }

    const reportResult: TrailsResult<RegradeReport | null, Error> = runRegrade({
      apply: input.apply,
      classes: wardenTermRewriteClasses,
      includeEntries: input.includeEntries,
      root: rootDirResult.value,
      ...(input.classIds === undefined
        ? {}
        : { selection: { classIds: input.classIds } }),
    });
    if (reportResult.isErr()) {
      return reportResult;
    }

    const report = reportResult.value;
    if (report === null) {
      return Result.err(
        new NotFoundError(
          `Regrade root "${rootDirResult.value}" could not be read as a directory.`
        )
      );
    }

    const validated: TrailsResult<
      z.output<typeof regradeReportOutput>,
      Error
    > = validateOutput(regradeReportOutput, report);
    if (validated.isErr()) {
      return validated;
    }

    return Result.ok(validated.value);
  },
  description: 'Run downstream migration checks and safe rewrites',
  input: regradeInputSchema,
  intent: 'write',
  output: regradeReportOutput,
  permit: 'public',
});
