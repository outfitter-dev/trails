import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  getGovernedVocabularyTransition,
  governedVocabularyHistoryProvenanceSchema,
  listGovernedVocabularyTransitions,
} from './rules/retired-vocabulary.js';
import type {
  GovernedVocabularyHistoryEvidence,
  GovernedVocabularyHistoryIssue,
} from './rules/types.js';

const planBodySchema = z.discriminatedUnion('kind', [
  z
    .object({
      from: z.string().min(1),
      id: z.string().optional(),
      kind: z.literal('vocabulary'),
      to: z.string().min(1),
    })
    .passthrough(),
  z
    .object({
      classIds: z.array(z.string().min(1)).min(1),
      id: z.string().min(1),
      kind: z.literal('class'),
    })
    .passthrough(),
]);

const planArtifactSchema = z
  .object({
    derivation: z.unknown().optional(),
    expansion: z.unknown().optional(),
    kind: z.literal('regrade-plan'),
    path: z.string().min(1),
    plan: planBodySchema,
    provenance: z.object({
      fields: z.record(z.string(), z.enum(['authored', 'derived'])),
    }),
    schemaVersion: z.literal(1),
    sourceHash: z.string().min(1),
    transitionId: z.string().min(1).optional(),
  })
  .strict();

const historyRunSchema = z
  .object({
    completionReport: z.unknown().optional(),
    completionReportHash: z.string().optional(),
    lockHashAtRun: z.string().min(1),
    plan: planArtifactSchema,
    planContentHash: z.string().min(1),
    provenance: governedVocabularyHistoryProvenanceSchema.optional(),
    report: z.unknown(),
  })
  .strict();

const historyArtifactSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal('regrade-history'),
    path: z.string().min(1),
    runs: z.array(historyRunSchema).min(1),
    schemaVersion: z.literal(2),
  })
  .strict();

const reportEntrySchema = z
  .object({
    classId: z.string().optional(),
    notes: z.array(z.string()).optional(),
    outcome: z.enum(['needs-review', 'no-op', 'rewrite', 'skip']),
    path: z.string(),
    reason: z.string().optional(),
    reviewDetails: z.unknown().optional(),
  })
  .passthrough();

const reportSchema = z
  .object({
    apply: z.object({ applied: z.number() }).passthrough().optional(),
    entries: z.array(reportEntrySchema),
    matched: z.number(),
    review: z.number(),
    rewritten: z.number(),
    root: z.string(),
    run: z
      .object({
        ledger: z
          .object({
            cycle: z.unknown(),
            forms: z.record(z.string(), z.unknown()),
            occurrences: z.array(
              z
                .object({
                  form: z.string(),
                  path: z.string(),
                  scopeTier: z.string().optional(),
                })
                .passthrough()
            ),
          })
          .passthrough(),
        report: z
          .object({
            fileRenames: z
              .array(
                z
                  .object({
                    deferred: z.number(),
                    from: z.string(),
                    historical: z.number().optional(),
                    preserved: z.number().optional(),
                    rewritten: z.number(),
                    skipped: z.number().optional(),
                    to: z.string(),
                  })
                  .passthrough()
              )
              .optional(),
          })
          .passthrough(),
      })
      .passthrough()
      .optional(),
    scan: z.object({
      byDirectory: z.array(z.unknown()),
      byExtension: z.array(z.unknown()),
      files: z.object({
        matched: z.number(),
        scanned: z.number(),
        skipped: z.number(),
      }),
      skippedByReason: z.record(z.string(), z.number()),
    }),
    scanned: z.number(),
    selectedClassIds: z.array(z.string()),
    skipped: z.number(),
    skipsByReason: z.record(z.string(), z.number()),
    unknownClassIds: z.array(z.string()),
  })
  .passthrough();

const governedHistoryRunSchema = historyRunSchema.extend({
  completionReport: reportSchema,
  completionReportHash: z.string().regex(/^[0-9a-f]{64}$/),
  lockHashAtRun: z.string().regex(/^[0-9a-f]{64}$/),
  planContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  report: reportSchema,
});

type GovernedHistoryRun = z.infer<typeof governedHistoryRunSchema>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const isGeneratedRegradeArtifact = (path: string): boolean =>
  /(?:^|\/)\.trails\/regrade\/.+\.json$/u.test(path);

const sourceHashFacts = (
  report: z.infer<typeof reportSchema>,
  policyMode: 'current' | 'legacy' = 'current',
  fileEvidenceMode: 'current' | 'legacy' = 'current'
): unknown => {
  const ledger = report.run?.ledger;
  const occurrences = ledger?.occurrences.filter(
    (occurrence) =>
      occurrence.scopeTier !== 'policy-classified' ||
      (policyMode === 'current' && !isGeneratedRegradeArtifact(occurrence.path))
  );
  const forms = new Set(occurrences?.map((occurrence) => occurrence.form));
  return {
    entries: report.entries
      .filter(
        (entry) =>
          entry.outcome === 'rewrite' || entry.outcome === 'needs-review'
      )
      .map(({ classId, notes, outcome, path, reason, reviewDetails }) => ({
        ...(classId === undefined ? {} : { classId }),
        ...(notes === undefined ? {} : { notes }),
        outcome,
        path,
        ...(reason === undefined ? {} : { reason }),
        ...(reviewDetails === undefined ? {} : { reviewDetails }),
      })),
    fileRenames: report.run?.report.fileRenames?.map((rename) => ({
      deferred: rename.deferred,
      from: rename.from,
      ...(fileEvidenceMode === 'current'
        ? {
            historical: rename.historical ?? 0,
            preserved: rename.preserved ?? 0,
          }
        : {}),
      rewritten: rename.rewritten,
      ...(fileEvidenceMode === 'current'
        ? { skipped: rename.skipped ?? 0 }
        : {}),
      to: rename.to,
    })),
    ledger:
      ledger === undefined || occurrences === undefined || forms === undefined
        ? undefined
        : {
            cycle: ledger.cycle,
            forms: Object.fromEntries(
              Object.entries(ledger.forms).filter(([form]) => forms.has(form))
            ),
            occurrences,
          },
    selectedClassIds: report.selectedClassIds,
  };
};

const sourceHashes = (report: z.infer<typeof reportSchema>): Set<string> => {
  const facts = [
    sourceHashFacts(report),
    sourceHashFacts(report, 'current', 'legacy'),
    sourceHashFacts(report, 'legacy'),
    sourceHashFacts(report, 'legacy', 'legacy'),
  ];
  return new Set(
    facts.flatMap((value) => [
      hash(JSON.stringify(canonicalizeJsonValue(value))),
      hash(JSON.stringify(value)),
    ])
  );
};

interface RawGovernedHistoryRun {
  readonly completionReport?: z.infer<typeof reportSchema>;
  readonly report: z.infer<typeof reportSchema>;
}

const rawEvidenceReports = (
  run: GovernedHistoryRun,
  rawRun: RawGovernedHistoryRun | undefined
): {
  readonly completionReport: z.infer<typeof reportSchema>;
  readonly report: z.infer<typeof reportSchema>;
} => ({
  completionReport:
    rawRun?.completionReport ?? rawRun?.report ?? run.completionReport,
  report: rawRun?.report ?? run.report,
});

const validatesDeterministicEvidence = (
  run: GovernedHistoryRun,
  rawRun: RawGovernedHistoryRun | undefined,
  transitionId: string
): boolean => {
  const { provenance } = run;
  const { completionReport, report } = rawEvidenceReports(run, rawRun);
  const provenanceValid =
    provenance === undefined ||
    (provenance.disposition ===
      (run.report.review > 0 ? 'review-follow-up' : 'applied-clean') &&
      provenance.kind === 'governed-vocabulary' &&
      provenance.planContentHash === run.planContentHash &&
      provenance.reviewPending === run.report.review &&
      provenance.safeApplied ===
        (run.report.apply?.applied ?? run.report.rewritten) &&
      sourceHashes(completionReport).has(provenance.sourceHashAfter) &&
      sourceHashes(report).has(provenance.sourceHashBefore) &&
      provenance.transitionId === transitionId);
  return (
    hash(JSON.stringify(canonicalizeJsonValue(run.plan.plan))) ===
      run.planContentHash &&
    sourceHashes(report).has(run.lockHashAtRun) &&
    sourceHashes(completionReport).has(run.completionReportHash) &&
    provenanceValid
  );
};

export interface GovernedVocabularyHistoryIndex {
  readonly byTransitionId: ReadonlyMap<
    string,
    GovernedVocabularyHistoryEvidence
  >;
  readonly issues: readonly GovernedVocabularyHistoryIssue[];
}

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

type HistoryFileResult =
  | {
      readonly kind: 'evidence';
      readonly value: GovernedVocabularyHistoryEvidence;
    }
  | { readonly kind: 'ignore' }
  | { readonly kind: 'issue'; readonly value: GovernedVocabularyHistoryIssue };

const historyIssue = (
  path: string,
  message: string,
  transitionId?: string
): HistoryFileResult => ({
  kind: 'issue',
  value: {
    message,
    path,
    ...(transitionId === undefined ? {} : { transitionId }),
  },
});

const governedTransitionForRun = (run: z.infer<typeof historyRunSchema>) => {
  const { plan } = run.plan;
  if (plan.kind !== 'vocabulary') {
    return;
  }
  const transitionIds = [
    plan.id,
    run.provenance?.transitionId,
    run.plan.transitionId,
  ];
  for (const transitionId of transitionIds) {
    if (transitionId === undefined) {
      continue;
    }
    const transition = getGovernedVocabularyTransition(transitionId);
    if (transition !== undefined) {
      return transition;
    }
  }
  return listGovernedVocabularyTransitions().find(
    (transition) =>
      transition.from === plan.from &&
      (transition.target.kind === 'single'
        ? transition.target.to === plan.to
        : transition.target.options.some((option) => option.to === plan.to))
  );
};

const loadHistoryFile = (rootDir: string, name: string): HistoryFileResult => {
  const absolutePath = join(rootDir, '.trails', 'regrade', 'history', name);
  const observedPath = normalizePath(relative(rootDir, absolutePath));
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch {
    return historyIssue(
      observedPath,
      'Committed Regrade history is not valid JSON.'
    );
  }
  const parsed = historyArtifactSchema.safeParse(json);
  if (!parsed.success) {
    return historyIssue(
      observedPath,
      'Committed Regrade history has an invalid evidence shape.'
    );
  }
  if (normalizePath(parsed.data.path) !== observedPath) {
    return historyIssue(
      observedPath,
      'Committed Regrade history path does not match its observed file.'
    );
  }

  const latestRun = parsed.data.runs.at(-1);
  const transition =
    latestRun === undefined ? undefined : governedTransitionForRun(latestRun);
  if (transition === undefined) {
    return { kind: 'ignore' };
  }
  const allRunsMatchTransition = parsed.data.runs.every((run) => {
    const runPlan = run.plan.plan;
    if (
      runPlan.kind !== 'vocabulary' ||
      governedTransitionForRun(run)?.id !== transition.id ||
      runPlan.from !== transition.from
    ) {
      return false;
    }
    return transition.target.kind === 'single'
      ? transition.target.to === runPlan.to
      : transition.target.options.some((option) => option.to === runPlan.to);
  });
  if (!allRunsMatchTransition) {
    return historyIssue(
      observedPath,
      'Committed Regrade history does not match its governed registry transition.',
      transition.id
    );
  }
  const governedRuns = parsed.data.runs.map((run) =>
    governedHistoryRunSchema.safeParse(run)
  );
  const rawRuns = (
    json as {
      readonly runs: readonly RawGovernedHistoryRun[];
    }
  ).runs;
  if (
    transition.provenance.mode === 'regrade-history' &&
    (governedRuns.some((run) => !run.success) ||
      governedRuns.some(
        (run, index) =>
          run.success &&
          !validatesDeterministicEvidence(
            run.data,
            rawRuns[index],
            transition.id
          )
      ))
  ) {
    return historyIssue(
      observedPath,
      'Committed Regrade history has invalid deterministic run evidence.',
      transition.id
    );
  }
  if (
    parsed.data.runs.some(
      (run) =>
        run.provenance !== undefined &&
        run.provenance.transitionId !== transition.id
    )
  ) {
    return historyIssue(
      observedPath,
      'Committed Regrade history provenance names a different governed transition.',
      transition.id
    );
  }
  if (
    transition.provenance.mode === 'regrade-history' &&
    parsed.data.runs.some((run) => run.provenance === undefined)
  ) {
    return historyIssue(
      observedPath,
      'Committed Regrade history lacks required governed provenance.',
      transition.id
    );
  }
  const provenance = parsed.data.runs.at(-1)?.provenance;
  return {
    kind: 'evidence',
    value: {
      id: parsed.data.id,
      path: parsed.data.path,
      ...(provenance === undefined ? {} : { provenance }),
      runCount: parsed.data.runs.length,
      transitionId: transition.id,
    },
  };
};

export const loadGovernedVocabularyHistory = (
  rootDir: string
): GovernedVocabularyHistoryIndex => {
  const directory = join(rootDir, '.trails', 'regrade', 'history');
  if (!existsSync(directory)) {
    return { byTransitionId: new Map(), issues: [] };
  }

  const byTransitionId = new Map<string, GovernedVocabularyHistoryEvidence>();
  const issues: GovernedVocabularyHistoryIssue[] = [];
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .toSorted();

  for (const name of files) {
    const result = loadHistoryFile(rootDir, name);
    if (result.kind === 'ignore') {
      continue;
    }
    if (result.kind === 'issue') {
      issues.push(result.value);
      continue;
    }
    if (byTransitionId.has(result.value.transitionId)) {
      issues.push({
        message:
          'Multiple committed Regrade histories claim the same governed transition.',
        path: result.value.path,
        transitionId: result.value.transitionId,
      });
      continue;
    }
    byTransitionId.set(result.value.transitionId, result.value);
  }

  return { byTransitionId, issues };
};
