import {
  identifierName,
  offsetToLine,
  parseWithDiagnostics,
  walk,
} from './ast.js';
import type { AstNode } from './ast.js';
import { listGovernedVocabularyTransitions } from './retired-vocabulary.js';
import type {
  GovernedVocabularySymbolRename,
  GovernedVocabularyTransition,
} from './retired-vocabulary.js';
import type { WardenDiagnostic, WardenFix, WardenRule } from './types.js';

const RULE_NAME = 'governed-symbol-residue';

const ACTIVE_STATUSES = new Set<GovernedVocabularyTransition['status']>([
  'active',
  'complete',
]);

const FIX_OWNED_TRANSITION_IDS = new Set(['cross-compose']);

const ALLOWED_SOURCE_PATH_SUFFIXES = [
  '/packages/warden/src/rules/governed-symbol-residue.ts',
  '/packages/warden/src/rules/retired-vocabulary.ts',
] as const;

const normalizePath = (filePath: string): string =>
  filePath.replaceAll('\\', '/');

const isAllowedSourcePath = (filePath: string): boolean =>
  ALLOWED_SOURCE_PATH_SUFFIXES.some((suffix) =>
    normalizePath(filePath).endsWith(suffix)
  );

const activeSymbolRenames = (): readonly GovernedVocabularySymbolRename[] =>
  listGovernedVocabularyTransitions()
    .filter(
      (transition) =>
        ACTIVE_STATUSES.has(transition.status) &&
        !FIX_OWNED_TRANSITION_IDS.has(transition.id)
    )
    .flatMap((transition) => transition.symbolRenames);

const renameBySourceSymbol = (): ReadonlyMap<
  string,
  GovernedVocabularySymbolRename
> =>
  new Map(
    activeSymbolRenames().map((rename) => [rename.from, rename] as const)
  );

const safeFixFor = (
  sourceCode: string,
  node: AstNode,
  rename: GovernedVocabularySymbolRename
): WardenFix | undefined => {
  const end = node.start + rename.from.length;
  if (sourceCode.slice(node.start, end) !== rename.from) {
    return undefined;
  }
  return {
    class: 'term-rewrite',
    edits: [
      {
        end,
        replacement: rename.to,
        start: node.start,
      },
    ],
    reason: `Retired governed symbol '${rename.from}' has a mechanical replacement '${rename.to}'.`,
    safety: 'safe',
  };
};

const diagnosticFor = (
  sourceCode: string,
  filePath: string,
  node: AstNode,
  rename: GovernedVocabularySymbolRename
): WardenDiagnostic => {
  const fix = safeFixFor(sourceCode, node, rename);
  return {
    filePath,
    ...(fix === undefined ? {} : { fix }),
    line: offsetToLine(sourceCode, node.start),
    message: `Retired governed symbol '${rename.from}' should migrate to '${rename.to}'.`,
    rule: RULE_NAME,
    severity: 'error',
  };
};

export const governedSymbolResidue: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isAllowedSourcePath(filePath)) {
      return [];
    }

    const renames = renameBySourceSymbol();
    if (renames.size === 0) {
      return [];
    }

    const parsed = parseWithDiagnostics(filePath, sourceCode);
    if (!parsed.ast || parsed.diagnostics.length > 0) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    walk(parsed.ast, (node) => {
      const name = identifierName(node);
      if (name === null) {
        return;
      }

      const rename = renames.get(name);
      if (rename === undefined) {
        return;
      }

      diagnostics.push(diagnosticFor(sourceCode, filePath, node, rename));
    });

    return diagnostics;
  },
  description:
    'Detect active governed vocabulary symbols that remain in source code.',
  name: RULE_NAME,
  severity: 'error',
};
