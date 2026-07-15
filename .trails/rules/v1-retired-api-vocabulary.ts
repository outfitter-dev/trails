import type { WardenDiagnostic, WardenRule } from '@ontrails/warden';

const RULE_NAME = 'v1-retired-api-vocabulary';

const HISTORICAL_PATH_PARTS = [
  '/docs/adr/',
  '/docs/migration/',
  '/docs/releases/',
] as const;

const SELF_PATH_SUFFIXES = [
  '/.trails/rules/v1-retired-api-vocabulary.ts',
  '/scripts/__tests__/v1-retired-api-vocabulary-rule.test.ts',
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

interface RetiredApiPattern {
  readonly allowHistory?: boolean;
  readonly excludePathSuffixes?: readonly string[];
  readonly message: string;
  readonly pattern: RegExp;
}

const RETIRED_API_PATTERNS: readonly RetiredApiPattern[] = [
  {
    excludePathSuffixes: [
      '/apps/trails/src/__tests__/run-watch-compose.test.ts',
      '/apps/trails/src/run-watch.ts',
      '/adapters/commander/src/__tests__/to-commander.test.ts',
      '/packages/store/src/__tests__/jsonfile.test.ts',
      '/packages/store/src/testing.ts',
      '/packages/testing/src/harness-cli.ts',
      '/packages/topography/src/__tests__/topo-store.test.ts',
      '/packages/topography/src/topo-store.ts',
      '/packages/observability/src/dev/internal/dev-state.ts',
    ],
    message:
      'Retired trail implementation field run: remains; use implementation: instead.',
    pattern:
      /\brun\s*:\s*(?:(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|function\s*\()/g,
  },
  {
    allowHistory: true,
    message:
      'Retired composition declaration follow: remains; use composes: instead.',
    pattern: /\bfollow\s*:/g,
  },
  {
    allowHistory: true,
    message:
      'Retired composition call ctx.follow(...) remains; use ctx.compose(...).',
    pattern: /\bctx\.follow\(/g,
  },
  {
    message:
      'Retired infrastructure factory service(...) remains; use resource(...).',
    pattern: /\bservice\(/g,
  },
  {
    allowHistory: true,
    message:
      'Retired infrastructure declaration services: remains; use resources: instead.',
    pattern: /\bservices\s*:/g,
  },
  {
    excludePathSuffixes: [
      '/packages/warden/src/__tests__/valid-describe-refs.test.ts',
    ],
    message:
      'Retired notification factory event(...) remains; use signal(...).',
    pattern: /\bevent\(/g,
  },
  {
    allowHistory: true,
    message:
      'Retired notification call ctx.emit(...) remains; use ctx.fire(...).',
    pattern: /\bctx\.emit\(/g,
  },
  {
    allowHistory: true,
    message:
      'Retired notification declaration emits: remains; use fires: instead.',
    pattern: /\bemits\s*:/g,
  },
  {
    excludePathSuffixes: [
      '/packages/core/src/__tests__/schedule-runtime.test.ts',
    ],
    message:
      'Retired activation syntax trigger(...) remains; use fires: instead.',
    pattern: /\btrigger\(/g,
  },
  {
    excludePathSuffixes: ['/packages/core/src/__tests__/execute.test.ts'],
    message:
      'Retired TrailContext signal: AbortSignal field remains; use abortSignal instead.',
    pattern: /\bsignal\s*:\s*AbortSignal|readonly signal: AbortSignal/g,
  },
];

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

const lineForOffset = (sourceCode: string, offset: number): number =>
  sourceCode.slice(0, offset).split('\n').length;

export const v1RetiredApiVocabulary: WardenRule = {
  check(sourceCode, filePath): readonly WardenDiagnostic[] {
    const normalized = normalizePath(filePath);
    if (
      !isGovernedFile(filePath) ||
      SELF_PATH_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
    ) {
      return [];
    }

    const historical = isHistoricalFile(normalized);
    return RETIRED_API_PATTERNS.flatMap((entry) => {
      if (
        (entry.allowHistory && historical) ||
        entry.excludePathSuffixes?.some((suffix) => normalized.endsWith(suffix))
      ) {
        return [];
      }
      return [...sourceCode.matchAll(entry.pattern)].map((match) => ({
        filePath,
        line: lineForOffset(sourceCode, match.index ?? 0),
        message: entry.message,
        rule: RULE_NAME,
        severity: 'error' as const,
      }));
    });
  },
  description:
    'Reject retired v1 API forms that are not governed by Regrade vocabulary histories.',
  metadata: {
    concern: 'general',
    depth: 'source',
    invariant:
      'Retired implementation, composition, resource, signal, activation, and abort APIs do not return outside reviewed compatibility seams.',
    lifecycle: { state: 'durable' },
    scope: 'repo-local',
    tier: 'source-static',
  },
  name: RULE_NAME,
  severity: 'error',
  sourceKinds: ['documentation', 'text', 'typescript'],
};

export const sourceRules = [v1RetiredApiVocabulary];
