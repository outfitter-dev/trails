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
  regradeSourceHash,
  rootRelativePath,
} from './plan-artifact.js';
import type { RegradePlanArtifact, RegradePlanBody } from './plan-artifact.js';

/**
 * Consolidated history schema version. Version 1 was the retired
 * one-file-per-run shape whose filename carried the lock hash.
 */
export const REGRADE_HISTORY_SCHEMA_VERSION = 2;

const regradeHistoryRunSchema = z
  .object({
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
  return Result.ok(parsed.data as unknown as RegradeHistoryArtifact);
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
 * Append one applied run to the transition's consolidated history file. A
 * run whose plan content hash and lock hash both equal the last recorded
 * run's stamps is a replay: nothing is written and `status: 'replay'` is
 * surfaced instead of a duplicate record.
 */
export const appendRegradeHistoryRun = (params: {
  readonly artifact: RegradePlanArtifact;
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
  const entry: RegradeHistoryRun = {
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
    if (
      lastRun !== undefined &&
      lastRun.planContentHash === planContentHash &&
      lastRun.lockHashAtRun === lockHashAtRun
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
  const parsed = regradeHistoryArtifactSchema.safeParse(artifact);
  if (!parsed.success) {
    return Result.err(
      new ValidationError('Invalid Regrade history artifact.', {
        context: { issues: parsed.error.issues, path: relativePath },
      })
    );
  }
  try {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(parsed.data, null, 2)}\n`);
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
    if (regradeSourceHash(run.report) !== run.lockHashAtRun) {
      return Result.err(
        new ValidationError('Regrade history run stamp mismatch.', {
          context: { field: 'lockHashAtRun', path: artifact.path, run: index },
        })
      );
    }
  }
  return Result.ok({ runs: artifact.runs.length });
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
