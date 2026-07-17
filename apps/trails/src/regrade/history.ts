/**
 * Consolidated, append-only Regrade transition history. One file per
 * transition at `.trails/regrade/history/<transition>.json`; each apply
 * appends a run entry stamped with the plan content hash and the lock hash
 * observed at that run.
 */

import { InternalError, Result, ValidationError } from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import {
  regradeReportOutput,
  resolveRegradeHistoryReceipt,
} from '@ontrails/regrade';
import type {
  RegradeFormJudgment,
  RegradeReport,
  ResolvedRegradeHistoryReceipt,
} from '@ontrails/regrade';
import {
  getGovernedVocabularyTransition,
  governedVocabularyHistoryProvenanceSchema,
  listGovernedVocabularyTransitions,
} from '@ontrails/warden';
import type { GovernedVocabularyHistoryProvenance } from '@ontrails/warden';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
import {
  buildRegradeHistoryReceipt,
  resolveRegradeSourceRevision,
  serializeRegradeHistoryReceipt,
} from './receipt-history.js';
import type { RegradeChangedFileEvidence } from './receipt-history.js';

/**
 * Consolidated history schema version. Version 1 was the retired
 * one-file-per-run shape whose filename carried the lock hash.
 */
const REGRADE_HISTORY_SCHEMA_VERSION = 3;
const LEGACY_REGRADE_HISTORY_SCHEMA_VERSION = 2;

const rawCompletionReportHash = Symbol('rawCompletionReportHash');
const rawReportHash = Symbol('rawReportHash');
const rawCompletionReport = Symbol('rawCompletionReport');
const rawReport = Symbol('rawReport');
const resolvedReceipt = Symbol('resolvedReceipt');

export const writeRegradeHistoryFileAtomically = (params: {
  readonly absolutePath: string;
  readonly content: string;
  readonly diagnosticPath: string;
  readonly replace?: typeof renameSync | undefined;
}): TrailsResult<void, InternalError> => {
  const temporaryPath = join(
    dirname(params.absolutePath),
    `.${randomUUID()}.regrade-history.tmp`
  );
  try {
    mkdirSync(dirname(params.absolutePath), { recursive: true });
    writeFileSync(temporaryPath, params.content);
    (params.replace ?? renameSync)(temporaryPath, params.absolutePath);
    return Result.ok();
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the primary persistence failure.
    }
    return Result.err(
      new InternalError('Failed to atomically write Regrade history.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { path: params.diagnosticPath },
      })
    );
  }
};

export const consumeActiveRegradePlanAfterHistoryWrite = (params: {
  readonly absoluteHistoryPath: string;
  readonly absolutePlanPath: string;
  readonly historyPath: string;
  readonly planPath: string;
  readonly priorHistoryBytes?: string | undefined;
  readonly remove?: ((path: string) => void) | undefined;
  readonly replace?: typeof renameSync | undefined;
}): TrailsResult<void, InternalError> => {
  const remove =
    params.remove ?? ((path: string) => rmSync(path, { force: true }));
  const removeNewHistory = (): Error | undefined => {
    try {
      remove(params.absoluteHistoryPath);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  };
  try {
    remove(params.absolutePlanPath);
    return Result.ok();
  } catch (error) {
    let rollbackError: Error | undefined;
    if (params.priorHistoryBytes === undefined) {
      rollbackError = removeNewHistory();
    } else {
      const restored = writeRegradeHistoryFileAtomically({
        absolutePath: params.absoluteHistoryPath,
        content: params.priorHistoryBytes,
        diagnosticPath: params.historyPath,
        replace: params.replace,
      });
      if (restored.isErr()) {
        rollbackError = restored.error;
      }
    }
    return Result.err(
      new InternalError('Failed to remove active Regrade plan.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: {
          history: params.historyPath,
          plan: params.planPath,
          ...(rollbackError === undefined
            ? {}
            : { historyRollback: rollbackError.message }),
        },
      })
    );
  }
};

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
    provenance: governedVocabularyHistoryProvenanceSchema.optional(),
    report: regradeReportOutput.describe('Applied report recorded by the run'),
  })
  .strict();

const regradeHistoryArtifactSchema = z
  .object({
    id: z.string().min(1).describe('Stable transition identity'),
    kind: z.literal('regrade-history'),
    path: z.string().describe('Root-relative consolidated history path'),
    runs: z.array(regradeHistoryRunSchema).min(1),
    schemaVersion: z.literal(LEGACY_REGRADE_HISTORY_SCHEMA_VERSION),
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
  readonly provenance?: GovernedVocabularyHistoryProvenance;
  readonly report: RegradeReport;
}

export interface RegradeHistoryArtifact {
  readonly [resolvedReceipt]?: ResolvedRegradeHistoryReceipt;
  readonly id: string;
  readonly kind: 'regrade-history';
  readonly path: string;
  readonly runs: readonly RegradeHistoryRun[];
  readonly schemaVersion: number;
}

const receiptDisposition = (
  disposition: RegradeFormJudgment['disposition']
) => {
  switch (disposition) {
    case 'mapped': {
      return {
        disposition: 'in-family-modified' as const,
        verdict: 'applied' as const,
      };
    }
    case 'out-of-family': {
      return {
        disposition: 'out-of-family' as const,
        verdict: 'skipped' as const,
      };
    }
    case 'preserved': {
      return {
        disposition: 'explicit-preserve' as const,
        verdict: 'skipped' as const,
      };
    }
    case 'unresolved': {
      return {
        disposition: 'in-family-unresolved' as const,
        verdict: 'deferred' as const,
      };
    }
    default: {
      const exhaustive: never = disposition;
      return exhaustive;
    }
  }
};

const reportForReceiptRun = (
  run: ResolvedRegradeHistoryReceipt['runs'][number]
): RegradeReport => {
  const plan = run.plan as RegradePlanBody;
  const { completion } = run.receipt;
  const entries = run.receipt.evidence.changedFiles.map((file) => ({
    outcome: 'rewrite' as const,
    path: file.afterPath,
  }));
  const skipped = Object.values(completion.counts.skippedByReason).reduce(
    (sum, count) => sum + count,
    0
  );
  const base: RegradeReport = {
    apply: {
      applied: completion.counts.rewritten,
      filesChanged: completion.metrics.filesChanged,
      review: completion.counts.review,
      skipped,
      unknown: completion.counts.unknown,
    },
    entries,
    matched: completion.counts.matched,
    review: completion.counts.review,
    rewritten: completion.counts.rewritten,
    root: '.',
    scan: {
      byDirectory: [],
      byExtension: [],
      files: {
        matched: completion.counts.matched,
        scanned: 0,
        skipped,
      },
      skippedByReason: completion.counts.skippedByReason,
    },
    scanned: 0,
    selectedClassIds:
      plan.kind === 'class'
        ? plan.classIds
        : [plan.id ?? `vocabulary:${plan.from}->${plan.to}`],
    skipped,
    skipsByReason: completion.counts.skippedByReason,
    unknownClassIds: [],
  };
  if (plan.kind !== 'vocabulary') {
    return base;
  }
  const occurrences = run.classifiedState.forms.map((form, index) => {
    const mapped = receiptDisposition(form.disposition);
    return {
      column: 1,
      context: '',
      ...mapped,
      end: 0,
      form: form.form,
      line: form.representative?.line ?? 1,
      path: form.representative?.path ?? run.receipt.transitionId,
      reason: form.reason ?? form.disposition,
      ...(form.target === undefined ? {} : { replacement: form.target }),
      scopeTier: 'in-scope' as const,
      start: index,
    };
  });
  return {
    ...base,
    run: {
      ledger: {
        cycle: 1,
        forms: Object.fromEntries(
          occurrences.map((occurrence) => [occurrence.form, occurrence.verdict])
        ),
        occurrences,
      },
      plan,
      report: {
        applied: completion.counts.rewritten,
        deferred: completion.counts.review,
        dispositions: completion.counts.dispositions,
        filesChanged: completion.metrics.filesChanged,
        gate: {
          ...completion.gate,
          remainingByDisposition: {},
        },
        modified: completion.counts.rewritten,
        open: completion.gate.remaining,
        scopeTiers: { 'in-scope': occurrences.length, 'policy-classified': 0 },
        skipped,
        teachingSurfaces: { expected: [], missing: [], touched: [] },
      },
    },
  };
};

const projectReceiptHistory = (
  receipt: ResolvedRegradeHistoryReceipt
): RegradeHistoryArtifact => ({
  [resolvedReceipt]: receipt,
  id: receipt.artifact.id,
  kind: 'regrade-history',
  path: receipt.artifact.path,
  runs: receipt.runs.map((run) => ({
    completionReport: reportForReceiptRun(run),
    completionReportHash: run.receipt.evidence.sourceStateHash,
    lockHashAtRun: run.receipt.evidence.lockStateHash,
    plan: {
      kind: 'regrade-plan',
      path: `.trails/regrade/plans/${receipt.artifact.path.split('/').at(-1) ?? 'receipt'}`,
      plan: run.plan as RegradePlanBody,
      provenance: run.provenance,
      schemaVersion: 1,
      sourceHash: run.receipt.evidence.sourceStateHash,
      transitionId: receipt.artifact.id,
    },
    planContentHash: run.receipt.intent.planContentHash,
    report: reportForReceiptRun(run),
  })),
  schemaVersion: receipt.artifact.schemaVersion,
});

export interface RegradeHistorySummary {
  readonly id: string;
  readonly path: string;
  readonly provenance?: GovernedVocabularyHistoryProvenance;
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
  if (
    typeof parsedJson === 'object' &&
    parsedJson !== null &&
    'schemaVersion' in parsedJson &&
    parsedJson.schemaVersion === REGRADE_HISTORY_SCHEMA_VERSION
  ) {
    const receipt = resolveRegradeHistoryReceipt(parsedJson);
    if (receipt.isErr()) {
      return receipt;
    }
    const observedPath = path.replaceAll('\\', '/');
    const embeddedPath = receipt.value.artifact.path;
    if (
      observedPath !== embeddedPath &&
      !observedPath.endsWith(`/${embeddedPath}`)
    ) {
      return Result.err(
        new ValidationError(
          'Regrade history path does not match its observed file.',
          { context: { embeddedPath, observedPath } }
        )
      );
    }
    return Result.ok(projectReceiptHistory(receipt.value));
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

const targetIncludesPlanTarget = (
  transition: NonNullable<ReturnType<typeof getGovernedVocabularyTransition>>,
  to: string
): boolean =>
  transition.target.kind === 'single'
    ? transition.target.to === to
    : transition.target.options.some((option) => option.to === to);

const governedTransitionForPlan = (
  plan: Extract<RegradePlanBody, { kind: 'vocabulary' }>
) => {
  const idTransition =
    plan.id === undefined
      ? undefined
      : getGovernedVocabularyTransition(plan.id);
  return (
    idTransition ??
    listGovernedVocabularyTransitions().find(
      (transition) => transition.from === plan.from
    )
  );
};

export const validateGovernedRegradePlan = (
  artifact: RegradePlanArtifact
): TrailsResult<void, ValidationError> => {
  const { plan } = artifact;
  if (plan.kind !== 'vocabulary') {
    return Result.ok();
  }
  const transition = governedTransitionForPlan(plan);
  if (transition === undefined) {
    return Result.ok();
  }
  if (
    transition.from === plan.from &&
    targetIncludesPlanTarget(transition, plan.to)
  ) {
    return Result.ok();
  }
  return Result.err(
    new ValidationError(
      'Governed Regrade plan does not match its registry transition.',
      {
        context: {
          plan: { from: plan.from, id: plan.id, to: plan.to },
          registry: { from: transition.from, id: transition.id },
        },
      }
    )
  );
};

const governedProvenanceForRun = (params: {
  readonly artifact: RegradePlanArtifact;
  readonly completionReport: RegradeReport;
  readonly planContentHash: string;
  readonly report: RegradeReport;
}): TrailsResult<
  GovernedVocabularyHistoryProvenance | undefined,
  ValidationError
> => {
  const { plan } = params.artifact;
  const validation = validateGovernedRegradePlan(params.artifact);
  if (validation.isErr()) {
    return validation;
  }
  if (plan.kind !== 'vocabulary') {
    return Result.ok();
  }
  const transition = governedTransitionForPlan(plan);
  if (transition === undefined) {
    return Result.ok();
  }

  const reviewPending = params.report.review;
  return Result.ok({
    disposition: reviewPending > 0 ? 'review-follow-up' : 'applied-clean',
    kind: 'governed-vocabulary',
    planContentHash: params.planContentHash,
    reviewPending,
    safeApplied: params.report.apply?.applied ?? params.report.rewritten,
    sourceHashAfter: regradeSourceHash(params.completionReport),
    sourceHashBefore: regradeSourceHash(params.report),
    transitionId: transition.id,
  });
};

const governedProvenanceMatchesRun = (params: {
  readonly expected: GovernedVocabularyHistoryProvenance | undefined;
  readonly run: RegradeHistoryRun;
}): boolean => {
  const { expected, run } = params;
  const actual = run.provenance;
  if (actual === undefined || expected === undefined) {
    return actual === expected;
  }
  return (
    actual.disposition === expected.disposition &&
    actual.kind === expected.kind &&
    actual.planContentHash === expected.planContentHash &&
    actual.reviewPending === expected.reviewPending &&
    actual.safeApplied === expected.safeApplied &&
    (regradeSourceHashMatches(actual.sourceHashBefore, run.report) ||
      run[rawReportHash] === actual.sourceHashBefore) &&
    (regradeSourceHashMatches(actual.sourceHashAfter, run.completionReport) ||
      run[rawCompletionReportHash] === actual.sourceHashAfter) &&
    actual.transitionId === expected.transitionId
  );
};

/**
 * Verify legacy snapshot runs by recomputing their embedded report stamps.
 * Compact v3 receipts arrive here only after their self-contained hashes and
 * references resolve; historical environment keys require Git and tool inputs
 * that this artifact-only helper intentionally does not pretend to recompute.
 */
export const verifyRegradeHistoryRuns = (
  artifact: RegradeHistoryArtifact
): TrailsResult<{ readonly runs: number }, ValidationError> => {
  if (artifact[resolvedReceipt] !== undefined) {
    return Result.ok({ runs: artifact.runs.length });
  }
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
    const expectedProvenance = governedProvenanceForRun({
      artifact: run.plan,
      completionReport: run.completionReport,
      planContentHash: run.planContentHash,
      report: run.report,
    });
    if (expectedProvenance.isErr()) {
      return expectedProvenance;
    }
    const transition =
      run.plan.plan.kind === 'vocabulary'
        ? governedTransitionForPlan(run.plan.plan)
        : undefined;
    if (
      transition?.provenance.mode === 'regrade-history' &&
      run.provenance === undefined
    ) {
      return Result.err(
        new ValidationError('Regrade history run lacks governed provenance.', {
          context: { path: artifact.path, run: index },
        })
      );
    }
    if (
      run.provenance !== undefined &&
      !governedProvenanceMatchesRun({
        expected: expectedProvenance.value,
        run,
      })
    ) {
      return Result.err(
        new ValidationError('Regrade history run provenance mismatch.', {
          context: { path: artifact.path, run: index },
        })
      );
    }
  }
  return Result.ok({ runs: artifact.runs.length });
};

const historyEntryFor = (params: {
  readonly artifact: RegradePlanArtifact;
  readonly completionReport: RegradeReport;
  readonly lockHashAtRun: string;
  readonly planContentHash: string;
  readonly report: RegradeReport;
}): TrailsResult<RegradeHistoryRun, ValidationError> => {
  const provenance = governedProvenanceForRun(params);
  if (provenance.isErr()) {
    return provenance;
  }
  return Result.ok({
    completionReport: params.completionReport,
    completionReportHash: regradeSourceHash(params.completionReport),
    lockHashAtRun: params.lockHashAtRun,
    plan: params.artifact,
    planContentHash: params.planContentHash,
    ...(provenance.value === undefined ? {} : { provenance: provenance.value }),
    report: params.report,
  });
};

const historySummaryFor = (
  artifact: Pick<RegradeHistoryArtifact, 'id' | 'path' | 'schemaVersion'>,
  status: RegradeHistorySummary['status'],
  provenance?: GovernedVocabularyHistoryProvenance
): RegradeHistorySummary => ({
  id: artifact.id,
  path: artifact.path,
  ...(provenance === undefined ? {} : { provenance }),
  schemaVersion: artifact.schemaVersion,
  status,
});

const writableHistoryArtifact = (artifact: RegradeHistoryArtifact) => ({
  id: artifact.id,
  kind: artifact.kind,
  path: artifact.path,
  runs: artifact.runs.map((run) => ({
    completionReport: run[rawCompletionReport] ?? run.completionReport,
    completionReportHash: run.completionReportHash,
    lockHashAtRun: run.lockHashAtRun,
    plan: run.plan,
    planContentHash: run.planContentHash,
    ...(run.provenance === undefined ? {} : { provenance: run.provenance }),
    report: run[rawReport] ?? run.report,
  })),
  schemaVersion: artifact.schemaVersion,
});

const nextHistoryArtifact = (params: {
  readonly entry: RegradeHistoryRun;
  readonly lockHashAtRun: string;
  readonly path: string;
  readonly plan: RegradePlanArtifact;
  readonly planContentHash: string;
  readonly prior: RegradeHistoryArtifact | undefined;
}): RegradeHistoryArtifact => ({
  id:
    params.prior?.id ??
    params.plan.transitionId ??
    mintTransitionId(
      regradePlanSlugForBody(params.plan.plan),
      params.planContentHash,
      params.lockHashAtRun
    ),
  kind: 'regrade-history',
  path: params.path,
  runs:
    params.prior === undefined
      ? [params.entry]
      : [...params.prior.runs, params.entry],
  schemaVersion: LEGACY_REGRADE_HISTORY_SCHEMA_VERSION,
});

const appendReceiptHistoryRun = (params: {
  readonly absolutePath: string;
  readonly artifact: RegradePlanArtifact;
  readonly changedFiles: readonly RegradeChangedFileEvidence[];
  readonly completedReport: RegradeReport;
  readonly current: RegradeHistoryArtifact | undefined;
  readonly lockHashAtRun: string;
  readonly planContentHash: string;
  readonly relativePath: string;
  readonly report: RegradeReport;
  readonly rootDir: string;
  readonly sourceRevision: string;
}): TrailsResult<RegradeHistorySummary, Error> => {
  if (
    params.current !== undefined &&
    params.artifact.transitionId !== undefined &&
    params.artifact.transitionId !== params.current.id
  ) {
    return Result.err(
      new ValidationError(
        'Regrade plan transition id mismatch — refusing to fork the consolidated history.',
        {
          context: {
            history: params.current.id,
            path: params.relativePath,
            plan: params.artifact.transitionId,
          },
        }
      )
    );
  }
  const currentLastRun = params.current?.runs.at(-1);
  if (
    params.current !== undefined &&
    params.artifact.transitionId === undefined &&
    currentLastRun !== undefined &&
    currentLastRun.plan.plan.id !== params.artifact.plan.id
  ) {
    return Result.err(
      new ValidationError(
        'Regrade history already records a different plan identity under this transition name. Use `regrade adjust <transition>` to continue it, or pick a different plan name.',
        {
          context: {
            history: currentLastRun.plan.plan.id,
            path: params.relativePath,
            plan: params.artifact.plan.id,
          },
        }
      )
    );
  }
  const transitionId =
    params.current?.id ??
    params.artifact.transitionId ??
    mintTransitionId(
      regradePlanSlugForBody(params.artifact.plan),
      params.planContentHash,
      params.lockHashAtRun
    );
  const receipt = buildRegradeHistoryReceipt({
    artifact: params.artifact,
    changedFiles: params.changedFiles,
    completedReport: params.completedReport,
    historyPath: params.relativePath,
    ...(params.current?.[resolvedReceipt] === undefined
      ? {}
      : { prior: params.current[resolvedReceipt] }),
    report: params.report,
    rootDir: params.rootDir,
    sourceRevision: params.sourceRevision,
    transitionId,
  });
  if (receipt.isErr()) {
    return receipt;
  }
  const serialized = serializeRegradeHistoryReceipt(receipt.value);
  if (serialized.isErr()) {
    return serialized;
  }
  const written = writeRegradeHistoryFileAtomically({
    absolutePath: params.absolutePath,
    content: serialized.value,
    diagnosticPath: params.relativePath,
  });
  if (written.isErr()) {
    return written;
  }
  const lastRun = receipt.value.runs.at(-1);
  return Result.ok({
    id: receipt.value.id,
    path: receipt.value.path,
    schemaVersion: receipt.value.schemaVersion,
    status: lastRun?.runKind === 'proof' ? 'replay' : 'applied',
  });
};

const appendLegacyHistoryRun = (params: {
  readonly absolutePath: string;
  readonly artifact: RegradePlanArtifact;
  readonly completedReport: RegradeReport;
  readonly current: RegradeHistoryArtifact | undefined;
  readonly currentSourceHashes: readonly string[];
  readonly lockHashAtRun: string;
  readonly planContentHash: string;
  readonly relativePath: string;
  readonly report: RegradeReport;
}): TrailsResult<RegradeHistorySummary, Error> => {
  const entry = historyEntryFor({
    artifact: params.artifact,
    completionReport: params.completedReport,
    lockHashAtRun: params.lockHashAtRun,
    planContentHash: params.planContentHash,
    report: params.report,
  });
  if (entry.isErr()) {
    return entry;
  }
  if (params.current !== undefined) {
    const verified = verifyRegradeHistoryRuns(params.current);
    if (verified.isErr()) {
      return verified;
    }
  }
  if (
    params.current !== undefined &&
    params.artifact.transitionId !== undefined &&
    params.artifact.transitionId !== params.current.id
  ) {
    return Result.err(
      new ValidationError(
        'Regrade plan transition id mismatch — refusing to fork the consolidated history.',
        {
          context: {
            history: params.current.id,
            path: params.relativePath,
            plan: params.artifact.transitionId,
          },
        }
      )
    );
  }
  const lastRun = params.current?.runs.at(-1);
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
            path: params.relativePath,
            plan: params.artifact.plan.id,
          },
        }
      )
    );
  }
  if (
    params.current !== undefined &&
    lastRun !== undefined &&
    lastRun.planContentHash === params.planContentHash &&
    (params.currentSourceHashes.includes(lastRun.lockHashAtRun) ||
      params.currentSourceHashes.includes(lastRun.completionReportHash))
  ) {
    return Result.ok(
      historySummaryFor(params.current, 'replay', lastRun.provenance)
    );
  }
  const artifact = nextHistoryArtifact({
    entry: entry.value,
    lockHashAtRun: params.lockHashAtRun,
    path: params.relativePath,
    plan: params.artifact,
    planContentHash: params.planContentHash,
    prior: params.current,
  });
  const writableArtifact = writableHistoryArtifact(artifact);
  const parsed = regradeHistoryArtifactSchema.safeParse(writableArtifact);
  if (!parsed.success) {
    return Result.err(
      new ValidationError('Invalid Regrade history artifact.', {
        context: { issues: parsed.error.issues, path: params.relativePath },
      })
    );
  }
  const written = writeRegradeHistoryFileAtomically({
    absolutePath: params.absolutePath,
    content: `${JSON.stringify(writableArtifact, null, 2)}\n`,
    diagnosticPath: params.relativePath,
  });
  if (written.isErr()) {
    return written;
  }
  return Result.ok(
    historySummaryFor(artifact, 'applied', entry.value.provenance)
  );
};

/**
 * Append one applied run to the transition's consolidated history file. A
 * run whose plan content hash and source evidence equal either the last run's
 * pre-apply report or completed state is a replay: nothing is written and
 * `status: 'replay'` is surfaced instead of a duplicate record.
 */
export const appendRegradeHistoryRun = (params: {
  readonly artifact: RegradePlanArtifact;
  readonly changedFiles?: readonly RegradeChangedFileEvidence[];
  readonly completedReport?: RegradeReport;
  readonly report: RegradeReport;
  readonly rootDir: string;
  readonly sourceRevision?: string;
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

  let current: RegradeHistoryArtifact | undefined;
  if (existsSync(absolutePath)) {
    const existing = readRegradeHistoryArtifact(absolutePath);
    if (existing.isErr()) {
      return existing;
    }
    current = existing.value;
  }
  if (
    (params.changedFiles !== undefined && current === undefined) ||
    current?.[resolvedReceipt] !== undefined
  ) {
    const sourceRevision =
      params.sourceRevision === undefined
        ? resolveRegradeSourceRevision(params.rootDir)
        : Result.ok(params.sourceRevision);
    if (sourceRevision.isErr()) {
      return sourceRevision;
    }
    return appendReceiptHistoryRun({
      absolutePath,
      artifact: params.artifact,
      changedFiles: params.changedFiles ?? [],
      completedReport: completionReport,
      current,
      lockHashAtRun,
      planContentHash,
      relativePath,
      report: params.report,
      rootDir: params.rootDir,
      sourceRevision: sourceRevision.value,
    });
  }
  return appendLegacyHistoryRun({
    absolutePath,
    artifact: params.artifact,
    completedReport: completionReport,
    current,
    currentSourceHashes,
    lockHashAtRun,
    planContentHash,
    relativePath,
    report: params.report,
  });
};

const hasPathSeparator = (value: string): boolean =>
  value.includes('/') || value.includes('\\');

/**
 * Resolve an opaque transition id to its validated consolidated history file.
 * Path and filename references are rejected; the operator never selects the
 * generator-owned receipt filename.
 */
export const resolveRegradeHistoryPath = (
  rootDir: string,
  ref: string
): TrailsResult<string, Error> => {
  if (hasPathSeparator(ref) || isAbsolute(ref)) {
    return Result.err(
      new ValidationError(
        `Regrade history reference "${ref}" must be an opaque transition id.`
      )
    );
  }
  const historyDir = join(regradePlanDirectory(rootDir), 'history');
  if (!existsSync(historyDir)) {
    return Result.err(
      new ValidationError(`No Regrade history for transition "${ref}" found.`)
    );
  }
  const matches: string[] = [];
  for (const name of readdirSync(historyDir).toSorted()) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const path = join(historyDir, name);
    const history = readRegradeHistoryArtifact(path);
    if (history.isErr()) {
      return history;
    }
    if (history.value.id === ref) {
      matches.push(path);
    }
  }
  if (matches.length === 0) {
    return Result.err(
      new ValidationError(`No Regrade history for transition "${ref}" found.`)
    );
  }
  if (matches.length > 1) {
    return Result.err(
      new ValidationError(
        `Multiple Regrade histories claim transition "${ref}".`
      )
    );
  }
  return Result.ok(matches[0] as string);
};
