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

const preserveRulesFromTransition = (
  transition: GovernedVocabularyTransition
): readonly VocabularyPreserveRule[] =>
  transition.preserve.map((rule) => ({
    ...(rule.paths === undefined ? {} : { paths: rule.paths }),
    pattern: rule.pattern,
    reason: rule.reason,
  }));

const defaultFormsAreRegistrySafe = (
  transition: GovernedVocabularyTransition
): boolean => {
  if (transition.target.kind !== 'single') {
    return false;
  }

  const defaultForms = [
    transition.from,
    pluralizeVocabularyForm(transition.from),
  ];

  return defaultForms.every((form) => {
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

  return {
    caseSensitive: true,
    deferForms: transition.reviewForms,
    from: transition.from,
    id: transition.id,
    intent: transition.intent,
    kind: 'vocabulary',
    overrides: transition.safeRewriteForms,
    preserve: preserveRulesFromTransition(transition),
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
