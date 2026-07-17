import type {
  GovernedVocabularyHistoryEvidence,
  GovernedVocabularyHistoryFormJudgment,
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const RULE_NAME = 'governed-vocabulary-permutation-watch';

const formIdentity = (
  form: string,
  evidence: GovernedVocabularyHistoryEvidence
): string => (evidence.caseSensitive ? form : form.toLowerCase());

const isUnknownPermutation = (
  judgment: GovernedVocabularyHistoryFormJudgment
): boolean =>
  judgment.disposition === 'unresolved' &&
  judgment.reason === 'unclassified-neighbor';

const compareObservation = (
  left: GovernedVocabularyHistoryFormJudgment,
  right: GovernedVocabularyHistoryFormJudgment
): number =>
  (left.representative?.path ?? '').localeCompare(
    right.representative?.path ?? ''
  ) ||
  (left.representative?.line ?? 1) - (right.representative?.line ?? 1) ||
  left.form.localeCompare(right.form);

const diagnosticsForHistory = (
  evidence: GovernedVocabularyHistoryEvidence
): readonly WardenDiagnostic[] => {
  const unknownByIdentity = new Map<
    string,
    GovernedVocabularyHistoryFormJudgment
  >();

  for (const judgment of evidence.latestFormJudgments) {
    if (!isUnknownPermutation(judgment)) {
      continue;
    }
    const identity = formIdentity(judgment.form, evidence);
    const current = unknownByIdentity.get(identity);
    if (current === undefined || compareObservation(judgment, current) < 0) {
      unknownByIdentity.set(identity, judgment);
    }
  }

  return [...unknownByIdentity.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, judgment]) => ({
      filePath: judgment.representative?.path ?? evidence.path,
      line: judgment.representative?.line ?? 1,
      message: `Governed transition '${evidence.transitionId}' recorded unknown vocabulary form '${judgment.form}' in committed Regrade history '${evidence.path}' (${evidence.id}). Add the form and run an incremental plan, or classify it as out-of-family or preserved.`,
      rule: RULE_NAME,
      severity: 'warn' as const,
    }));
};

const checkProject = (context: ProjectContext): readonly WardenDiagnostic[] =>
  [...(context.governedVocabularyHistoryByTransitionId?.values() ?? [])]
    .toSorted((left, right) =>
      left.transitionId.localeCompare(right.transitionId)
    )
    .flatMap(diagnosticsForHistory);

export const governedVocabularyPermutationWatch: ProjectAwareWardenRule = {
  check: () => [],
  checkProject,
  checkWithContext: () => [],
  description:
    'Advise when committed Regrade history records unclassified permutations of governed vocabulary.',
  name: RULE_NAME,
  severity: 'warn',
};
