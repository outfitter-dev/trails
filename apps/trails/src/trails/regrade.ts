/**
 * `regrade` trail -- Run downstream migration checks and safe rewrites.
 */

import {
  InternalError,
  NotFoundError,
  Result,
  ValidationError,
  trail,
  validateOutput,
} from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import {
  loadWardenTermRewriteClasses,
  regradeReportOutput,
  runRegrade,
  runVocabularyRegrade,
} from '@ontrails/regrade';
import type { RegradeReport, VocabularyRegradePlan } from '@ontrails/regrade';
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
  exclude: z
    .array(z.string())
    .optional()
    .describe(
      'Root-relative path patterns to exclude in vocabulary regrade mode'
    ),
  extensions: z
    .array(z.string())
    .optional()
    .describe('Source file extensions to scan in vocabulary regrade mode'),
  from: z
    .string()
    .min(1)
    .optional()
    .describe('Source vocabulary term for a vocabulary regrade'),
  include: z
    .array(z.string())
    .optional()
    .describe(
      'Root-relative path patterns to include in vocabulary regrade mode'
    ),
  includeEntries: z
    .enum(['actionable', 'all'])
    .default('actionable')
    .describe(
      'Report entry detail to include; counts always cover the full run'
    ),
  intent: z
    .string()
    .optional()
    .describe('Human-authored migration intent for a vocabulary regrade'),
  overrides: z
    .record(z.string().min(1), z.string().min(1))
    .optional()
    .describe('Explicit source-form to target-form mappings'),
  preserve: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Regex or literal contexts to preserve during a vocabulary regrade'
    ),
  rootDir: z.string().optional().describe('Workspace root directory'),
  to: z
    .string()
    .min(1)
    .optional()
    .describe('Target vocabulary term for a vocabulary regrade'),
});

const hasVocabularyInput = (input: z.output<typeof regradeInputSchema>) =>
  input.exclude !== undefined ||
  input.extensions !== undefined ||
  input.from !== undefined ||
  input.include !== undefined ||
  input.intent !== undefined ||
  input.overrides !== undefined ||
  input.preserve !== undefined ||
  input.to !== undefined;

const buildVocabularyPlan = (
  input: z.output<typeof regradeInputSchema>
): TrailsResult<VocabularyRegradePlan, ValidationError> => {
  if (input.from === undefined || input.to === undefined) {
    return Result.err(
      new ValidationError('A vocabulary regrade requires both `from` and `to`.')
    );
  }
  if (input.classIds !== undefined) {
    return Result.err(
      new ValidationError(
        '`classIds` selects class-mode Regrade and cannot be combined with vocabulary-regrade `from`/`to`.'
      )
    );
  }

  return Result.ok({
    from: input.from,
    id: `vocabulary:${input.from}->${input.to}`,
    kind: 'vocabulary',
    ...(input.intent === undefined ? {} : { intent: input.intent }),
    ...(input.overrides === undefined ? {} : { overrides: input.overrides }),
    ...(input.preserve === undefined
      ? {}
      : {
          preserve: input.preserve.map((pattern) => ({
            pattern,
            reason: 'preserved-by-operator-input',
          })),
        }),
    scope: {
      ...(input.exclude === undefined ? {} : { exclude: input.exclude }),
      ...(input.extensions === undefined
        ? {}
        : { extensions: input.extensions }),
      ...(input.include === undefined ? {} : { include: input.include }),
    },
    to: input.to,
  });
};

export const regradeTrail = trail('regrade', {
  args: ['from', 'to'],
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }

    if (hasVocabularyInput(input)) {
      const planResult = buildVocabularyPlan(input);
      if (planResult.isErr()) {
        return planResult;
      }
      const reportResult: TrailsResult<RegradeReport | null, Error> =
        runVocabularyRegrade({
          apply: input.apply,
          includeEntries: input.includeEntries,
          plan: planResult.value,
          root: rootDirResult.value,
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
    }

    const classSet = await loadWardenTermRewriteClasses(rootDirResult.value);
    if (classSet.diagnostics.length > 0) {
      return Result.err(
        new InternalError('Failed to load Regrade project Warden rules.', {
          context: {
            diagnostics: classSet.diagnostics,
            rootDir: rootDirResult.value,
          },
        })
      );
    }

    const reportResult: TrailsResult<RegradeReport | null, Error> = runRegrade({
      apply: input.apply,
      classes: classSet.classes,
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
