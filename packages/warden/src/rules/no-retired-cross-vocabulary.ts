/**
 * Flags retired `cross` composition vocabulary after the beta.19 compose cutover.
 *
 * Exact authored terms that have a mechanical successor carry safe
 * `term-rewrite` edits. Larger identifiers and type prefixes remain
 * review-required because the text-only rule cannot prove the intended symbol
 * boundary.
 */
import { resolve, sep } from 'node:path';

import { requireGovernedVocabularyTransition } from './retired-vocabulary.js';
import type { WardenDiagnostic, WardenFix, WardenRule } from './types.js';

const RULE_NAME = 'no-retired-cross-vocabulary';

const CROSS_COMPOSE_TRANSITION =
  requireGovernedVocabularyTransition('cross-compose');

if (CROSS_COMPOSE_TRANSITION.target.kind !== 'single') {
  throw new Error('cross-compose transition must have a single target.');
}

const COMPOSE_TARGET = CROSS_COMPOSE_TRANSITION.target.to;

const SAFE_REWRITES = Object.entries(
  CROSS_COMPOSE_TRANSITION.safeRewriteForms
).map(([from, to]) => ({ from, to }));

const REVIEW_TERMS = CROSS_COMPOSE_TRANSITION.reviewForms;

const IDENTIFIER_CHAR = /[$0-9A-Z_a-z]/u;

const ALLOWED_PATH_SUFFIXES: readonly string[] = [
  '/docs/migration/cross-to-compose.md',
  '/docs/releases/beta15-to-beta19.md',
  '/docs/adr/0049-composition-is-compose-not-cross.md',
  '/packages/warden/src/rules/no-retired-cross-vocabulary.ts',
  '/packages/warden/src/rules/metadata.ts',
  '/packages/warden/src/rules/retired-vocabulary.ts',
  '/packages/warden/src/trails/governed-symbol-residue.trail.ts',
  '/packages/warden/src/trails/no-retired-cross-vocabulary.trail.ts',
];

interface SafeRewriteMatch {
  readonly from: string;
  readonly index: number;
  readonly to: string;
}

interface ReviewMatch {
  readonly index: number;
  readonly term: string;
}

const normalizePath = (filePath: string): string =>
  resolve(filePath).split(sep).join('/');

const isAllowedFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  return ALLOWED_PATH_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
};

const isIdentifierChar = (value: string): boolean =>
  value !== '' && IDENTIFIER_CHAR.test(value);

const isReviewPrefix = (
  sourceCode: string,
  index: number,
  term: string
): boolean => !(term === 'cross' && sourceCode.startsWith('crosses', index));

const isStandaloneSpan = (
  sourceCode: string,
  start: number,
  end: number
): boolean => {
  const before = start === 0 ? '' : (sourceCode[start - 1] ?? '');
  const after = sourceCode[end] ?? '';
  return !(isIdentifierChar(before) || isIdentifierChar(after));
};

const findSafeRewriteMatches = (
  sourceCode: string
): readonly SafeRewriteMatch[] => {
  const matches: SafeRewriteMatch[] = [];
  for (const rewrite of SAFE_REWRITES) {
    let fromIndex = 0;
    while (fromIndex < sourceCode.length) {
      const index = sourceCode.indexOf(rewrite.from, fromIndex);
      if (index === -1) {
        break;
      }
      const end = index + rewrite.from.length;
      if (isStandaloneSpan(sourceCode, index, end)) {
        matches.push({ ...rewrite, index });
      }
      fromIndex = end;
    }
  }
  return matches.toSorted((a, b) => a.index - b.index);
};

const findReviewMatches = (sourceCode: string): readonly ReviewMatch[] => {
  const safeSpans = findSafeRewriteMatches(sourceCode).map((match) => ({
    end: match.index + match.from.length,
    start: match.index,
  }));
  const isInsideSafeSpan = (index: number): boolean =>
    safeSpans.some((span) => index >= span.start && index < span.end);

  const matches: ReviewMatch[] = [];
  for (const term of REVIEW_TERMS) {
    let fromIndex = 0;
    while (fromIndex < sourceCode.length) {
      const index = sourceCode.indexOf(term, fromIndex);
      if (index === -1) {
        break;
      }
      const end = index + term.length;
      if (!isInsideSafeSpan(index)) {
        const before = index === 0 ? '' : (sourceCode[index - 1] ?? '');
        const after = sourceCode[end] ?? '';
        if (
          !isIdentifierChar(before) &&
          isIdentifierChar(after) &&
          isReviewPrefix(sourceCode, index, term)
        ) {
          matches.push({ index, term });
        }
      }
      fromIndex = end;
    }
  }
  return matches.toSorted((a, b) => a.index - b.index);
};

const lineForOffset = (sourceCode: string, offset: number): number => {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (sourceCode.codePointAt(i) === 10) {
      line += 1;
    }
  }
  return line;
};

const safeFix = (match: SafeRewriteMatch): WardenFix => ({
  class: 'term-rewrite',
  edits: [
    {
      end: match.index + match.from.length,
      replacement: match.to,
      start: match.index,
    },
  ],
  reason: `Retired composition vocabulary '${match.from}' has a mechanical beta.19 replacement '${match.to}'.`,
  safety: 'safe',
});

const reviewFix = (term: string): WardenFix => ({
  class: 'term-rewrite',
  reason: `Retired composition vocabulary '${term}' appears in a larger or ambiguous form. Review before migrating to ${COMPOSE_TARGET} vocabulary.`,
  safety: 'review',
});

const safeMessage = (match: SafeRewriteMatch): string =>
  `Retired composition vocabulary '${match.from}' should be '${match.to}' after the beta.19 compose cutover.`;

const reviewMessage = (term: string): string =>
  `Retired composition vocabulary '${term}' needs review before migrating to ${COMPOSE_TARGET} vocabulary.`;

export const noRetiredCrossVocabulary: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isAllowedFile(filePath)) {
      return [];
    }

    const reviewMatches = findReviewMatches(sourceCode);
    if (reviewMatches.length > 0) {
      return reviewMatches.map((match) => ({
        filePath,
        fix: reviewFix(match.term),
        line: lineForOffset(sourceCode, match.index),
        message: reviewMessage(match.term),
        rule: RULE_NAME,
        severity: 'error',
      }));
    }

    return findSafeRewriteMatches(sourceCode).map((match) => ({
      filePath,
      fix: safeFix(match),
      line: lineForOffset(sourceCode, match.index),
      message: safeMessage(match),
      rule: RULE_NAME,
      severity: 'error',
    }));
  },
  description:
    'Disallow retired cross composition vocabulary after the beta.19 compose cutover.',
  name: RULE_NAME,
  severity: 'error',
};
