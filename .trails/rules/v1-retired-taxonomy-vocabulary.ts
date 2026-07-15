import type { WardenDiagnostic, WardenRule } from '@ontrails/warden';

const RULE_NAME = 'v1-retired-taxonomy-vocabulary';

const DISPATCH_CALL_PATTERN = /\bdispatch\(/g;
const CONNECTOR_PATTERN =
  /\b[Cc]onnector(?:s)?\b|[A-Za-z_$][\w$]*[Cc]onnector[A-Za-z_$\d]*|(?:^|\/)connectors\//gm;

const HISTORICAL_PATH_PARTS = [
  '/docs/adr/',
  '/docs/migration/',
  '/docs/releases/',
] as const;

const CONNECTOR_ALLOWED_PATH_SUFFIXES = [
  '/docs/index.md',
  '/docs/lexicon.md',
  '/packages/oxlint-plugin/src/__tests__/rules.test.ts',
  '/plugin/rules/lexicon.md',
] as const;

const SELF_PATH_SUFFIXES = [
  '/.trails/rules/v1-retired-taxonomy-vocabulary.ts',
  '/scripts/__tests__/v1-retired-taxonomy-vocabulary-rule.test.ts',
] as const;

const normalizePath = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const isHistoricalFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  return (
    normalized.endsWith('/CHANGELOG.md') ||
    HISTORICAL_PATH_PARTS.some((part) => normalized.includes(part))
  );
};

const lineForOffset = (sourceCode: string, offset: number): number =>
  sourceCode.slice(0, offset).split('\n').length;

const diagnosticsFor = (
  sourceCode: string,
  filePath: string,
  pattern: RegExp,
  message: (form: string) => string
): readonly WardenDiagnostic[] =>
  [...sourceCode.matchAll(pattern)].map((match) => ({
    filePath,
    line: lineForOffset(sourceCode, match.index),
    message: message(match[0]),
    rule: RULE_NAME,
    severity: 'error',
  }));

export const v1RetiredTaxonomyVocabulary: WardenRule = {
  check(sourceCode, filePath): readonly WardenDiagnostic[] {
    const normalized = normalizePath(filePath);
    if (
      isHistoricalFile(normalized) ||
      SELF_PATH_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
    ) {
      return [];
    }
    return [
      ...diagnosticsFor(
        sourceCode,
        filePath,
        DISPATCH_CALL_PATTERN,
        () =>
          'Retired direct-execution helper dispatch(...) remains outside documented history.'
      ),
      ...(CONNECTOR_ALLOWED_PATH_SUFFIXES.some((suffix) =>
        normalized.endsWith(suffix)
      )
        ? []
        : diagnosticsFor(
            sourceCode,
            filePath,
            CONNECTOR_PATTERN,
            (form) =>
              `Retired package taxonomy vocabulary '${form}' remains outside documented history or an explicit lexicon seam; use adapter.`
          )),
    ];
  },
  description:
    'Reject retired dispatch helper and connector package-taxonomy vocabulary outside documented history and lexicon seams.',
  metadata: {
    concern: 'general',
    depth: 'source',
    invariant:
      'Direct execution and package taxonomy vocabulary stay current outside documented history and explicit lexicon seams.',
    lifecycle: { state: 'durable' },
    scope: 'repo-local',
    tier: 'source-static',
  },
  name: RULE_NAME,
  severity: 'error',
  sourceKinds: ['documentation', 'text', 'typescript'],
};

export const sourceRules = [v1RetiredTaxonomyVocabulary];
