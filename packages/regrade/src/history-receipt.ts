import { Result, ValidationError, isPlainObject } from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';

import { vocabularyDispositionValues } from './downstream/vocabulary.js';

/** Canonical compact Regrade history schema. */
export const REGRADE_HISTORY_RECEIPT_SCHEMA_VERSION = 3;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const gitObjectIdSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const countSchema = z.number().int().nonnegative();

const classRegradePlanSchema = z
  .object({
    classIds: z.array(z.string().min(1)).min(1),
    id: z.string().min(1),
    intent: z.string().optional(),
    kind: z.literal('class'),
    name: z.string().min(1).optional(),
    scope: z
      .object({
        exclude: z.array(z.string()).optional(),
        extensions: z.array(z.string()).optional(),
        include: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const receiptVocabularyPreserveSchema = z
  .object({
    disposition: z.enum(vocabularyDispositionValues).optional(),
    forms: z.array(z.string().min(1)).optional(),
    paths: z.array(z.string()).optional(),
    pattern: z.string(),
    reason: z.string().optional(),
  })
  .strict();

const receiptVocabularyScopeSchema = z
  .object({
    exclude: z.array(z.string()).optional(),
    extensions: z.array(z.string()).optional(),
    ignoredDirectories: z.array(z.string()).optional(),
    include: z.array(z.string()).optional(),
    policyClassified: z
      .array(
        z
          .object({
            disposition: z.enum(vocabularyDispositionValues),
            expectMatches: z.boolean().optional(),
            paths: z.array(z.string().min(1)).min(1),
            reason: z.string().min(1),
          })
          .strict()
      )
      .optional(),
    teachingSurfaces: z.array(z.string().min(1)).optional(),
  })
  .strict();

const receiptVocabularyPlanSchema = z
  .object({
    caseSensitive: z.boolean().optional(),
    deferForms: z.array(z.string().min(1)).optional(),
    fileRenames: z
      .array(
        z.object({ from: z.string().min(1), to: z.string().min(1) }).strict()
      )
      .optional(),
    from: z.string().min(1),
    id: z.string().optional(),
    intent: z.string().optional(),
    kind: z.literal('vocabulary'),
    overrides: z.record(z.string().min(1), z.string().min(1)).optional(),
    preserve: z.array(receiptVocabularyPreserveSchema).optional(),
    scope: receiptVocabularyScopeSchema.optional(),
    to: z.string().min(1),
  })
  .strict();

/** Authored plan content retained by a compact receipt. */
export const regradeReceiptPlanSchema = z.discriminatedUnion('kind', [
  receiptVocabularyPlanSchema,
  classRegradePlanSchema,
]);

export type RegradeReceiptPlan = z.output<typeof regradeReceiptPlanSchema>;

const embeddedIntentSchema = z
  .object({
    kind: z.literal('embedded'),
    plan: regradeReceiptPlanSchema,
    planContentHash: sha256Schema,
  })
  .strict();

const referencedIntentSchema = z
  .object({
    kind: z.literal('reference'),
    planContentHash: sha256Schema,
  })
  .strict();

export const regradeFormJudgmentSchema = z
  .object({
    disposition: z.enum(['mapped', 'out-of-family', 'preserved', 'unresolved']),
    form: z.string().min(1),
    reason: z.string().min(1).optional(),
    representative: z
      .object({
        line: z.number().int().positive(),
        path: z.string().min(1),
      })
      .strict()
      .optional(),
    target: z.string().min(1).optional(),
  })
  .strict();

export type RegradeFormJudgment = z.output<typeof regradeFormJudgmentSchema>;

const embeddedClassifiedStateSchema = z
  .object({
    caseSensitive: z.boolean(),
    forms: z.array(regradeFormJudgmentSchema),
    kind: z.literal('embedded'),
    stateHash: sha256Schema,
  })
  .strict();

const referencedClassifiedStateSchema = z
  .object({
    kind: z.literal('reference'),
    stateHash: sha256Schema,
  })
  .strict();

const completionFactsSchema = z
  .object({
    counts: z
      .object({
        dispositions: z.record(z.string().min(1), countSchema),
        matched: countSchema,
        preserved: countSchema,
        review: countSchema,
        rewritten: countSchema,
        skippedByReason: z.record(z.string().min(1), countSchema),
        unknown: countSchema,
      })
      .strict(),
    gate: z
      .object({
        reasons: z.array(z.string().min(1)),
        remaining: countSchema,
        status: z.enum(['green', 'open']),
      })
      .strict(),
    metrics: z
      .object({
        filesChanged: countSchema,
        formsMapped: countSchema,
        occurrencesRewritten: countSchema,
      })
      .strict(),
  })
  .strict();

const evidenceKeysSchema = z
  .object({
    changedFiles: z.array(
      z
        .object({
          afterBlobHash: gitObjectIdSchema,
          afterPath: z.string().min(1),
          beforeBlobHash: gitObjectIdSchema,
          beforePath: z.string().min(1),
        })
        .strict()
    ),
    detailEvidenceHash: sha256Schema,
    lockStateHash: sha256Schema,
    policyHash: sha256Schema,
    sourceRevision: gitObjectIdSchema,
    sourceStateHash: sha256Schema,
    toolVersion: z.string().min(1),
  })
  .strict();

const regradeRunReceiptSchema = z
  .object({
    classifiedState: z.discriminatedUnion('kind', [
      embeddedClassifiedStateSchema,
      referencedClassifiedStateSchema,
    ]),
    completion: completionFactsSchema,
    evidence: evidenceKeysSchema,
    intent: z.discriminatedUnion('kind', [
      embeddedIntentSchema,
      referencedIntentSchema,
    ]),
    project: z.object({ root: z.literal('.') }).strict(),
    runId: z.string().min(1),
    runKind: z.enum(['original', 'adjust', 'proof']),
    timestamp: z.iso.datetime(),
    transitionId: z.string().min(1),
  })
  .strict();

const conversionProvenanceSchema = z
  .object({
    convertedAt: z.iso.datetime(),
    fromSchemaVersion: z.literal(2),
    sourceContentHash: sha256Schema,
    toolVersion: z.string().min(1),
  })
  .strict();

type RegradeRunReceipt = z.output<typeof regradeRunReceiptSchema>;

const isMachineAbsolutePath = (value: string): boolean =>
  posix.isAbsolute(value) ||
  /^[A-Za-z]:[\\/]/u.test(value) ||
  value.startsWith('\\\\');

const rootRelativePathIssue = (value: string): string | undefined => {
  if (isMachineAbsolutePath(value)) {
    return 'Path-bearing receipt fields must not contain machine-absolute paths.';
  }
  if (value.includes('\\')) {
    return 'Path-bearing receipt fields must use POSIX separators.';
  }
  if (value.includes('\u0000')) {
    return 'Path-bearing receipt fields must be Git-resolvable text paths.';
  }
  if (
    value.length === 0 ||
    value === '.' ||
    posix.normalize(value) !== value ||
    value.startsWith('./') ||
    value === '..' ||
    value.startsWith('../') ||
    value.includes('/../')
  ) {
    return 'Path-bearing receipt fields must be normalized root-relative paths or globs.';
  }
  return undefined;
};

const addPathIssue = (
  ctx: z.RefinementCtx,
  value: string,
  path: readonly (number | string)[]
): void => {
  const message = rootRelativePathIssue(value);
  if (message !== undefined) {
    ctx.addIssue({ code: 'custom', message, path: [...path] });
  }
};

const validateVocabularyPlanPaths = (
  plan: Extract<RegradeReceiptPlan, { readonly kind: 'vocabulary' }>,
  ctx: z.RefinementCtx,
  path: readonly (number | string)[]
): void => {
  for (const [index, value] of (
    plan.scope?.ignoredDirectories ?? []
  ).entries()) {
    addPathIssue(ctx, value, [...path, 'scope', 'ignoredDirectories', index]);
  }
  for (const [index, policy] of (
    plan.scope?.policyClassified ?? []
  ).entries()) {
    for (const [pathIndex, value] of policy.paths.entries()) {
      addPathIssue(ctx, value, [
        ...path,
        'scope',
        'policyClassified',
        index,
        'paths',
        pathIndex,
      ]);
    }
  }
  for (const [index, value] of (plan.scope?.teachingSurfaces ?? []).entries()) {
    addPathIssue(ctx, value, [...path, 'scope', 'teachingSurfaces', index]);
  }
  for (const [index, rename] of (plan.fileRenames ?? []).entries()) {
    addPathIssue(ctx, rename.from, [...path, 'fileRenames', index, 'from']);
    addPathIssue(ctx, rename.to, [...path, 'fileRenames', index, 'to']);
  }
  for (const [index, preserve] of (plan.preserve ?? []).entries()) {
    for (const [pathIndex, value] of (preserve.paths ?? []).entries()) {
      addPathIssue(ctx, value, [
        ...path,
        'preserve',
        index,
        'paths',
        pathIndex,
      ]);
    }
  }
};

const validatePlanPaths = (
  plan: RegradeReceiptPlan,
  ctx: z.RefinementCtx,
  path: readonly (number | string)[]
): void => {
  for (const [index, value] of (plan.scope?.include ?? []).entries()) {
    addPathIssue(ctx, value, [...path, 'scope', 'include', index]);
  }
  for (const [index, value] of (plan.scope?.exclude ?? []).entries()) {
    addPathIssue(ctx, value, [...path, 'scope', 'exclude', index]);
  }
  if (plan.kind === 'vocabulary') {
    validateVocabularyPlanPaths(plan, ctx, path);
  }
};

const proofClaimsNoAction = (run: RegradeRunReceipt): boolean => {
  const { counts, gate, metrics } = run.completion;
  return (
    run.evidence.changedFiles.length === 0 &&
    gate.status === 'green' &&
    gate.remaining === 0 &&
    gate.reasons.length === 0 &&
    counts.matched === 0 &&
    counts.preserved === 0 &&
    counts.review === 0 &&
    counts.rewritten === 0 &&
    counts.unknown === 0 &&
    Object.keys(counts.dispositions).length === 0 &&
    Object.keys(counts.skippedByReason).length === 0 &&
    metrics.filesChanged === 0 &&
    metrics.occurrencesRewritten === 0
  );
};

const validateProofRun = (
  run: RegradeRunReceipt,
  runIndex: number,
  ctx: z.RefinementCtx
): void => {
  if (run.intent.kind !== 'reference') {
    ctx.addIssue({
      code: 'custom',
      message: 'Proof receipts must hash-reference prior authored intent.',
      path: ['runs', runIndex, 'intent'],
    });
  }
  if (run.classifiedState.kind !== 'reference') {
    ctx.addIssue({
      code: 'custom',
      message: 'Proof receipts must hash-reference prior classified state.',
      path: ['runs', runIndex, 'classifiedState'],
    });
  }
  if (!proofClaimsNoAction(run)) {
    ctx.addIssue({
      code: 'custom',
      message:
        'Proof receipts must be green zero-actionable evidence and cannot claim changes.',
      path: ['runs', runIndex],
    });
  }
};

const validateEmbeddedForms = (
  run: RegradeRunReceipt,
  runIndex: number,
  ctx: z.RefinementCtx
): void => {
  if (run.classifiedState.kind !== 'embedded') {
    return;
  }
  for (const [formIndex, form] of run.classifiedState.forms.entries()) {
    if ((form.disposition === 'mapped') !== (form.target !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Mapped form judgments require a target; other judgments must not claim one.',
        path: [
          'runs',
          runIndex,
          'classifiedState',
          'forms',
          formIndex,
          'target',
        ],
      });
    }
    if (form.representative !== undefined) {
      addPathIssue(ctx, form.representative.path, [
        'runs',
        runIndex,
        'classifiedState',
        'forms',
        formIndex,
        'representative',
        'path',
      ]);
    }
  }
};

const validateRunPaths = (
  run: RegradeRunReceipt,
  runIndex: number,
  ctx: z.RefinementCtx
): void => {
  for (const [fileIndex, file] of run.evidence.changedFiles.entries()) {
    addPathIssue(ctx, file.beforePath, [
      'runs',
      runIndex,
      'evidence',
      'changedFiles',
      fileIndex,
      'beforePath',
    ]);
    addPathIssue(ctx, file.afterPath, [
      'runs',
      runIndex,
      'evidence',
      'changedFiles',
      fileIndex,
      'afterPath',
    ]);
  }
  if (run.intent.kind === 'embedded') {
    validatePlanPaths(run.intent.plan, ctx, [
      'runs',
      runIndex,
      'intent',
      'plan',
    ]);
  }
  validateEmbeddedForms(run, runIndex, ctx);
};

const validateRunEvidence = (
  run: RegradeRunReceipt,
  runIndex: number,
  ctx: z.RefinementCtx
): void => {
  const beforePaths = new Set(
    run.evidence.changedFiles.map((file) => file.beforePath)
  );
  const afterPaths = new Set(
    run.evidence.changedFiles.map((file) => file.afterPath)
  );
  if (
    beforePaths.size !== run.evidence.changedFiles.length ||
    afterPaths.size !== run.evidence.changedFiles.length
  ) {
    ctx.addIssue({
      code: 'custom',
      message:
        'Changed-file evidence must contain one transition per source and destination path.',
      path: ['runs', runIndex, 'evidence', 'changedFiles'],
    });
  }
  if (
    run.completion.metrics.filesChanged !== run.evidence.changedFiles.length
  ) {
    ctx.addIssue({
      code: 'custom',
      message:
        'Completion filesChanged must equal the changed-file evidence count.',
      path: ['runs', runIndex, 'completion', 'metrics', 'filesChanged'],
    });
  }
  for (const [fileIndex, file] of run.evidence.changedFiles.entries()) {
    if (
      file.beforePath === file.afterPath &&
      file.beforeBlobHash === file.afterBlobHash
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Changed-file evidence must identify a content transition.',
        path: ['runs', runIndex, 'evidence', 'changedFiles', fileIndex],
      });
    }
  }

  const { counts, gate, metrics } = run.completion;
  const hasUnresolvedCounts = counts.review > 0 || counts.unknown > 0;
  const coherentGate =
    gate.status === 'green'
      ? gate.remaining === 0 &&
        gate.reasons.length === 0 &&
        !hasUnresolvedCounts
      : gate.reasons.length > 0;
  if (!coherentGate) {
    ctx.addIssue({
      code: 'custom',
      message:
        'A green completion gate must have no remaining work, reasons, review, or unknown counts; an open gate must explain its unresolved obligations.',
      path: ['runs', runIndex, 'completion', 'gate'],
    });
  }
  if (counts.rewritten !== metrics.occurrencesRewritten) {
    ctx.addIssue({
      code: 'custom',
      message:
        'Completion rewritten count must equal occurrencesRewritten metrics.',
      path: ['runs', runIndex, 'completion', 'metrics', 'occurrencesRewritten'],
    });
  }
};

const validateReceiptRun = (
  historyId: string,
  run: RegradeRunReceipt,
  runIndex: number,
  ctx: z.RefinementCtx
): void => {
  if (run.transitionId !== historyId) {
    ctx.addIssue({
      code: 'custom',
      message: 'Receipt run transitionId must match the history id.',
      path: ['runs', runIndex, 'transitionId'],
    });
  }
  if (run.runKind === 'proof') {
    validateProofRun(run, runIndex, ctx);
  } else if (run.intent.kind !== 'embedded') {
    ctx.addIssue({
      code: 'custom',
      message: 'Original and adjustment receipts must embed authored intent.',
      path: ['runs', runIndex, 'intent'],
    });
  }
  validateRunPaths(run, runIndex, ctx);
  validateRunEvidence(run, runIndex, ctx);
};

export const regradeHistoryReceiptSchema = z
  .object({
    conversion: conversionProvenanceSchema.optional(),
    id: z.string().min(1),
    kind: z.literal('regrade-history'),
    path: z.string().min(1),
    runs: z.array(regradeRunReceiptSchema).min(1),
    schemaVersion: z.literal(REGRADE_HISTORY_RECEIPT_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    addPathIssue(ctx, artifact.path, ['path']);
    if (!/^\.trails\/regrade\/history\/[^/]+\.json$/u.test(artifact.path)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Receipt path must be a generator-owned consolidated history file.',
        path: ['path'],
      });
    }
    for (const [runIndex, run] of artifact.runs.entries()) {
      validateReceiptRun(artifact.id, run, runIndex, ctx);
    }
  });

export type RegradeHistoryReceipt = z.output<
  typeof regradeHistoryReceiptSchema
>;

export interface ResolvedRegradeHistoryReceiptRun {
  readonly receipt: RegradeHistoryReceipt['runs'][number];
  readonly plan: RegradeReceiptPlan;
  readonly classifiedState: {
    readonly caseSensitive: boolean;
    readonly forms: readonly RegradeFormJudgment[];
    readonly stateHash: string;
  };
}

export interface ResolvedRegradeHistoryReceipt {
  readonly artifact: RegradeHistoryReceipt;
  readonly runs: readonly ResolvedRegradeHistoryReceiptRun[];
}

const canonicalizeJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonicalizeJsonValue(value[key])])
    );
  }
  return value;
};

/** Recursively sort object keys while preserving authored array order. */
export const canonicalRegradeJson = (value: unknown): string =>
  JSON.stringify(canonicalizeJsonValue(value));

/** SHA-256 content address over canonical Regrade JSON. */
export const regradeReceiptContentHash = (value: unknown): string =>
  createHash('sha256').update(canonicalRegradeJson(value)).digest('hex');

export const regradeReceiptPlanContentHash = (
  plan: RegradeReceiptPlan
): string => regradeReceiptContentHash(plan);

const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const canonicalClassifiedState = (state: {
  readonly caseSensitive: boolean;
  readonly forms: readonly RegradeFormJudgment[];
}) => ({
  caseSensitive: state.caseSensitive,
  forms: [...state.forms].toSorted(
    (left, right) =>
      compareCodeUnits(left.form, right.form) ||
      compareCodeUnits(left.disposition, right.disposition)
  ),
});

export const regradeClassifiedStateHash = (state: {
  readonly caseSensitive: boolean;
  readonly forms: readonly RegradeFormJudgment[];
}): string => regradeReceiptContentHash(canonicalClassifiedState(state));

const invalidReceipt = (
  message: string,
  context: Readonly<Record<string, unknown>>
): TrailsResult<never, ValidationError> =>
  Result.err(new ValidationError(message, { context }));

/** Resolve all hash-referenced authored intent and classified form state. */
export const resolveRegradeHistoryReceipt = (
  value: unknown
): TrailsResult<ResolvedRegradeHistoryReceipt, ValidationError> => {
  const parsed = regradeHistoryReceiptSchema.safeParse(value);
  if (!parsed.success) {
    return invalidReceipt('Invalid Regrade history receipt.', {
      issues: parsed.error.issues,
    });
  }

  const plans = new Map<string, RegradeReceiptPlan>();
  const classifiedStates = new Map<
    string,
    {
      readonly caseSensitive: boolean;
      readonly forms: readonly RegradeFormJudgment[];
      readonly stateHash: string;
    }
  >();
  const runs: ResolvedRegradeHistoryReceiptRun[] = [];
  const runIds = new Set<string>();

  for (const [index, run] of parsed.data.runs.entries()) {
    if (runIds.has(run.runId)) {
      return invalidReceipt('Regrade receipt runId must be unique.', {
        run: index,
        runId: run.runId,
      });
    }
    runIds.add(run.runId);
    let plan: RegradeReceiptPlan | undefined;
    if (run.intent.kind === 'embedded') {
      const { plan: embeddedPlan, planContentHash } = run.intent;
      const actualHash = regradeReceiptPlanContentHash(embeddedPlan);
      if (actualHash !== planContentHash) {
        return invalidReceipt('Regrade receipt plan hash mismatch.', {
          actualHash,
          expectedHash: planContentHash,
          run: index,
        });
      }
      plan = embeddedPlan;
      plans.set(planContentHash, plan);
    } else {
      plan = plans.get(run.intent.planContentHash);
      if (plan === undefined) {
        return invalidReceipt('Broken Regrade receipt plan reference.', {
          planContentHash: run.intent.planContentHash,
          run: index,
        });
      }
    }

    let classifiedState:
      | {
          readonly caseSensitive: boolean;
          readonly forms: readonly RegradeFormJudgment[];
          readonly stateHash: string;
        }
      | undefined;
    if (run.classifiedState.kind === 'embedded') {
      const embeddedState = run.classifiedState;
      const uniqueForms = new Set(
        embeddedState.forms.map((form) =>
          embeddedState.caseSensitive ? form.form : form.form.toLowerCase()
        )
      );
      if (uniqueForms.size !== embeddedState.forms.length) {
        return invalidReceipt(
          'Regrade receipt classified state contains duplicate forms.',
          { run: index }
        );
      }
      const state = {
        caseSensitive: embeddedState.caseSensitive,
        forms: embeddedState.forms,
      };
      const actualHash = regradeClassifiedStateHash(state);
      if (actualHash !== embeddedState.stateHash) {
        return invalidReceipt(
          'Regrade receipt classified state hash mismatch.',
          {
            actualHash,
            expectedHash: embeddedState.stateHash,
            run: index,
          }
        );
      }
      classifiedState = { ...state, stateHash: actualHash };
      classifiedStates.set(actualHash, classifiedState);
    } else {
      classifiedState = classifiedStates.get(run.classifiedState.stateHash);
      if (classifiedState === undefined) {
        return invalidReceipt(
          'Broken Regrade receipt classified state reference.',
          { run: index, stateHash: run.classifiedState.stateHash }
        );
      }
    }

    runs.push({ classifiedState, plan, receipt: run });
  }

  return Result.ok({ artifact: parsed.data, runs });
};

const canonicalReceiptArtifact = (
  artifact: RegradeHistoryReceipt
): RegradeHistoryReceipt => ({
  ...artifact,
  runs: artifact.runs.map((run) => ({
    ...run,
    classifiedState:
      run.classifiedState.kind === 'reference'
        ? run.classifiedState
        : {
            ...run.classifiedState,
            forms: canonicalClassifiedState(run.classifiedState).forms,
          },
    completion: {
      ...run.completion,
      gate: {
        ...run.completion.gate,
        reasons: [...new Set(run.completion.gate.reasons)].toSorted(),
      },
    },
    evidence: {
      ...run.evidence,
      changedFiles: [...run.evidence.changedFiles].toSorted(
        (left, right) =>
          compareCodeUnits(left.beforePath, right.beforePath) ||
          compareCodeUnits(left.afterPath, right.afterPath)
      ),
    },
  })),
});

/** Parse, validate, resolve, and emit canonical generator-owned receipt bytes. */
export const serializeRegradeHistoryReceipt = (
  value: unknown
): TrailsResult<string, ValidationError> => {
  const resolved = resolveRegradeHistoryReceipt(value);
  if (resolved.isErr()) {
    return resolved;
  }
  return Result.ok(
    `${JSON.stringify(
      canonicalizeJsonValue(canonicalReceiptArtifact(resolved.value.artifact)),
      null,
      2
    )}\n`
  );
};
