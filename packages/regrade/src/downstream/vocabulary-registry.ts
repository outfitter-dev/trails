import type { GovernedVocabularyTransition } from '@ontrails/warden';
import { listGovernedVocabularyTransitions } from '@ontrails/warden';

import type {
  VocabularyPreserveRule,
  VocabularyRegradePlan,
} from './vocabulary.js';

const pluralizeVocabularyForm = (value: string): string =>
  value.endsWith('s') || value.endsWith('x') || value.endsWith('ch')
    ? `${value}es`
    : `${value}s`;

const defaultSourceForms = (value: string): readonly string[] =>
  /^[A-Za-z]+$/.test(value) ? [value, pluralizeVocabularyForm(value)] : [value];

const preserveRulesFromTransition = (
  transition: GovernedVocabularyTransition
): readonly VocabularyPreserveRule[] =>
  transition.preserve.map((rule) => ({
    ...(rule.paths === undefined ? {} : { paths: rule.paths }),
    pattern: rule.pattern,
    reason: rule.reason,
  }));

const scopeFromTransition = (
  transition: GovernedVocabularyTransition
): VocabularyRegradePlan['scope'] | undefined => {
  const { scope } = transition;
  if (scope === undefined) {
    return undefined;
  }
  return {
    ...(scope.exclude === undefined ? {} : { exclude: [...scope.exclude] }),
    ...(scope.extensions === undefined
      ? {}
      : { extensions: [...scope.extensions] }),
    ...(scope.ignoredDirectories === undefined
      ? {}
      : { ignoredDirectories: [...scope.ignoredDirectories] }),
    ...(scope.include === undefined ? {} : { include: [...scope.include] }),
    ...(scope.policyClassified === undefined
      ? {}
      : {
          policyClassified: scope.policyClassified.map((policy) => ({
            ...policy,
            paths: [...policy.paths],
          })),
        }),
    ...(scope.teachingSurfaces === undefined
      ? {}
      : { teachingSurfaces: [...scope.teachingSurfaces] }),
  };
};

const defaultFormsAreRegistrySafe = (
  transition: GovernedVocabularyTransition
): boolean => {
  if (transition.target.kind !== 'single') {
    return false;
  }

  return defaultSourceForms(transition.from).every((form) => {
    const replacement = transition.safeRewriteForms[form];
    return replacement !== undefined && !transition.reviewForms.includes(form);
  });
};

const classifiedTargetMatches = (
  transition: GovernedVocabularyTransition,
  to: string
): boolean =>
  transition.target.kind === 'classified' &&
  transition.target.options.some((option) => option.to === to);

const uniqueForms = (forms: readonly string[]): readonly string[] => [
  ...new Set(forms),
];

export const vocabularyRegradePlanFromTransition = (
  transition: GovernedVocabularyTransition,
  classifiedTarget?: string
): VocabularyRegradePlan | null => {
  const isClassifiedPlan =
    classifiedTarget !== undefined &&
    classifiedTargetMatches(transition, classifiedTarget);
  if (transition.target.kind === 'classified' && !isClassifiedPlan) {
    return null;
  }
  if (
    transition.target.kind === 'single' &&
    !defaultFormsAreRegistrySafe(transition)
  ) {
    return null;
  }

  const scope = scopeFromTransition(transition);
  const to =
    transition.target.kind === 'single'
      ? transition.target.to
      : classifiedTarget;
  if (to === undefined) {
    return null;
  }
  return {
    caseSensitive: true,
    deferForms: isClassifiedPlan
      ? uniqueForms([...transition.oldForms, ...transition.reviewForms])
      : transition.reviewForms,
    ...(transition.fileRenames.length === 0
      ? {}
      : {
          fileRenames: transition.fileRenames.map((rename) => ({ ...rename })),
        }),
    from: transition.from,
    id: transition.id,
    intent: transition.intent,
    kind: 'vocabulary',
    ...(isClassifiedPlan ? {} : { overrides: transition.safeRewriteForms }),
    preserve: preserveRulesFromTransition(transition),
    ...(scope === undefined ? {} : { scope }),
    to,
  };
};

export const vocabularyRegradePlanForInput = (
  from: string,
  to: string
): VocabularyRegradePlan | null => {
  const transition = listGovernedVocabularyTransitions().find(
    (candidate) => candidate.from === from
  );
  if (transition === undefined) {
    return null;
  }
  if (transition.target.kind === 'single' && transition.target.to !== to) {
    return null;
  }
  return vocabularyRegradePlanFromTransition(transition, to);
};

export const listVocabularyRegradePlansFromRegistry =
  (): readonly VocabularyRegradePlan[] =>
    listGovernedVocabularyTransitions()
      .map((transition) => vocabularyRegradePlanFromTransition(transition))
      .filter((plan): plan is VocabularyRegradePlan => plan !== null);

export const vocabularyRegradeTransitionForInput = (
  from: string,
  to: string
): GovernedVocabularyTransition | undefined =>
  listGovernedVocabularyTransitions().find(
    (transition) =>
      transition.from === from &&
      (transition.target.kind === 'single'
        ? transition.target.to === to
        : transition.target.options.some((option) => option.to === to))
  );
