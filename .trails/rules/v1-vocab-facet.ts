import type { WardenDiagnostic, WardenFix, WardenRule } from '@ontrails/warden';

const SAFE_RULE_NAME = 'v1-vocab-facet-safe-prose';
const REVIEW_RULE_NAME = 'v1-vocab-facet-review-inventory';

const SAFE_REWRITES = [
  { from: 'Surface Facets', to: 'Trailheads' },
  { from: 'Surface Facet', to: 'Trailhead' },
  { from: 'surface facets', to: 'trailheads' },
  { from: 'surface facet', to: 'trailhead' },
] as const;

const FACET_TERM = /\b[Ff]acets?\b/g;

const CURRENT_DOC_PREFIXES = [
  '/.agents/skills/',
  '/.claude/skills/',
  '/AGENTS.md',
  '/docs/',
  '/plugin/',
  '/packages/',
  '/apps/',
] as const;

const HISTORICAL_DOC_PREFIXES = [
  '/docs/adr/',
  '/docs/migration/',
  '/docs/releases/',
] as const;

interface RewriteMatch {
  readonly from: string;
  readonly index: number;
  readonly to: string;
}

interface ReviewMatch {
  readonly index: number;
  readonly term: string;
}

interface TextSpan {
  readonly end: number;
  readonly start: number;
}

const normalizePath = (filePath: string): string =>
  filePath.replaceAll('\\', '/');

const isMarkdown = (filePath: string): boolean =>
  normalizePath(filePath).endsWith('.md');

const isCurrentFacingDoc = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  if (!isMarkdown(normalized) || normalized.includes('/CHANGELOG.md')) {
    return false;
  }
  if (HISTORICAL_DOC_PREFIXES.some((prefix) => normalized.includes(prefix))) {
    return false;
  }
  return CURRENT_DOC_PREFIXES.some(
    (prefix) => normalized.endsWith(prefix) || normalized.includes(prefix)
  );
};

const lineForOffset = (sourceCode: string, offset: number): number => {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (sourceCode.codePointAt(index) === 10) {
      line += 1;
    }
  }
  return line;
};

const findSafeMatches = (sourceCode: string): readonly RewriteMatch[] => {
  const candidates: RewriteMatch[] = [];
  for (const rewrite of SAFE_REWRITES) {
    let fromIndex = 0;
    while (fromIndex < sourceCode.length) {
      const index = sourceCode.indexOf(rewrite.from, fromIndex);
      if (index === -1) {
        break;
      }
      candidates.push({ ...rewrite, index });
      fromIndex = index + rewrite.from.length;
    }
  }
  const matches: RewriteMatch[] = [];
  for (const candidate of candidates.toSorted((left, right) => {
    if (left.index !== right.index) {
      return left.index - right.index;
    }
    return right.from.length - left.from.length;
  })) {
    const end = candidate.index + candidate.from.length;
    if (
      matches.some((match) => {
        const matchEnd = match.index + match.from.length;
        return candidate.index < matchEnd && end > match.index;
      })
    ) {
      continue;
    }
    matches.push(candidate);
  }
  return matches.toSorted((left, right) => left.index - right.index);
};

const safeSpans = (sourceCode: string): readonly TextSpan[] =>
  findSafeMatches(sourceCode).map((match) => ({
    end: match.index + match.from.length,
    start: match.index,
  }));

const inlineCodeSpans = (sourceCode: string): readonly TextSpan[] =>
  [...sourceCode.matchAll(/`[^`\n]*`/g)].map((match) => ({
    end: (match.index ?? 0) + match[0].length,
    start: match.index ?? 0,
  }));

const fencedCodeSpans = (sourceCode: string): readonly TextSpan[] =>
  [...sourceCode.matchAll(/```[\s\S]*?```/g)].map((match) => ({
    end: (match.index ?? 0) + match[0].length,
    start: match.index ?? 0,
  }));

const markdownLinkTargetSpans = (sourceCode: string): readonly TextSpan[] =>
  [...sourceCode.matchAll(/\]\([^)]+\)/g)].map((match) => ({
    end: (match.index ?? 0) + match[0].length - 1,
    start: (match.index ?? 0) + 2,
  }));

const isInsideSpan = (index: number, spans: readonly TextSpan[]): boolean =>
  spans.some((span) => index >= span.start && index < span.end);

const isSchemaFacetPhrase = (sourceCode: string, index: number): boolean =>
  sourceCode
    .slice(Math.max(0, index - 'schema '.length), index)
    .toLowerCase()
    .endsWith('schema ');

const findReviewMatches = (sourceCode: string): readonly ReviewMatch[] => {
  const spans = [
    ...safeSpans(sourceCode),
    ...fencedCodeSpans(sourceCode),
    ...inlineCodeSpans(sourceCode),
    ...markdownLinkTargetSpans(sourceCode),
  ];
  const matches: ReviewMatch[] = [];
  for (const match of sourceCode.matchAll(FACET_TERM)) {
    const index = match.index ?? 0;
    if (isInsideSpan(index, spans) || isSchemaFacetPhrase(sourceCode, index)) {
      continue;
    }
    matches.push({ index, term: match[0] ?? 'facet' });
  }
  return matches;
};

const safeFix = (match: RewriteMatch): WardenFix => ({
  class: 'term-rewrite',
  edits: [
    {
      end: match.index + match.from.length,
      replacement: match.to,
      start: match.index,
    },
  ],
  reason: `Retired surface accommodation vocabulary '${match.from}' has a mechanical v1 replacement '${match.to}'.`,
  safety: 'safe',
});

const reviewFix = (term: string): WardenFix => ({
  class: 'term-rewrite',
  reason: `Retired surface accommodation vocabulary '${term}' remains in an ambiguous or API-shaped context. Review before migrating to trailhead vocabulary.`,
  safety: 'review',
});

const baseMetadata = {
  concern: 'meta',
  depth: 'source',
  invariant: 'Facet vocabulary migrates through the v1 trailhead family proof.',
  lifecycle: {
    retireWhen: 'facet to trailhead cutover completes',
    state: 'temporary',
  },
  scope: 'repo-local',
  tier: 'source-static',
} as const;

export const v1VocabFacetSafeProse: WardenRule = {
  check(sourceCode, filePath): readonly WardenDiagnostic[] {
    if (!isCurrentFacingDoc(filePath)) {
      return [];
    }
    return findSafeMatches(sourceCode).map((match) => ({
      filePath,
      fix: safeFix(match),
      line: lineForOffset(sourceCode, match.index),
      message: `Retired surface accommodation vocabulary '${match.from}' should be '${match.to}'.`,
      rule: SAFE_RULE_NAME,
      severity: 'warn',
    }));
  },
  description:
    'Rewrite safe current-facing surface facet prose to trailhead vocabulary.',
  metadata: {
    ...baseMetadata,
    fix: {
      class: 'term-rewrite',
      safety: 'safe',
      scanTargets: { extensions: ['.md'] },
    },
  },
  name: SAFE_RULE_NAME,
  severity: 'warn',
};

export const v1VocabFacetReviewInventory: WardenRule = {
  check(sourceCode, filePath): readonly WardenDiagnostic[] {
    if (!isCurrentFacingDoc(filePath)) {
      return [];
    }
    return findReviewMatches(sourceCode).map((match) => ({
      filePath,
      fix: reviewFix(match.term),
      line: lineForOffset(sourceCode, match.index),
      message: `Retired surface accommodation vocabulary '${match.term}' needs review before migrating to trailhead vocabulary.`,
      rule: REVIEW_RULE_NAME,
      severity: 'warn',
    }));
  },
  description:
    'Inventory remaining ambiguous surface facet vocabulary for review.',
  metadata: {
    ...baseMetadata,
    fix: {
      class: 'term-rewrite',
      safety: 'review',
      scanTargets: { extensions: ['.md'] },
    },
  },
  name: REVIEW_RULE_NAME,
  severity: 'warn',
};

export const sourceRules = [v1VocabFacetSafeProse, v1VocabFacetReviewInventory];
