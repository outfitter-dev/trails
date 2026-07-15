import type {
  GovernedVocabularyHistoryEvidence,
  GovernedVocabularyHistoryFormObservation,
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
  observation: GovernedVocabularyHistoryFormObservation
): boolean =>
  observation.reason === 'unclassified-neighbor' &&
  observation.verdict === 'deferred' &&
  (observation.scopeTier === undefined || observation.scopeTier === 'in-scope');

const compareObservation = (
  left: GovernedVocabularyHistoryFormObservation,
  right: GovernedVocabularyHistoryFormObservation
): number =>
  left.path.localeCompare(right.path) ||
  left.line - right.line ||
  left.form.localeCompare(right.form);

const diagnosticsForHistory = (
  evidence: GovernedVocabularyHistoryEvidence
): readonly WardenDiagnostic[] => {
  const unknownByIdentity = new Map<
    string,
    GovernedVocabularyHistoryFormObservation
  >();

  for (const observation of evidence.latestFormObservations) {
    if (!isUnknownPermutation(observation)) {
      continue;
    }
    const identity = formIdentity(observation.form, evidence);
    const current = unknownByIdentity.get(identity);
    if (current === undefined || compareObservation(observation, current) < 0) {
      unknownByIdentity.set(identity, observation);
    }
  }

  return [...unknownByIdentity.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, observation]) => ({
      filePath: observation.path,
      line: observation.line,
      message: `Governed transition '${evidence.transitionId}' recorded unknown vocabulary form '${observation.form}' in committed Regrade history '${evidence.path}' (${evidence.id}). Add the form and run an incremental plan, or classify it as out-of-family or preserved.`,
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
