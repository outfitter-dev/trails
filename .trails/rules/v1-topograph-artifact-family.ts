import type { WardenDiagnostic, WardenRule } from '@ontrails/warden';

const RULE_NAME = 'v1-topograph-artifact-family';

const RETIRED_ARTIFACT_PATTERN =
  /\bSurfaceMap(?:Entry)?\b|_surface\.json|\bsurface_map\b|\bserialized_lock\b|\.trails\/config\/local(?:\.[cm]?[tj]s)?|\.trails\/config\.local(?:\.[cm]?[tj]s)?|\.trails\/trails\.db(?:-(?:shm|wal))?|\.trails\/dev\/|\.trails\/generated\//g;

const ALLOWED_PATH_PARTS = [
  '/docs/adr/',
  '/docs/migration/',
  '/docs/releases/',
] as const;

const ALLOWED_PATH_SUFFIXES = [
  '/docs/lexicon.md',
  '/scripts/bootstrap/config.toml',
  '/apps/trails/src/trails/dev-support.ts',
  '/apps/trails/src/trails/create-scaffold.ts',
  '/apps/trails/src/__tests__/create.test.ts',
  '/packages/topography/src/internal/topo-snapshots.ts',
  '/packages/topography/src/__tests__/topo-store.test.ts',
  '/.trails/rules/v1-topograph-artifact-family.ts',
  '/scripts/__tests__/v1-topograph-artifact-family-rule.test.ts',
] as const;

const normalizePath = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const isAllowedFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  return (
    normalized.endsWith('/CHANGELOG.md') ||
    ALLOWED_PATH_PARTS.some((part) => normalized.includes(part)) ||
    ALLOWED_PATH_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
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

export const v1TopographArtifactFamily: WardenRule = {
  check(sourceCode, filePath): readonly WardenDiagnostic[] {
    if (isAllowedFile(filePath)) {
      return [];
    }
    return [...sourceCode.matchAll(RETIRED_ARTIFACT_PATTERN)].map((match) => ({
      filePath,
      line: lineForOffset(sourceCode, match.index),
      message: `Retired TopoGraph artifact-family vocabulary '${match[0]}' remains outside documented history or an explicit compatibility cleanup seam.`,
      rule: RULE_NAME,
      severity: 'error',
    }));
  },
  description:
    'Reject retired TopoGraph artifact-family names outside documented history and compatibility cleanup seams.',
  metadata: {
    concern: 'general',
    depth: 'source',
    invariant:
      'Retired TopoGraph artifact-family names stay confined to documented history and compatibility cleanup seams.',
    lifecycle: { state: 'durable' },
    scope: 'repo-local',
    tier: 'source-static',
  },
  name: RULE_NAME,
  severity: 'error',
  sourceKinds: ['documentation', 'text', 'typescript'],
};

export const sourceRules = [v1TopographArtifactFamily];
