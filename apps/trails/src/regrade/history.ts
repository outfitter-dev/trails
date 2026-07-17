/**
 * Consolidated, append-only Regrade transition history. One file per
 * transition at `.trails/regrade/history/<transition>.json`; each apply
 * appends a run entry stamped with the plan content hash and the lock hash
 * observed at that run.
 */

import { InternalError, Result, ValidationError } from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import { resolveRegradeHistoryReceipt } from '@ontrails/regrade';
import type {
  RegradeFormJudgment,
  RegradeReport,
  ResolvedRegradeHistoryReceipt,
} from '@ontrails/regrade';
import {
  getGovernedVocabularyTransition,
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

import {
  regradePlanContentHash,
  regradePlanDirectory,
  regradePlanSlugForBody,
  regradeSourceHash,
  rootRelativePath,
} from './plan-artifact.js';
import type { RegradePlanArtifact, RegradePlanBody } from './plan-artifact.js';
import {
  buildRegradeHistoryReceipt,
  resolveRegradeSourceRevision,
  serializeRegradeHistoryReceipt,
} from './receipt-history.js';
import type { RegradeChangedFileEvidence } from './receipt-history.js';

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
interface RegradeHistoryRun {
  readonly completionReport: RegradeReport;
  readonly completionReportHash: string;
  readonly lockHashAtRun: string;
  readonly plan: RegradePlanArtifact;
  readonly planContentHash: string;
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
        {
          context: { embeddedPath, observedPath },
        }
      )
    );
  }
  return Result.ok(projectReceiptHistory(receipt.value));
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

/** Receipts are validated and hash-resolved during read. */
export const verifyRegradeHistoryRuns = (
  artifact: RegradeHistoryArtifact
): TrailsResult<{ readonly runs: number }, ValidationError> =>
  Result.ok({ runs: artifact.runs.length });

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

/**
 * Append one applied run to the transition's consolidated history file. A
 * Unchanged intent and classified state append a compact reference-only proof
 * and surface `status: 'replay'`.
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
  const completionReport = params.completedReport ?? params.report;

  let current: RegradeHistoryArtifact | undefined;
  if (existsSync(absolutePath)) {
    const existing = readRegradeHistoryArtifact(absolutePath);
    if (existing.isErr()) {
      return existing;
    }
    current = existing.value;
  }
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
