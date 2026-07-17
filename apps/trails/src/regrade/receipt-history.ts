import { InternalError, Result, ValidationError } from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import {
  canonicalRegradeJson,
  regradeClassifiedStateHash,
  regradeHistoryReceiptSchema,
  regradeReceiptContentHash,
  regradeReceiptPlanContentHash,
  regradeReceiptPlanSchema,
  resolveRegradeHistoryReceipt,
  serializeRegradeHistoryReceipt,
} from '@ontrails/regrade';
import type {
  RegradeFormJudgment,
  RegradeHistoryReceipt,
  RegradeReport,
  ResolvedRegradeHistoryReceipt,
} from '@ontrails/regrade';
import { listGovernedVocabularyTransitions } from '@ontrails/warden';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { trailsPackageVersion } from '../versions.js';
import { regradeSourceHash } from './plan-artifact.js';
import type { RegradePlanArtifact } from './plan-artifact.js';

export interface RegradeChangedFileBefore {
  readonly afterPath: string;
  readonly beforeBlobHash: string;
  readonly beforePath: string;
}

export interface RegradeChangedFileEvidence extends RegradeChangedFileBefore {
  readonly afterBlobHash: string;
}

const gitBlobHash = (
  rootDir: string,
  content: Uint8Array
): TrailsResult<string, InternalError> => {
  const result = spawnSync('git', ['-C', rootDir, 'hash-object', '--stdin'], {
    encoding: 'utf8',
    input: content,
  });
  const hash = result.stdout.trim();
  if (result.status !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(hash)) {
    return Result.err(
      new InternalError(
        'Failed to derive Git blob identity for Regrade receipt.',
        {
          context: { rootDir, stderr: result.stderr.trim() },
        }
      )
    );
  }
  return Result.ok(hash);
};

const fileBlobHash = (
  rootDir: string,
  relativePath: string
): TrailsResult<string, InternalError> => {
  const absolutePath = join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    return Result.err(
      new InternalError('Changed file is missing for Regrade receipt.', {
        context: { path: relativePath },
      })
    );
  }
  let content: Uint8Array;
  try {
    content = readFileSync(absolutePath);
  } catch (error) {
    return Result.err(
      new InternalError('Failed to read changed file for Regrade receipt.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { path: relativePath },
      })
    );
  }
  return gitBlobHash(rootDir, content);
};

const changedPathPairs = (
  artifact: RegradePlanArtifact,
  report: RegradeReport
): readonly { readonly afterPath: string; readonly beforePath: string }[] => {
  const renames =
    artifact.plan.kind === 'vocabulary'
      ? new Map(
          (artifact.plan.fileRenames ?? []).map((rename) => [
            rename.from,
            rename.to,
          ])
        )
      : new Map<string, string>();
  const pairs = new Map<
    string,
    { readonly afterPath: string; readonly beforePath: string }
  >();
  for (const entry of report.entries) {
    if (entry.outcome !== 'rewrite' && entry.outcome !== 'needs-review') {
      continue;
    }
    const beforePath = entry.path;
    const afterPath = renames.get(beforePath) ?? beforePath;
    pairs.set(`${beforePath}\u0000${afterPath}`, { afterPath, beforePath });
  }
  return [...pairs.values()].toSorted(
    (left, right) =>
      left.beforePath.localeCompare(right.beforePath) ||
      left.afterPath.localeCompare(right.afterPath)
  );
};

export const captureRegradeChangedFilesBefore = (params: {
  readonly artifact: RegradePlanArtifact;
  readonly report: RegradeReport;
  readonly rootDir: string;
}): TrailsResult<readonly RegradeChangedFileBefore[], InternalError> => {
  const captures: RegradeChangedFileBefore[] = [];
  for (const pair of changedPathPairs(params.artifact, params.report)) {
    const beforeBlobHash = fileBlobHash(params.rootDir, pair.beforePath);
    if (beforeBlobHash.isErr()) {
      return beforeBlobHash;
    }
    captures.push({ ...pair, beforeBlobHash: beforeBlobHash.value });
  }
  return Result.ok(captures);
};

export const completeRegradeChangedFiles = (params: {
  readonly before: readonly RegradeChangedFileBefore[];
  readonly rootDir: string;
}): TrailsResult<readonly RegradeChangedFileEvidence[], InternalError> => {
  const completed: RegradeChangedFileEvidence[] = [];
  for (const capture of params.before) {
    const afterBlobHash = fileBlobHash(params.rootDir, capture.afterPath);
    if (afterBlobHash.isErr()) {
      return afterBlobHash;
    }
    if (
      capture.beforePath === capture.afterPath &&
      capture.beforeBlobHash === afterBlobHash.value
    ) {
      continue;
    }
    completed.push({ ...capture, afterBlobHash: afterBlobHash.value });
  }
  return Result.ok(completed);
};

const formDisposition = (
  occurrence: NonNullable<RegradeReport['run']>['ledger']['occurrences'][number]
): RegradeFormJudgment['disposition'] => {
  if (occurrence.verdict === 'applied' || occurrence.verdict === 'modified') {
    return 'mapped';
  }
  if (
    occurrence.verdict === 'deferred' ||
    occurrence.disposition === 'in-family-unresolved'
  ) {
    return 'unresolved';
  }
  if (occurrence.disposition === 'out-of-family') {
    return 'out-of-family';
  }
  return 'preserved';
};

const formJudgments = (
  report: RegradeReport
): readonly RegradeFormJudgment[] => {
  const caseSensitive = report.run?.plan.caseSensitive === true;
  const byIdentity = new Map<string, RegradeFormJudgment>();
  for (const occurrence of report.run?.ledger.occurrences ?? []) {
    const disposition = formDisposition(occurrence);
    const judgment: RegradeFormJudgment = {
      disposition,
      form: occurrence.form,
      reason: occurrence.reason,
      representative: { line: occurrence.line, path: occurrence.path },
      ...(disposition === 'mapped' && occurrence.replacement !== undefined
        ? { target: occurrence.replacement }
        : {}),
    };
    const identity = caseSensitive
      ? occurrence.form
      : occurrence.form.toLowerCase();
    const current = byIdentity.get(identity);
    if (current === undefined || disposition === 'unresolved') {
      byIdentity.set(identity, judgment);
    }
  }
  return [...byIdentity.values()];
};

export const resolveRegradeSourceRevision = (
  rootDir: string
): TrailsResult<string, InternalError> => {
  const result = spawnSync('git', ['-C', rootDir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  });
  const revision = result.stdout.trim();
  if (
    result.status !== 0 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(revision)
  ) {
    return Result.err(
      new InternalError(
        'Failed to resolve source revision for Regrade receipt.',
        {
          context: { rootDir, stderr: result.stderr.trim() },
        }
      )
    );
  }
  return Result.ok(revision);
};

export const validateRegradeReceiptPlan = (
  artifact: RegradePlanArtifact
): TrailsResult<RegradePlanArtifact, ValidationError> => {
  const parsed = regradeReceiptPlanSchema.safeParse(artifact.plan);
  if (!parsed.success) {
    return Result.err(
      new ValidationError('Invalid authored plan for Regrade receipt.', {
        context: { issues: parsed.error.issues },
      })
    );
  }
  return Result.ok(artifact);
};

const completionFacts = (
  report: RegradeReport,
  completedReport: RegradeReport,
  changedFiles: readonly RegradeChangedFileEvidence[],
  forms: readonly RegradeFormJudgment[]
) => {
  const vocabularyGate = completedReport.run?.report.gate;
  const remaining =
    vocabularyGate?.remaining ??
    completedReport.review + completedReport.unknownClassIds.length;
  const reasons =
    vocabularyGate?.reasons ??
    (remaining === 0 ? [] : ['review-or-unknown-work-remains']);
  const dispositions = report.run?.report.dispositions ?? {};
  const preserved = forms.filter(
    (form) => form.disposition === 'preserved'
  ).length;
  const rewritten = report.apply?.applied ?? report.rewritten;
  return {
    counts: {
      dispositions,
      matched: report.matched,
      preserved,
      review: report.review,
      rewritten,
      skippedByReason: report.skipsByReason,
      unknown: report.unknownClassIds.length,
    },
    gate: {
      reasons,
      remaining,
      status:
        remaining === 0 && reasons.length === 0
          ? ('green' as const)
          : ('open' as const),
    },
    metrics: {
      filesChanged: changedFiles.length,
      formsMapped: forms.filter((form) => form.disposition === 'mapped').length,
      occurrencesRewritten: rewritten,
    },
  };
};

const proofCompletionFacts = () => ({
  counts: {
    dispositions: {},
    matched: 0,
    preserved: 0,
    review: 0,
    rewritten: 0,
    skippedByReason: {},
    unknown: 0,
  },
  gate: { reasons: [], remaining: 0, status: 'green' as const },
  metrics: { filesChanged: 0, formsMapped: 0, occurrencesRewritten: 0 },
});

const receiptRunKind = (
  proof: boolean,
  hasPrior: boolean
): 'adjust' | 'original' | 'proof' => {
  if (proof) {
    return 'proof';
  }
  if (hasPrior) {
    return 'adjust';
  }
  return 'original';
};

export const buildRegradeHistoryReceipt = (params: {
  readonly artifact: RegradePlanArtifact;
  readonly changedFiles: readonly RegradeChangedFileEvidence[];
  readonly completedReport: RegradeReport;
  readonly historyPath: string;
  readonly prior?: ResolvedRegradeHistoryReceipt;
  readonly report: RegradeReport;
  readonly rootDir: string;
  readonly sourceRevision: string;
  readonly transitionId: string;
}): TrailsResult<RegradeHistoryReceipt, Error> => {
  const parsedPlan = regradeReceiptPlanSchema.safeParse(params.artifact.plan);
  if (!parsedPlan.success) {
    return Result.err(
      new ValidationError('Invalid authored plan for Regrade receipt.', {
        context: { issues: parsedPlan.error.issues },
      })
    );
  }
  const planContentHash = regradeReceiptPlanContentHash({
    plan: parsedPlan.data,
    provenance: params.artifact.provenance,
  });
  const forms = formJudgments(params.report);
  const caseSensitive =
    parsedPlan.data.kind === 'vocabulary' &&
    parsedPlan.data.caseSensitive === true;
  const stateHash = regradeClassifiedStateHash({ caseSensitive, forms });
  const last = params.prior?.runs.at(-1);
  const stateUnchanged = last?.classifiedState.stateHash === stateHash;
  const planMatchesLast =
    last !== undefined &&
    last.receipt.intent.planContentHash === planContentHash;
  const effectiveForms = stateUnchanged ? last.classifiedState.forms : forms;
  const effectiveStateHash = stateUnchanged
    ? last.classifiedState.stateHash
    : stateHash;
  const completion = completionFacts(
    params.report,
    params.completedReport,
    params.changedFiles,
    effectiveForms
  );
  const proof =
    planMatchesLast &&
    stateUnchanged &&
    params.changedFiles.length === 0 &&
    params.report.review === 0 &&
    params.report.unknownClassIds.length === 0 &&
    completion.gate.status === 'green';
  const timestamp = new Date().toISOString();
  const runId = createHash('sha256')
    .update(
      canonicalRegradeJson({
        planContentHash,
        sourceRevision: params.sourceRevision,
        timestamp,
        transitionId: params.transitionId,
      })
    )
    .digest('hex')
    .slice(0, 16);
  const runKind = receiptRunKind(proof, params.prior !== undefined);
  const run = {
    classifiedState: stateUnchanged
      ? ({ kind: 'reference', stateHash: effectiveStateHash } as const)
      : ({
          caseSensitive,
          forms: effectiveForms,
          kind: 'embedded',
          stateHash: effectiveStateHash,
        } as const),
    completion: proof ? proofCompletionFacts() : completion,
    evidence: {
      changedFiles: params.changedFiles,
      detailEvidenceHash: regradeReceiptContentHash(params.completedReport),
      lockStateHash: regradeSourceHash(params.report),
      policyHash: regradeReceiptContentHash(
        listGovernedVocabularyTransitions()
      ),
      sourceRevision: params.sourceRevision,
      sourceStateHash: regradeSourceHash(params.completedReport),
      toolVersion: trailsPackageVersion,
    },
    intent: proof
      ? ({ kind: 'reference', planContentHash } as const)
      : ({
          kind: 'embedded',
          plan: parsedPlan.data,
          planContentHash,
          provenance: params.artifact.provenance,
        } as const),
    project: { root: '.' as const },
    runId,
    runKind,
    timestamp,
    transitionId: params.transitionId,
  };
  const receipt = {
    id: params.transitionId,
    kind: 'regrade-history',
    path: params.historyPath,
    runs: [...(params.prior?.artifact.runs ?? []), run],
    schemaVersion: 3,
  };
  const parsed = regradeHistoryReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    return Result.err(
      new ValidationError('Invalid Regrade history receipt.', {
        context: { issues: parsed.error.issues, path: params.historyPath },
      })
    );
  }
  return Result.ok(parsed.data);
};

export const readRegradeReceipt = (
  path: string
): TrailsResult<
  ResolvedRegradeHistoryReceipt,
  InternalError | ValidationError
> => {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return Result.err(
      new InternalError('Failed to read Regrade history receipt.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { path },
      })
    );
  }
  return resolveRegradeHistoryReceipt(value);
};

export { serializeRegradeHistoryReceipt };
