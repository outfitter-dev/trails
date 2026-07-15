import {
  createAstIdentifierRenameClass,
  deriveFileRenameCandidates,
  deriveVocabularyFormProposals,
  runFileRenameRegrade,
  runRegrade,
} from '@ontrails/regrade';
import type {
  RegradeReport,
  VocabularyPreserveInventoryEntry,
  VocabularyRegradePlan,
} from '@ontrails/regrade';

import { isGeneratedRegradeArtifactPath } from './plan-artifact.js';
import type {
  RegradePlanArtifact,
  RegradePlanDerivation,
} from './plan-artifact.js';

const provenanceForForm = (
  source: RegradePlanDerivation['forms'][number]['source'],
  fields: RegradePlanArtifact['provenance']['fields']
): 'authored' | 'derived' => {
  if (source === 'seed') {
    return 'authored';
  }
  if (source === 'plan-override') {
    return fields['overrides'] ?? 'derived';
  }
  if (source === 'plan-defer') {
    return fields['deferForms'] ?? 'derived';
  }
  return 'derived';
};

const namespaceCensus = (
  report: RegradeReport
): RegradePlanDerivation['namespaces'] => {
  const namespaces = new Map<
    string,
    { inScope: number; policyClassified: number }
  >();
  for (const occurrence of report.run?.ledger.occurrences ?? []) {
    if (isGeneratedRegradeArtifactPath(occurrence.path)) {
      continue;
    }
    const namespace = occurrence.path.split('/')[0] ?? occurrence.path;
    const counts = namespaces.get(namespace) ?? {
      inScope: 0,
      policyClassified: 0,
    };
    if (occurrence.scopeTier === 'policy-classified') {
      counts.policyClassified += 1;
    } else {
      counts.inScope += 1;
    }
    namespaces.set(namespace, counts);
  }
  return [...namespaces.entries()]
    .map(([namespace, counts]) => ({
      ...counts,
      namespace,
      provenance: 'derived' as const,
    }))
    .toSorted((left, right) => left.namespace.localeCompare(right.namespace));
};

const observedReviews = (
  report: RegradeReport
): RegradePlanDerivation['reviews'] => {
  const reviews = new Map<string, RegradePlanDerivation['reviews'][number]>();
  for (const occurrence of report.run?.ledger.occurrences ?? []) {
    if (
      isGeneratedRegradeArtifactPath(occurrence.path) ||
      (occurrence.verdict !== 'deferred' &&
        occurrence.disposition !== 'code-context-out-of-engine' &&
        occurrence.disposition !== 'in-family-unresolved')
    ) {
      continue;
    }
    const key = `${occurrence.form}\0${occurrence.reason}`;
    const current = reviews.get(key);
    const evidence = {
      column: occurrence.column,
      line: occurrence.line,
      path: occurrence.path,
    };
    reviews.set(key, {
      evidence:
        current === undefined ? [evidence] : [...current.evidence, evidence],
      provenance: 'derived',
      reason: occurrence.reason,
      status: 'pending',
      value: occurrence.form,
    });
  }
  return [...reviews.values()]
    .map((review) => ({
      ...review,
      evidence: review.evidence.toSorted((left, right) =>
        left.path === right.path
          ? (left.line ?? 0) - (right.line ?? 0)
          : left.path.localeCompare(right.path)
      ),
    }))
    .toSorted((left, right) => left.value.localeCompare(right.value));
};

const identifierReviews = (params: {
  readonly plan: VocabularyRegradePlan;
  readonly rootDir: string;
}): RegradePlanDerivation['reviews'] => {
  const { scope } = params.plan;
  const sourceForms = [
    ...new Map(
      deriveVocabularyFormProposals(params.plan).map((form) => [
        form.from,
        form,
      ])
    ).values(),
  ];
  const collection = {
    ...(scope?.exclude === undefined ? {} : { exclude: scope.exclude }),
    extensions: scope?.extensions ?? ['.js', '.jsx', '.mjs', '.ts', '.tsx'],
    ...(scope?.include === undefined ? {} : { include: scope.include }),
  };
  const entries: RegradeReport['entries'][number][] = [];
  for (const form of sourceForms) {
    const report = runRegrade({
      classes: [
        createAstIdentifierRenameClass({
          from: form.from,
          id: `derived-plan-identifiers:${form.from}->${form.to ?? params.plan.to}`,
          match: 'identifier-segment',
          reviewAllMatches: true,
          to: form.to ?? params.plan.to,
        }),
      ],
      collection,
      root: params.rootDir,
    });
    if (report.isErr()) {
      return [
        {
          evidence: [],
          provenance: 'derived',
          reason: `identifier-review-scan-failed: ${report.error.message}`,
          status: 'pending',
          value: form.from,
        },
      ];
    }
    entries.push(...(report.value?.entries ?? []));
  }
  return entries
    .flatMap((entry) =>
      (entry.reviewDetails ?? []).flatMap((detail) =>
        detail.symbol === undefined
          ? []
          : [
              {
                evidence: [
                  {
                    ...(detail.span?.column === undefined
                      ? {}
                      : { column: detail.span.column }),
                    ...(detail.span?.line === undefined
                      ? {}
                      : { line: detail.span.line }),
                    path: entry.path,
                  },
                ],
                provenance: 'derived' as const,
                reason: detail.reason,
                status: 'pending' as const,
                value: detail.symbol,
              },
            ]
      )
    )
    .toSorted((left, right) => left.value.localeCompare(right.value));
};

const mergeReviews = (
  ...groups: readonly RegradePlanDerivation['reviews'][]
): RegradePlanDerivation['reviews'] => {
  const merged = new Map<string, RegradePlanDerivation['reviews'][number]>();
  for (const review of groups.flat()) {
    const key = `${review.value}\0${review.reason}`;
    const current = merged.get(key);
    merged.set(key, {
      ...review,
      evidence: [...(current?.evidence ?? []), ...review.evidence]
        .filter(
          (entry, index, evidence) =>
            evidence.findIndex(
              (candidate) =>
                candidate.path === entry.path &&
                candidate.line === entry.line &&
                candidate.column === entry.column
            ) === index
        )
        .toSorted((left, right) => left.path.localeCompare(right.path)),
    });
  }
  return [...merged.values()].toSorted((left, right) =>
    left.value === right.value
      ? left.reason.localeCompare(right.reason)
      : left.value.localeCompare(right.value)
  );
};

const referenceClosure = (params: {
  readonly candidates: ReturnType<typeof deriveFileRenameCandidates>;
  readonly plan: VocabularyRegradePlan;
  readonly rootDir: string;
}): RegradePlanDerivation['referenceClosure'] => {
  if (params.candidates.length === 0) {
    return { entries: [], moves: [] };
  }
  const result = runFileRenameRegrade({
    excludeGeneratedArtifacts: true,
    renames: params.candidates,
    root: params.rootDir,
    ...(params.plan.scope === undefined ? {} : { scope: params.plan.scope }),
  });
  if (result.isErr()) {
    return { entries: [], issue: result.error.message, moves: [] };
  }
  return {
    entries: result.value.report.entries
      .filter(
        (
          entry
        ): entry is typeof entry & {
          readonly outcome: 'needs-review' | 'rewrite';
        } => entry.outcome === 'needs-review' || entry.outcome === 'rewrite'
      )
      .map((entry) => ({
        outcome: entry.outcome,
        path: entry.path,
        provenance: 'derived' as const,
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
      }))
      .toSorted((left, right) => left.path.localeCompare(right.path)),
    moves: result.value.evidence.map(
      ({ deferred, from, historical, preserved, rewritten, skipped, to }) => ({
        deferred,
        from,
        historical,
        preserved,
        provenance: 'derived' as const,
        rewritten,
        skipped,
        to,
      })
    ),
  };
};

export const deriveRegradePlanDerivation = (params: {
  readonly plan: VocabularyRegradePlan;
  readonly preserveInventory: readonly VocabularyPreserveInventoryEntry[];
  readonly provenance: RegradePlanArtifact['provenance'];
  readonly report: RegradeReport;
  readonly rootDir: string;
}): RegradePlanDerivation => {
  const candidates = deriveFileRenameCandidates({
    plan: params.plan,
    root: params.rootDir,
  });
  return {
    fileRenames: candidates.map((candidate) => ({
      ...candidate,
      evidence: [...candidate.evidence],
      provenance: 'derived' as const,
      status: 'pending' as const,
    })),
    forms: deriveVocabularyFormProposals(params.plan).map((form) => ({
      ...form,
      provenance: provenanceForForm(form.source, params.provenance.fields),
    })),
    namespaces: namespaceCensus(params.report),
    preserves: params.preserveInventory.map((entry) => ({
      disposition: 'preserve-current-live-api' as const,
      evidence: [...entry.evidence],
      pattern: entry.pattern,
      provenance: 'derived' as const,
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    })),
    referenceClosure: referenceClosure({
      candidates,
      plan: params.plan,
      rootDir: params.rootDir,
    }),
    reviews: mergeReviews(
      observedReviews(params.report),
      identifierReviews({ plan: params.plan, rootDir: params.rootDir })
    ),
  };
};
