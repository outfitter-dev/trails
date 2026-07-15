import type { WardenDiagnostic, WardenRule } from '@ontrails/warden';

const RULE_NAME = 'v1-retired-layer-vocabulary';

const RETIRED_LAYER_TYPE_PATTERN = /\bGate\b(?!\s+\d)/g;
const RETIRED_LAYER_COLLECTION_PATTERN = /\bgates\b|\bmiddleware\b/g;

const HISTORICAL_PATH_PARTS = [
  '/docs/adr/',
  '/docs/migration/',
  '/docs/releases/',
] as const;

const COLLECTION_VOCABULARY_PATH_SUFFIXES = [
  '/AGENTS.md',
  '/docs/architecture.md',
  '/plugin/rules/lexicon.md',
  '/plugin/rules/vocabulary.md',
] as const;

const SELF_PATH_SUFFIXES = [
  '/.trails/rules/v1-retired-layer-vocabulary.ts',
  '/scripts/__tests__/v1-retired-layer-vocabulary-rule.test.ts',
] as const;

const GOVERNED_PATH_PARTS = [
  '/apps/',
  '/docs/',
  '/packages/',
  '/plugin/',
  '/scripts/',
] as const;

const NESTED_REPO_PATH_PARTS = [
  '/adapters/',
  '/apps/',
  '/docs/',
  '/examples/',
  '/packages/',
  '/plugin/',
  '/scripts/',
] as const;

const normalizePath = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const isRepoRootFile = (filePath: string, name: string): boolean => {
  if (filePath === name) {
    return true;
  }
  const normalized = normalizePath(filePath);
  return (
    normalized.endsWith(`/${name}`) &&
    !NESTED_REPO_PATH_PARTS.some((part) => normalized.includes(part))
  );
};

const isHistoricalFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  return (
    normalized.endsWith('/CHANGELOG.md') ||
    HISTORICAL_PATH_PARTS.some((part) => normalized.includes(part))
  );
};

const isGovernedFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  return (
    isRepoRootFile(filePath, 'AGENTS.md') ||
    isRepoRootFile(filePath, 'README.md') ||
    GOVERNED_PATH_PARTS.some((part) => normalized.includes(part))
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

const diagnosticsFor = (
  sourceCode: string,
  filePath: string,
  pattern: RegExp,
  message: (form: string) => string
): readonly WardenDiagnostic[] =>
  [...sourceCode.matchAll(pattern)].map((match) => ({
    filePath,
    line: lineForOffset(sourceCode, match.index ?? 0),
    message: message(match[0]),
    rule: RULE_NAME,
    severity: 'error',
  }));

export const v1RetiredLayerVocabulary: WardenRule = {
  check(sourceCode, filePath): readonly WardenDiagnostic[] {
    const normalized = normalizePath(filePath);
    if (
      !isGovernedFile(normalized) ||
      isHistoricalFile(normalized) ||
      SELF_PATH_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
    ) {
      return [];
    }
    const diagnostics = [
      ...diagnosticsFor(
        sourceCode,
        filePath,
        RETIRED_LAYER_TYPE_PATTERN,
        (form) =>
          `Retired layer type vocabulary '${form}' remains outside documented history.`
      ),
    ];
    if (
      !COLLECTION_VOCABULARY_PATH_SUFFIXES.some((suffix) =>
        suffix === '/AGENTS.md'
          ? isRepoRootFile(filePath, 'AGENTS.md')
          : normalized.endsWith(suffix)
      )
    ) {
      diagnostics.push(
        ...diagnosticsFor(
          sourceCode,
          filePath,
          RETIRED_LAYER_COLLECTION_PATTERN,
          (form) =>
            `Retired layer collection vocabulary '${form}' remains outside documented history or an explicit lexicon seam.`
        )
      );
    }
    return diagnostics;
  },
  description:
    'Reject retired Gate, gates, and middleware vocabulary outside documented history and lexicon seams.',
  metadata: {
    concern: 'general',
    depth: 'source',
    invariant:
      'Layer vocabulary stays current outside documented history and explicit lexicon seams.',
    lifecycle: { state: 'durable' },
    scope: 'repo-local',
    tier: 'source-static',
  },
  name: RULE_NAME,
  severity: 'error',
  sourceKinds: ['documentation', 'text', 'typescript'],
};

export const sourceRules = [v1RetiredLayerVocabulary];
