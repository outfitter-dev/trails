/**
 * `regrade` trail -- Run downstream migration checks and safe rewrites.
 */

import { NotFoundError, Result, trail, validateOutput } from '@ontrails/core';
import {
  regradeReportOutput,
  runRegrade,
  wardenTermRewriteClasses,
} from '@ontrails/regrade';
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
  rootDir: z.string().optional().describe('Workspace root directory'),
});

export const regradeTrail = trail('regrade', {
  blaze: (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }

    const reportResult = runRegrade({
      apply: input.apply,
      classes: wardenTermRewriteClasses,
      root: rootDirResult.value,
      ...(input.classIds === undefined
        ? {}
        : { selection: { classIds: input.classIds } }),
    });
    if (reportResult.isErr()) {
      return Result.err(reportResult.error);
    }

    const report = reportResult.value;
    if (report === null) {
      return Result.err(
        new NotFoundError(
          `Regrade root "${rootDirResult.value}" could not be read as a directory.`
        )
      );
    }

    const validated = validateOutput(regradeReportOutput, report);
    if (validated.isErr()) {
      return Result.err(validated.error);
    }

    return Result.ok(validated.value);
  },
  description: 'Run downstream migration checks and safe rewrites',
  input: regradeInputSchema,
  intent: 'write',
  output: regradeReportOutput,
  permit: 'public',
});
