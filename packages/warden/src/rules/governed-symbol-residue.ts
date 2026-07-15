import {
  getNodeKey,
  getNodeValueNode,
  identifierName,
  offsetToLine,
  parseWithDiagnostics,
  walkWithScopeContext,
} from '@ontrails/source';
import type { AstNode, AstScopeContext } from '@ontrails/source';
import { listGovernedVocabularyTransitions } from './retired-vocabulary.js';
import type {
  GovernedVocabularySymbolRename,
  GovernedVocabularyTransition,
} from './retired-vocabulary.js';
import type {
  GovernedVocabularyHistoryEvidence,
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
  WardenFix,
} from './types.js';

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

interface ActiveSymbolRename {
  readonly history?: GovernedVocabularyHistoryEvidence;
  readonly rename: GovernedVocabularySymbolRename;
  readonly targetSegments: readonly string[];
  readonly transition: GovernedVocabularyTransition;
}

const activeSymbolRenames = (
  context?: ProjectContext
): readonly ActiveSymbolRename[] =>
  listGovernedVocabularyTransitions()
    .filter(
      (transition) =>
        ACTIVE_STATUSES.has(transition.status) &&
        !FIX_OWNED_TRANSITION_IDS.has(transition.id)
    )
    .flatMap((transition) => {
      const targetSegments = [
        ...new Set(transition.symbolRenames.map((rename) => rename.to)),
      ];
      const history = context?.governedVocabularyHistoryByTransitionId?.get(
        transition.id
      );
      return transition.symbolRenames.map((rename) => ({
        ...(history === undefined ? {} : { history }),
        rename,
        targetSegments,
        transition,
      }));
    });

const isIdentifierNamed = (node: AstNode, name: string): boolean =>
  node.type === 'Identifier' && identifierName(node) === name;

const identifierTokenSpan = (
  node: AstNode,
  sourceCode: string,
  name: string
): { readonly end: number; readonly start: number } | null => {
  const end = node.start + name.length;
  return sourceCode.slice(node.start, end) === name
    ? { end, start: node.start }
    : null;
};

const toPascalIdentifierSegment = (value: string): string =>
  value.length === 0
    ? value
    : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;

const isScreamingSnakeIdentifier = (name: string): boolean =>
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(name) && name.includes('_');

const replaceScreamingSnakeIdentifierSegment = (
  name: string,
  from: string,
  to: string
): string | null => {
  if (!isScreamingSnakeIdentifier(name)) {
    return null;
  }

  const fromSegment = from.toUpperCase();
  const toSegment = to.toUpperCase();
  let changed = false;
  const nextName = name
    .split('_')
    .map((segment) => {
      if (segment !== fromSegment) {
        return segment;
      }
      changed = true;
      return toSegment;
    })
    .join('_');

  return changed ? nextName : null;
};

const replaceCamelOrPascalIdentifierSegment = (
  name: string,
  from: string,
  to: string
): string | null => {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
    return null;
  }

  const fromPascalSegment = toPascalIdentifierSegment(from);
  const toPascalSegment = toPascalIdentifierSegment(to);
  const segmentPattern = /[A-Z]+(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|[0-9]+/g;
  let cursor = 0;
  let changed = false;
  let nextName = '';

  for (const match of name.matchAll(segmentPattern)) {
    const [segment] = match;
    const { index } = match;
    if (index === undefined || index !== cursor) {
      return null;
    }

    if (segment === from) {
      changed = true;
      nextName += to;
    } else if (segment === fromPascalSegment) {
      changed = true;
      nextName += toPascalSegment;
    } else {
      nextName += segment;
    }

    cursor = index + segment.length;
  }

  if (cursor !== name.length || !changed) {
    return null;
  }

  return nextName;
};

const deriveIdentifierSegmentTarget = (
  name: string,
  from: string,
  to: string
): string | null => {
  const leadingUnderscores = /^_+/.exec(name)?.[0] ?? '';
  const coreName =
    leadingUnderscores.length > 0
      ? name.slice(leadingUnderscores.length)
      : name;
  if (coreName.length === 0) {
    return null;
  }

  const screamingSnakeTarget = replaceScreamingSnakeIdentifierSegment(
    coreName,
    from,
    to
  );
  if (screamingSnakeTarget !== null) {
    return `${leadingUnderscores}${screamingSnakeTarget}`;
  }

  const camelOrPascalTarget = replaceCamelOrPascalIdentifierSegment(
    coreName,
    from,
    to
  );
  return camelOrPascalTarget === null
    ? null
    : `${leadingUnderscores}${camelOrPascalTarget}`;
};

const hasIdentifierSegment = (name: string, segment: string): boolean =>
  deriveIdentifierSegmentTarget(name, segment, segment) !== null;

interface SymbolRenameMatch {
  readonly from: string;
  readonly rename: GovernedVocabularySymbolRename;
  readonly span: { readonly end: number; readonly start: number } | null;
  readonly to: string;
}

const resolveSymbolRenameMatch = (
  node: AstNode,
  sourceCode: string,
  rename: GovernedVocabularySymbolRename
): SymbolRenameMatch | null => {
  if (rename.match === 'exact') {
    if (!isIdentifierNamed(node, rename.from)) {
      return null;
    }

    return {
      from: rename.from,
      rename,
      span: identifierTokenSpan(node, sourceCode, rename.from),
      to: rename.to,
    };
  }

  if (node.type !== 'Identifier') {
    return null;
  }

  const name = identifierName(node);
  if (name === null) {
    return null;
  }
  const target = deriveIdentifierSegmentTarget(name, rename.from, rename.to);
  if (target === null) {
    return null;
  }

  return {
    from: name,
    rename,
    span: identifierTokenSpan(node, sourceCode, name),
    to: target,
  };
};

const authoredPropertyKeyParentTypes = new Set([
  'AccessorProperty',
  'MethodDefinition',
  'Property',
  'PropertyDefinition',
  'TSAbstractMethodDefinition',
  'TSAbstractPropertyDefinition',
  'TSMethodSignature',
  'TSPropertySignature',
]);

const isAuthoredMemberName = (context: AstScopeContext): boolean =>
  (context.key === 'key' &&
    context.parent !== null &&
    context.parent !== undefined &&
    authoredPropertyKeyParentTypes.has(context.parent.type)) ||
  (context.key === 'parameter' &&
    context.parent?.type === 'TSParameterProperty');

const isModuleBoundaryName = (context: AstScopeContext): boolean =>
  context.parent?.type === 'ImportSpecifier' ||
  context.parent?.type === 'ImportDefaultSpecifier' ||
  context.parent?.type === 'ImportNamespaceSpecifier' ||
  context.parent?.type === 'ExportSpecifier';

const reviewReasonFor = (
  context: AstScopeContext,
  match: SymbolRenameMatch,
  shorthandIdentifiers: ReadonlySet<string>,
  targetSegments: readonly string[]
): string | null => {
  if (match.rename.match === 'identifier-segment') {
    const existingTarget = targetSegments.find((segment) =>
      hasIdentifierSegment(match.from, segment)
    );
    if (existingTarget !== undefined) {
      return `already contains target segment '${existingTarget}'`;
    }
  }

  if (shorthandIdentifiers.has(match.from)) {
    return 'participates in an authored shorthand property';
  }

  const declaration = context.getDeclaration(match.from);
  if (
    declaration &&
    match.rename.reviewDeclarationTypes.includes(declaration.type)
  ) {
    return `resolves to ${declaration.type}`;
  }

  if (isModuleBoundaryName(context)) {
    return 'names an import or export boundary';
  }

  if (
    context.key === 'property' &&
    (context.parent?.type === 'MemberExpression' ||
      context.parent?.type === 'StaticMemberExpression')
  ) {
    return 'is a member property with no governed declaration';
  }

  if (isAuthoredMemberName(context)) {
    return 'is an authored property key';
  }

  return null;
};

const isDuplicateShorthandValueVisit = (
  node: AstNode,
  context: AstScopeContext
): boolean => {
  if (context.key !== 'value' || context.parent?.type !== 'Property') {
    return false;
  }

  const key = getNodeKey(context.parent);
  return key?.start === node.start && key.end === node.end;
};

const isShorthandPropertyKeyVisit = (
  node: AstNode,
  context: AstScopeContext
): boolean => {
  if (context.key !== 'key' || context.parent?.type !== 'Property') {
    return false;
  }

  const value = getNodeValueNode(context.parent);
  return value?.start === node.start && value.end === node.end;
};

const reviewFixFor = (
  match: SymbolRenameMatch,
  reviewReason: string
): WardenFix => ({
  class: 'term-rewrite',
  reason: `Retired governed symbol '${match.from}' ${reviewReason}; review before migrating to '${match.to}'.`,
  safety: 'review',
});

const safeFixFor = (match: SymbolRenameMatch): WardenFix | undefined => {
  if (match.span === null) {
    return undefined;
  }
  return {
    class: 'term-rewrite',
    edits: [
      {
        end: match.span.end,
        replacement: match.to,
        start: match.span.start,
      },
    ],
    reason: `Retired governed symbol '${match.from}' has a mechanical replacement '${match.to}'.`,
    safety: 'safe',
  };
};

const diagnosticMessageFor = (
  match: SymbolRenameMatch,
  transition?: GovernedVocabularyTransition,
  history?: GovernedVocabularyHistoryEvidence
): string => {
  if (history !== undefined) {
    return `Retired governed symbol '${match.from}' was reintroduced after governed transition '${history.transitionId}' in '${history.path}' (${history.id}); migrate to '${match.to}'.`;
  }
  if (transition?.provenance.mode === 'regrade-history') {
    return `Retired governed symbol '${match.from}' belongs to governed transition '${transition.id}', but no committed Regrade history proves the migration ran.`;
  }
  return `Retired governed symbol '${match.from}' should migrate to '${match.to}'.`;
};

const diagnosticFor = (
  sourceCode: string,
  filePath: string,
  node: AstNode,
  match: SymbolRenameMatch,
  reviewReason: string | null,
  transition?: GovernedVocabularyTransition,
  history?: GovernedVocabularyHistoryEvidence
): WardenDiagnostic => {
  const fix =
    reviewReason === null
      ? safeFixFor(match)
      : reviewFixFor(match, reviewReason);
  return {
    filePath,
    ...(fix === undefined ? {} : { fix }),
    line: offsetToLine(sourceCode, node.start),
    message: diagnosticMessageFor(match, transition, history),
    rule: RULE_NAME,
    severity: 'error',
  };
};

const provenanceDiagnostics = (
  context: ProjectContext
): readonly WardenDiagnostic[] => {
  const historyIssues = context.governedVocabularyHistoryIssues ?? [];
  const invalidTransitionIds = new Set(
    historyIssues.flatMap((issue) =>
      issue.transitionId === undefined ? [] : [issue.transitionId]
    )
  );
  const issues = historyIssues.map((issue) => ({
    filePath: issue.path,
    line: 1,
    message: issue.message,
    rule: RULE_NAME,
    severity: 'error' as const,
  }));
  const missing = listGovernedVocabularyTransitions()
    .filter(
      (transition) =>
        context.governedVocabularyHistoryRequired === true &&
        transition.status === 'complete' &&
        transition.provenance.mode === 'regrade-history' &&
        !invalidTransitionIds.has(transition.id) &&
        !context.governedVocabularyHistoryByTransitionId?.has(transition.id)
    )
    .map((transition) => ({
      filePath: '<governed-vocabulary-history>',
      line: 1,
      message: `Governed transition '${transition.id}' is complete but has no valid committed Regrade history provenance. Run Regrade as the primary migration path before manual review or cleanup.`,
      rule: RULE_NAME,
      severity: 'error' as const,
    }));
  return [...issues, ...missing];
};

const checkSource = (
  sourceCode: string,
  filePath: string,
  projectContext?: ProjectContext
): readonly WardenDiagnostic[] => {
  if (isAllowedSourcePath(filePath)) {
    return [];
  }

  const renames = activeSymbolRenames(projectContext);
  if (renames.length === 0) {
    return [];
  }

  const parsed = parseWithDiagnostics(filePath, sourceCode);
  if (!parsed.ast || parsed.diagnostics.length > 0) {
    return [];
  }

  const shorthandIdentifiers = new Set<string>();
  walkWithScopeContext(parsed.ast, (node, astContext) => {
    if (!isShorthandPropertyKeyVisit(node, astContext)) {
      return;
    }
    const name = identifierName(node);
    if (name !== null) {
      shorthandIdentifiers.add(name);
    }
  });

  const diagnostics: WardenDiagnostic[] = [];
  walkWithScopeContext(parsed.ast, (node, astContext) => {
    if (isDuplicateShorthandValueVisit(node, astContext)) {
      return;
    }

    const activeMatch = renames
      .map(({ history, rename, targetSegments, transition }) => ({
        history,
        match: resolveSymbolRenameMatch(node, sourceCode, rename),
        targetSegments,
        transition,
      }))
      .find((candidate) => candidate.match !== null);
    if (activeMatch === undefined || activeMatch.match === null) {
      return;
    }
    const { history, match, targetSegments, transition } = activeMatch;

    diagnostics.push(
      diagnosticFor(
        sourceCode,
        filePath,
        node,
        match,
        reviewReasonFor(
          astContext,
          match,
          shorthandIdentifiers,
          targetSegments
        ),
        transition,
        history
      )
    );
  });

  return diagnostics;
};

export const governedSymbolResidue: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return checkSource(sourceCode, filePath);
  },
  checkProject(context: ProjectContext): readonly WardenDiagnostic[] {
    return provenanceDiagnostics(context);
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    return checkSource(sourceCode, filePath, context);
  },
  description:
    'Require committed Regrade provenance for governed transitions and detect retired symbols that remain or return.',
  name: RULE_NAME,
  severity: 'error',
};
