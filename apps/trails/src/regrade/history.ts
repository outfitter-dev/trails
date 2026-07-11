/**
 * Consolidated, append-only Regrade transition history. One file per
 * transition at `.trails/regrade/history/<transition>.json`; each apply
 * appends a run entry stamped with the plan content hash and the lock hash
 * observed at that run.
 */

import { InternalError, Result, ValidationError } from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import { regradeReportOutput } from '@ontrails/regrade';
import type { RegradeReport } from '@ontrails/regrade';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';

import {
  regradePlanArtifactSchema,
  regradePlanContentHash,
  regradePlanDirectory,
  regradePlanSlugForBody,
  legacyRegradeSourceHash,
  regradeSourceHash,
  regradeSourceHashMatches,
  regradeSourceHashes,
  rootRelativePath,
} from './plan-artifact.js';
import type { RegradePlanArtifact, RegradePlanBody } from './plan-artifact.js';

/**
 * Consolidated history schema version. Version 1 was the retired
 * one-file-per-run shape whose filename carried the lock hash.
 */
export const REGRADE_HISTORY_SCHEMA_VERSION = 2;

const rawCompletionReportHash = Symbol('rawCompletionReportHash');
const rawReportHash = Symbol('rawReportHash');
const rawCompletionReport = Symbol('rawCompletionReport');
const rawReport = Symbol('rawReport');

const regradeHistoryRunSchema = z
  .object({
    completionReport: regradeReportOutput
      .optional()
      .describe(
        'Post-apply source evidence used to recognize a completed-state replay'
      ),
    completionReportHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional()
      .describe('Canonical hash of the post-apply completion report'),
    lockHashAtRun: z
      .string()
      .min(1)
      .describe('Regrade source hash observed when this run applied'),
    plan: regradePlanArtifactSchema.describe(
      'Plan artifact consumed by this run'
    ),
    planContentHash: z
      .string()
      .min(1)
      .describe('Canonical content hash of the resolved plan body'),
    report: regradeReportOutput.describe('Applied report recorded by the run'),
  })
  .strict();

const regradeHistoryArtifactSchema = z
  .object({
    id: z.string().min(1).describe('Stable transition identity'),
    kind: z.literal('regrade-history'),
    path: z.string().describe('Root-relative consolidated history path'),
    runs: z.array(regradeHistoryRunSchema).min(1),
    schemaVersion: z.literal(REGRADE_HISTORY_SCHEMA_VERSION),
  })
  .strict();

interface RegradeHistoryRun {
  readonly [rawCompletionReportHash]?: string;
  readonly [rawCompletionReport]?: RegradeReport;
  readonly [rawReportHash]?: string;
  readonly [rawReport]?: RegradeReport;
  readonly completionReport: RegradeReport;
  readonly completionReportHash: string;
  readonly lockHashAtRun: string;
  readonly plan: RegradePlanArtifact;
  readonly planContentHash: string;
  readonly report: RegradeReport;
}

export interface RegradeHistoryArtifact {
  readonly id: string;
  readonly kind: 'regrade-history';
  readonly path: string;
  readonly runs: readonly RegradeHistoryRun[];
  readonly schemaVersion: typeof REGRADE_HISTORY_SCHEMA_VERSION;
}

export interface RegradeHistorySummary {
  readonly path: string;
  readonly schemaVersion: number;
  readonly status: 'applied' | 'replay';
}

export const regradeHistoryPathForPlan = (
  rootDir: string,
  plan: RegradePlanBody
): string =>
  join(
    regradePlanDirectory(rootDir),
    'history',
    `${regradePlanSlugForBody(plan)}.json`
  );

export const readRegradeHistoryArtifact = (
  path: string
): TrailsResult<RegradeHistoryArtifact, InternalError | ValidationError> => {
  if (!existsSync(path)) {
    return Result.err(
      new ValidationError(`Regrade history "${path}" not found.`)
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return Result.err(
      new InternalError('Failed to read Regrade history artifact.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { path },
      })
    );
  }
  const parsed = regradeHistoryArtifactSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return Result.err(
      new ValidationError('Invalid Regrade history artifact.', {
        context: { issues: parsed.error.issues, path },
      })
    );
  }
  const rawRuns = (
    parsedJson as {
      readonly runs: readonly {
        readonly completionReport?: RegradeReport;
        readonly report: RegradeReport;
      }[];
    }
  ).runs;
  return Result.ok({
    ...parsed.data,
    runs: parsed.data.runs.map((run, index) => {
      // Early schema-v2 histories recorded only the post-apply report. Treat
      // that report and its lock hash as completion evidence when reading
      // those artifacts.
      const completionReport = run.completionReport ?? run.report;
      const normalized = {
        ...run,
        completionReport,
        completionReportHash: run.completionReportHash ?? run.lockHashAtRun,
      } as RegradeHistoryRun;
      const rawRun = rawRuns[index];
      if (rawRun !== undefined) {
        Object.defineProperties(normalized, {
          [rawCompletionReport]: {
            value: rawRun.completionReport ?? rawRun.report,
          },
          [rawCompletionReportHash]: {
            value: legacyRegradeSourceHash(
              rawRun.completionReport ?? rawRun.report
            ),
          },
          [rawReportHash]: {
            value: legacyRegradeSourceHash(rawRun.report),
          },
          [rawReport]: { value: rawRun.report },
        });
      }
      return normalized;
    }),
  } as RegradeHistoryArtifact);
};

/**
 * Deterministic transition identity minted at the first recorded run and
 * preserved for the life of the consolidated history file.
 */
export const mintTransitionId = (
  slug: string,
  planContentHash: string,
  lockHashAtRun: string
): string =>
  createHash('sha256')
    .update(`${slug}\n${planContentHash}\n${lockHashAtRun}`)
    .digest('hex')
    .slice(0, 12);

/**
 * Verify every recorded run at its own stamped lock: recompute the plan
 * content hash and lock hash from the recorded plan and report, then compare
 * with the stamped values.
 */
export const verifyRegradeHistoryRuns = (
  artifact: RegradeHistoryArtifact
): TrailsResult<{ readonly runs: number }, ValidationError> => {
  for (const [index, run] of artifact.runs.entries()) {
    if (regradePlanContentHash(run.plan.plan) !== run.planContentHash) {
      return Result.err(
        new ValidationError('Regrade history run stamp mismatch.', {
          context: {
            field: 'planContentHash',
            path: artifact.path,
            run: index,
          },
        })
      );
    }
    if (
      !regradeSourceHashMatches(run.lockHashAtRun, run.report) &&
      run[rawReportHash] !== run.lockHashAtRun
    ) {
      return Result.err(
        new ValidationError('Regrade history run stamp mismatch.', {
          context: { field: 'lockHashAtRun', path: artifact.path, run: index },
        })
      );
    }
    if (
      !regradeSourceHashMatches(
        run.completionReportHash,
        run.completionReport
      ) &&
      run[rawCompletionReportHash] !== run.completionReportHash
    ) {
      return Result.err(
        new ValidationError('Regrade history run stamp mismatch.', {
          context: {
            field: 'completionReportHash',
            path: artifact.path,
            run: index,
          },
        })
      );
    }
  }
  return Result.ok({ runs: artifact.runs.length });
};

/**
 * Append one applied run to the transition's consolidated history file. A
 * run whose plan content hash and source evidence equal either the last run's
 * pre-apply report or completed state is a replay: nothing is written and
 * `status: 'replay'` is surfaced instead of a duplicate record.
 */
export const appendRegradeHistoryRun = (params: {
  readonly artifact: RegradePlanArtifact;
  readonly completedReport?: RegradeReport;
  readonly report: RegradeReport;
  readonly rootDir: string;
}): TrailsResult<RegradeHistorySummary, Error> => {
  const absolutePath = regradeHistoryPathForPlan(
    params.rootDir,
    params.artifact.plan
  );
  const relativePath = rootRelativePath(params.rootDir, absolutePath);
  const planContentHash = regradePlanContentHash(params.artifact.plan);
  const lockHashAtRun = regradeSourceHash(params.report);
  const currentSourceHashes = regradeSourceHashes(params.report);
  const completionReport = params.completedReport ?? params.report;
  const entry: RegradeHistoryRun = {
    completionReport,
    completionReportHash: regradeSourceHash(completionReport),
    lockHashAtRun,
    plan: params.artifact,
    planContentHash,
    report: params.report,
  };

  let prior: RegradeHistoryArtifact | undefined;
  if (existsSync(absolutePath)) {
    const existing = readRegradeHistoryArtifact(absolutePath);
    if (existing.isErr()) {
      return existing;
    }
    prior = existing.value;
    const verified = verifyRegradeHistoryRuns(prior);
    if (verified.isErr()) {
      return verified;
    }
    if (
      params.artifact.transitionId !== undefined &&
      params.artifact.transitionId !== prior.id
    ) {
      return Result.err(
        new ValidationError(
          'Regrade plan transition id mismatch — refusing to fork the consolidated history.',
          {
            context: {
              history: prior.id,
              path: relativePath,
              plan: params.artifact.transitionId,
            },
          }
        )
      );
    }
    const lastRun = prior.runs.at(-1);
    // A plan that carries the transition id (adjust round-trips, plan
    // re-derivation) may evolve the plan identity on the same spine. A plan
    // WITHOUT the id that disagrees with the recorded plan identity is a
    // name collision, not a continuation — refuse instead of mixing runs
    // from unrelated transitions into one history.
    if (
      params.artifact.transitionId === undefined &&
      lastRun !== undefined &&
      lastRun.plan.plan.id !== params.artifact.plan.id
    ) {
      return Result.err(
        new ValidationError(
          'Regrade history already records a different plan identity under this transition name. Use `regrade adjust <transition>` to continue it, or pick a different plan name.',
          {
            context: {
              history: lastRun.plan.plan.id,
              path: relativePath,
              plan: params.artifact.plan.id,
            },
          }
        )
      );
    }
    if (
      lastRun !== undefined &&
      lastRun.planContentHash === planContentHash &&
      (currentSourceHashes.includes(lastRun.lockHashAtRun) ||
        currentSourceHashes.includes(lastRun.completionReportHash))
    ) {
      return Result.ok({
        path: relativePath,
        schemaVersion: REGRADE_HISTORY_SCHEMA_VERSION,
        status: 'replay',
      });
    }
  }

  const artifact: RegradeHistoryArtifact = {
    id:
      prior === undefined
        ? (params.artifact.transitionId ??
          mintTransitionId(
            regradePlanSlugForBody(params.artifact.plan),
            planContentHash,
            lockHashAtRun
          ))
        : prior.id,
    kind: 'regrade-history',
    path: relativePath,
    runs: prior === undefined ? [entry] : [...prior.runs, entry],
    schemaVersion: REGRADE_HISTORY_SCHEMA_VERSION,
  };
  const writableArtifact = {
    id: artifact.id,
    kind: artifact.kind,
    path: artifact.path,
    runs: artifact.runs.map((run) => ({
      completionReport: run[rawCompletionReport] ?? run.completionReport,
      completionReportHash: run.completionReportHash,
      lockHashAtRun: run.lockHashAtRun,
      plan: run.plan,
      planContentHash: run.planContentHash,
      report: run[rawReport] ?? run.report,
    })),
    schemaVersion: artifact.schemaVersion,
  };
  const parsed = regradeHistoryArtifactSchema.safeParse(writableArtifact);
  if (!parsed.success) {
    return Result.err(
      new ValidationError('Invalid Regrade history artifact.', {
        context: { issues: parsed.error.issues, path: relativePath },
      })
    );
  }
  try {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(
      absolutePath,
      `${JSON.stringify(writableArtifact, null, 2)}\n`
    );
  } catch (error) {
    return Result.err(
      new InternalError('Failed to write Regrade history entry.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { path: relativePath },
      })
    );
  }
  return Result.ok({
    path: relativePath,
    schemaVersion: REGRADE_HISTORY_SCHEMA_VERSION,
    status: 'applied',
  });
};

const hasPathSeparator = (value: string): boolean =>
  value.includes('/') || value.includes('\\');

/**
 * Resolve a transition name (with or without a `.json` suffix) to its
 * consolidated history file. Path references are rejected — graduated
 * history lookups are by transition name only.
 */
export const resolveRegradeHistoryPath = (
  rootDir: string,
  ref: string
): TrailsResult<string, ValidationError> => {
  if (hasPathSeparator(ref) || isAbsolute(ref)) {
    return Result.err(
      new ValidationError(
        `Regrade history reference "${ref}" must be a transition name.`
      )
    );
  }
  const name = ref.endsWith('.json') ? ref.slice(0, -'.json'.length) : ref;
  const path = join(regradePlanDirectory(rootDir), 'history', `${name}.json`);
  if (!existsSync(path)) {
    return Result.err(
      new ValidationError(`No Regrade history for transition "${ref}" found.`)
    );
  }
  return Result.ok(path);
};
