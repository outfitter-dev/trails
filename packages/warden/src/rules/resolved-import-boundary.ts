import { hasIgnoreCommentOnLine, splitSourceLines } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenImportResolution } from '../resolve.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const RULE_NAME = 'resolved-import-boundary';

const normalizePath = (path: string): string => path.replaceAll('\\', '/');

const isLocalPathImport = (importSource: string): boolean =>
  importSource.startsWith('.') || importSource.startsWith('/');

const isFixtureOrMigrationFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  return /(?:^|\/)(?:__fixtures__|fixtures?|migrations?)(?:\/|$)/.test(
    normalized
  );
};

const isAllowlistedFile = (filePath: string): boolean =>
  isTestFile(filePath) || isFixtureOrMigrationFile(filePath);

const resolutionLabel = (resolution: {
  readonly importSource: string;
  readonly packageName?: string | undefined;
}): string => resolution.packageName ?? resolution.importSource;

const publicSurfaceMessage = (resolution: {
  readonly importSource: string;
  readonly packageName?: string | undefined;
}): string =>
  `Import "${resolution.importSource}" is not exported by ${resolutionLabel(
    resolution
  )}. Import the package root or an exported subpath instead.`;

const localPathBoundaryMessage = (resolution: {
  readonly importSource: string;
  readonly packageName?: string | undefined;
}): string =>
  `Local import "${resolution.importSource}" crosses into ${resolutionLabel(
    resolution
  )}. Import the target package public surface instead.`;

const internalTargetMessage = (resolution: {
  readonly importSource: string;
  readonly packageName?: string | undefined;
}): string =>
  `Import "${resolution.importSource}" targets internal/private files in ${resolutionLabel(
    resolution
  )}. Import the target package public surface instead.`;

const diagnosticForResolution = (
  filePath: string,
  resolution: WardenImportResolution
): WardenDiagnostic | null => {
  if (!resolution.crossesPackageBoundary) {
    return null;
  }

  if (resolution.isInternalTarget) {
    return {
      filePath,
      line: resolution.line,
      message: internalTargetMessage(resolution),
      rule: RULE_NAME,
      severity: 'error',
    };
  }

  if (isLocalPathImport(resolution.importSource)) {
    return {
      filePath,
      line: resolution.line,
      message: localPathBoundaryMessage(resolution),
      rule: RULE_NAME,
      severity: 'error',
    };
  }

  if (resolution.errorKind === 'package-path-not-exported') {
    return {
      filePath,
      line: resolution.line,
      message: publicSurfaceMessage(resolution),
      rule: RULE_NAME,
      severity: 'error',
    };
  }

  if (
    resolution.errorKind &&
    resolution.errorKind !== 'builtin' &&
    resolution.errorKind !== 'ignored'
  ) {
    return {
      filePath,
      line: resolution.line,
      message: publicSurfaceMessage(resolution),
      rule: RULE_NAME,
      severity: 'error',
    };
  }

  return null;
};

const importResolutionsForFile = (context: ProjectContext, filePath: string) =>
  context.importResolutionsByFile?.get(filePath) ?? [];

export const resolvedImportBoundary: ProjectAwareWardenRule = {
  check(): readonly WardenDiagnostic[] {
    return [];
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    if (isAllowlistedFile(filePath)) {
      return [];
    }

    const lines = splitSourceLines(sourceCode);
    const diagnostics: WardenDiagnostic[] = [];

    for (const resolution of importResolutionsForFile(context, filePath)) {
      if (hasIgnoreCommentOnLine(lines, resolution.line)) {
        continue;
      }
      const diagnostic = diagnosticForResolution(filePath, resolution);
      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
    }

    return diagnostics;
  },
  description:
    'Ensure cross-package imports resolve through package-owned public exports.',
  name: RULE_NAME,
  severity: 'error',
};
