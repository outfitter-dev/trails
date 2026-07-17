import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const gitObjectIdSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const countSchema = z.number().int().nonnegative();
const vocabularyDispositionValues = [
  'code-context-out-of-engine',
  'docs-only',
  'explicit-preserve',
  'forward-pointer',
  'historical-by-policy',
  'ignored-by-scope',
  'in-family-modified',
  'in-family-unresolved',
  'out-of-family',
  'preserve-current-live-api',
] as const;

const scopeSchema = z
  .object({
    exclude: z.array(z.string()).optional(),
    extensions: z.array(z.string()).optional(),
    include: z.array(z.string()).optional(),
  })
  .strict();

const vocabularyScopeSchema = scopeSchema.extend({
  ignoredDirectories: z.array(z.string()).optional(),
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
});

const vocabularyPlanSchema = z
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
    preserve: z
      .array(
        z
          .object({
            disposition: z.enum(vocabularyDispositionValues).optional(),
            forms: z.array(z.string().min(1)).optional(),
            paths: z.array(z.string()).optional(),
            pattern: z.string(),
            reason: z.string().optional(),
          })
          .strict()
      )
      .optional(),
    scope: vocabularyScopeSchema.optional(),
    to: z.string().min(1),
  })
  .strict();

const classPlanSchema = z
  .object({
    classIds: z.array(z.string().min(1)).min(1),
    id: z.string().min(1),
    intent: z.string().optional(),
    kind: z.literal('class'),
    name: z.string().min(1).optional(),
    scope: scopeSchema.optional(),
  })
  .strict();

const planSchema = z.discriminatedUnion('kind', [
  vocabularyPlanSchema,
  classPlanSchema,
]);

const planProvenanceSchema = z
  .object({
    fields: z.record(z.string(), z.enum(['authored', 'derived'])),
  })
  .strict();

const formJudgmentSchema = z
  .object({
    disposition: z.enum(['mapped', 'out-of-family', 'preserved', 'unresolved']),
    form: z.string().min(1),
    reason: z.string().min(1).optional(),
    representative: z
      .object({ line: z.number().int().positive(), path: z.string().min(1) })
      .strict()
      .optional(),
    target: z.string().min(1).optional(),
  })
  .strict();

const completionSchema = z
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

const runSchema = z
  .object({
    classifiedState: z.discriminatedUnion('kind', [
      z
        .object({
          caseSensitive: z.boolean(),
          forms: z.array(formJudgmentSchema),
          kind: z.literal('embedded'),
          stateHash: sha256Schema,
        })
        .strict(),
      z
        .object({ kind: z.literal('reference'), stateHash: sha256Schema })
        .strict(),
    ]),
    completion: completionSchema,
    evidence: z
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
      .strict(),
    intent: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('embedded'),
          plan: planSchema,
          planContentHash: sha256Schema,
          provenance: planProvenanceSchema,
        })
        .strict(),
      z
        .object({ kind: z.literal('reference'), planContentHash: sha256Schema })
        .strict(),
    ]),
    project: z.object({ root: z.literal('.') }).strict(),
    runId: z.string().min(1),
    runKind: z.enum(['original', 'adjust', 'proof']),
    timestamp: z.iso.datetime(),
    transitionId: z.string().min(1),
  })
  .strict();

const receiptSchema = z
  .object({
    conversion: z
      .object({
        convertedAt: z.iso.datetime(),
        fromSchemaVersion: z.literal(2),
        sourceContentHash: sha256Schema,
        toolVersion: z.string().min(1),
      })
      .strict()
      .optional(),
    id: z.string().min(1),
    kind: z.literal('regrade-history'),
    path: z.string().min(1),
    runs: z.array(runSchema).min(1),
    schemaVersion: z.literal(3),
  })
  .strict();

type Receipt = z.output<typeof receiptSchema>;
type Plan = z.output<typeof planSchema>;
type FormJudgment = z.output<typeof formJudgmentSchema>;

export interface WardenResolvedReceipt {
  readonly artifact: Receipt;
  readonly runs: readonly {
    readonly caseSensitive: boolean;
    readonly forms: readonly FormJudgment[];
    readonly plan: Plan;
  }[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, canonicalize(value[key])])
  );
};

const contentHash = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');

const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const stateHash = (state: {
  readonly caseSensitive: boolean;
  readonly forms: readonly FormJudgment[];
}): string =>
  contentHash({
    caseSensitive: state.caseSensitive,
    forms: [...state.forms].toSorted(
      (left, right) =>
        compareCodeUnits(left.form, right.form) ||
        compareCodeUnits(left.disposition, right.disposition)
    ),
  });

const validRootRelativePath = (value: string): boolean =>
  value.length > 0 &&
  value !== '.' &&
  !posix.isAbsolute(value) &&
  !/^[A-Za-z]:[\\/]/u.test(value) &&
  !value.startsWith('\\\\') &&
  !value.includes('\\') &&
  !value.includes('\u0000') &&
  posix.normalize(value) === value &&
  !value.startsWith('./') &&
  value !== '..' &&
  !value.startsWith('../') &&
  !value.includes('/../');

const planPaths = (plan: Plan): readonly string[] => {
  const common = [
    ...(plan.scope?.include ?? []),
    ...(plan.scope?.exclude ?? []),
  ];
  if (plan.kind === 'class') {
    return common;
  }
  return [
    ...common,
    ...(plan.scope?.ignoredDirectories ?? []),
    ...(plan.scope?.teachingSurfaces ?? []),
    ...(plan.scope?.policyClassified ?? []).flatMap((item) => item.paths),
    ...(plan.fileRenames ?? []).flatMap((rename) => [rename.from, rename.to]),
    ...(plan.preserve ?? []).flatMap((item) => item.paths ?? []),
  ];
};

const proofIsMinimal = (run: Receipt['runs'][number]): boolean => {
  const { counts, gate, metrics } = run.completion;
  return (
    run.intent.kind === 'reference' &&
    run.classifiedState.kind === 'reference' &&
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
    metrics.formsMapped === 0 &&
    metrics.occurrencesRewritten === 0
  );
};

type ReceiptRun = Receipt['runs'][number];
interface ResolvedState {
  readonly caseSensitive: boolean;
  readonly forms: readonly FormJudgment[];
}
type Resolution<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly error: string; readonly ok: false };

const validateRunEvidence = (run: ReceiptRun): string | undefined => {
  const beforePaths = new Set<string>();
  const afterPaths = new Set<string>();
  for (const file of run.evidence.changedFiles) {
    if (
      !validRootRelativePath(file.beforePath) ||
      !validRootRelativePath(file.afterPath) ||
      beforePaths.has(file.beforePath) ||
      afterPaths.has(file.afterPath) ||
      (file.beforePath === file.afterPath &&
        file.beforeBlobHash === file.afterBlobHash)
    ) {
      return 'invalid changed-file evidence';
    }
    beforePaths.add(file.beforePath);
    afterPaths.add(file.afterPath);
  }
  if (
    run.completion.metrics.filesChanged !== run.evidence.changedFiles.length
  ) {
    return 'changed-file count mismatch';
  }
  const { counts, gate, metrics } = run.completion;
  const hasUnresolvedCounts = counts.review > 0 || counts.unknown > 0;
  const gateIsCoherent =
    gate.status === 'green'
      ? gate.remaining === 0 &&
        gate.reasons.length === 0 &&
        !hasUnresolvedCounts
      : gate.reasons.length > 0;
  if (counts.rewritten !== metrics.occurrencesRewritten || !gateIsCoherent) {
    return 'incoherent completion facts';
  }
  return undefined;
};

const resolvePlan = (
  run: ReceiptRun,
  plans: Map<string, Plan>
): Resolution<Plan> => {
  if (run.intent.kind === 'reference') {
    const plan = plans.get(run.intent.planContentHash);
    return plan === undefined
      ? { error: 'broken plan reference', ok: false }
      : { ok: true, value: plan };
  }
  if (
    contentHash({
      plan: run.intent.plan,
      provenance: run.intent.provenance,
    }) !== run.intent.planContentHash ||
    planPaths(run.intent.plan).some((path) => !validRootRelativePath(path))
  ) {
    return { error: 'invalid embedded plan', ok: false };
  }
  plans.set(run.intent.planContentHash, run.intent.plan);
  return { ok: true, value: run.intent.plan };
};

const resolveState = (
  run: ReceiptRun,
  states: Map<string, ResolvedState>
): Resolution<ResolvedState> => {
  if (run.classifiedState.kind === 'reference') {
    const state = states.get(run.classifiedState.stateHash);
    return state === undefined
      ? { error: 'broken classified state reference', ok: false }
      : { ok: true, value: state };
  }
  const { caseSensitive, forms } = run.classifiedState;
  const identities = new Set(
    forms.map((form) => (caseSensitive ? form.form : form.form.toLowerCase()))
  );
  if (
    identities.size !== forms.length ||
    forms.some(
      (form) =>
        (form.disposition === 'mapped') !== (form.target !== undefined) ||
        (form.representative !== undefined &&
          !validRootRelativePath(form.representative.path))
    )
  ) {
    return { error: 'invalid classified form state', ok: false };
  }
  const state = { caseSensitive, forms };
  if (stateHash(state) !== run.classifiedState.stateHash) {
    return { error: 'classified state hash mismatch', ok: false };
  }
  states.set(run.classifiedState.stateHash, state);
  return { ok: true, value: state };
};

/** Validate and resolve only the compact receipt facts consumed by Warden. */
export const resolveReceiptForWarden = (
  value: unknown
): { readonly error?: string; readonly value?: WardenResolvedReceipt } => {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) {
    return { error: 'invalid evidence shape' };
  }
  const artifact = parsed.data;
  if (
    !validRootRelativePath(artifact.path) ||
    !/^\.trails\/regrade\/history\/[^/]+\.json$/u.test(artifact.path)
  ) {
    return { error: 'invalid receipt path' };
  }

  const plans = new Map<string, Plan>();
  const states = new Map<string, ResolvedState>();
  const runIds = new Set<string>();
  const runs: WardenResolvedReceipt['runs'][number][] = [];

  for (const run of artifact.runs) {
    if (run.transitionId !== artifact.id || runIds.has(run.runId)) {
      return { error: 'invalid transition or duplicate run identity' };
    }
    runIds.add(run.runId);
    if (run.runKind === 'proof' && !proofIsMinimal(run)) {
      return { error: 'invalid proof receipt' };
    }
    if (run.runKind !== 'proof' && run.intent.kind !== 'embedded') {
      return { error: 'non-proof receipt must embed intent' };
    }

    const evidenceError = validateRunEvidence(run);
    if (evidenceError !== undefined) {
      return { error: evidenceError };
    }
    const plan = resolvePlan(run, plans);
    if (!plan.ok) {
      return { error: plan.error };
    }
    const state = resolveState(run, states);
    if (!state.ok) {
      return { error: state.error };
    }
    runs.push({
      caseSensitive: state.value.caseSensitive,
      forms: state.value.forms,
      plan: plan.value,
    });
  }
  return { value: { artifact, runs } };
};
