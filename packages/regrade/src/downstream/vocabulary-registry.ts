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
    ...(scope.exclude === undefined ? {} : { exclude: scope.exclude }),
    ...(scope.extensions === undefined ? {} : { extensions: scope.extensions }),
    ...(scope.ignoredDirectories === undefined
      ? {}
      : { ignoredDirectories: scope.ignoredDirectories }),
    ...(scope.include === undefined ? {} : { include: scope.include }),
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

export const vocabularyRegradePlanFromTransition = (
  transition: GovernedVocabularyTransition
): VocabularyRegradePlan | null => {
  if (
    transition.target.kind !== 'single' ||
    !defaultFormsAreRegistrySafe(transition)
  ) {
    return null;
  }

  const scope = scopeFromTransition(transition);
  return {
    caseSensitive: true,
    deferForms: transition.reviewForms,
    from: transition.from,
    id: transition.id,
    intent: transition.intent,
    kind: 'vocabulary',
    overrides: transition.safeRewriteForms,
    preserve: preserveRulesFromTransition(transition),
    ...(scope === undefined ? {} : { scope }),
    to: transition.target.to,
  };
};

export const listVocabularyRegradePlansFromRegistry =
  (): readonly VocabularyRegradePlan[] =>
    listGovernedVocabularyTransitions()
      .map(vocabularyRegradePlanFromTransition)
      .filter((plan): plan is VocabularyRegradePlan => plan !== null);

export const vocabularyRegradeTransitionForInput = (
  from: string,
  to: string
): GovernedVocabularyTransition | undefined =>
  listGovernedVocabularyTransitions().find(
    (transition) =>
      transition.from === from &&
      transition.target.kind === 'single' &&
      transition.target.to === to
  );
