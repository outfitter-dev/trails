import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  getGovernedVocabularyTransition,
  listGovernedVocabularyTransitions,
} from './rules/retired-vocabulary.js';
import { resolveReceiptForWarden } from './regrade-receipt.js';
import type {
  GovernedVocabularyHistoryEvidence,
  GovernedVocabularyHistoryIssue,
} from './rules/types.js';

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

type GovernedReceiptPlan =
  | { readonly kind: 'class' }
  | {
      readonly from: string;
      readonly id?: string | undefined;
      readonly kind: 'vocabulary';
      readonly to: string;
    };

const governedTransitionForPlan = (
  plan: GovernedReceiptPlan,
  transitionIds: readonly (string | undefined)[] = []
) => {
  if (plan.kind !== 'vocabulary') {
    return;
  }
  for (const transitionId of [plan.id, ...transitionIds]) {
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

const loadReceiptHistoryFile = (
  json: unknown,
  observedPath: string
): HistoryFileResult => {
  const resolved = resolveReceiptForWarden(json);
  if (resolved.value === undefined) {
    return historyIssue(
      observedPath,
      `Committed Regrade receipt has invalid deterministic evidence (${resolved.error ?? 'unknown error'}).`
    );
  }
  const { artifact, runs } = resolved.value;
  if (normalizePath(artifact.path) !== observedPath) {
    return historyIssue(
      observedPath,
      'Committed Regrade history path does not match its observed file.'
    );
  }
  const latest = runs.at(-1);
  const transition =
    latest === undefined
      ? undefined
      : governedTransitionForPlan(latest.plan, [artifact.id]);
  if (transition === undefined) {
    return { kind: 'ignore' };
  }
  const allRunsMatchTransition = runs.every(({ plan }) => {
    if (
      plan.kind !== 'vocabulary' ||
      governedTransitionForPlan(plan, [artifact.id])?.id !== transition.id ||
      plan.from !== transition.from
    ) {
      return false;
    }
    return transition.target.kind === 'single'
      ? transition.target.to === plan.to
      : transition.target.options.some((option) => option.to === plan.to);
  });
  if (!allRunsMatchTransition) {
    return historyIssue(
      observedPath,
      'Committed Regrade history does not match its governed registry transition.',
      transition.id
    );
  }
  return {
    kind: 'evidence',
    value: {
      caseSensitive: latest?.caseSensitive ?? false,
      id: artifact.id,
      latestFormJudgments: latest?.forms ?? [],
      path: artifact.path,
      runCount: runs.length,
      transitionId: transition.id,
    },
  };
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
  return loadReceiptHistoryFile(json, observedPath);
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
