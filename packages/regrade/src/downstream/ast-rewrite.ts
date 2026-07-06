import type {
  AstNode,
  AstScopeContext,
  SourceEdit,
} from '@ontrails/warden/ast';
import {
  applySourceEdits,
  createSourceEdit,
  getStringValue,
  identifierName,
  isStringLiteral,
  offsetToLineColumn,
  parseWithDiagnostics,
  validateSourceEdits,
  walkWithScopeContext,
} from '@ontrails/warden/ast';
import type { GovernedVocabularyTransition } from '@ontrails/warden';

import type {
  RegradeClass,
  RegradeClassContext,
  RegradeClassResult,
  RegradeReviewDetail,
} from './report.js';

export interface AstRewriteContext extends AstScopeContext {
  readonly path: string;
  readonly source: string;
}

export type AstRewriteMatch =
  | {
      readonly edit: SourceEdit;
      readonly kind: 'edit';
      readonly note?: string;
    }
  | {
      readonly detail?: RegradeReviewDetail;
      readonly kind: 'review';
      readonly note?: string;
      readonly reason: string;
    };

export type AstRewriteVisitResult =
  | AstRewriteMatch
  | AstRewriteMatch[]
  | null
  | undefined;

export interface AstRewriteClassOptions {
  readonly describe: string;
  readonly id: string;
  readonly shouldScan?: (context: RegradeClassContext) => boolean;
  readonly visit: (
    node: AstNode,
    context: AstRewriteContext
  ) => AstRewriteVisitResult;
}

const defaultRegradeClassContext: RegradeClassContext = {
  path: '<regrade-source>',
};

const toArray = (result: AstRewriteVisitResult): readonly AstRewriteMatch[] => {
  if (result === undefined || result === null) {
    return [];
  }
  return Array.isArray(result) ? result : [result];
};

const dedupeEdits = (edits: readonly SourceEdit[]): readonly SourceEdit[] => {
  const seen = new Set<string>();
  const unique: SourceEdit[] = [];

  for (const edit of edits) {
    const key = `${edit.start}:${edit.end}:${edit.replacement}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(edit);
  }

  return unique;
};

const notesFor = (matches: readonly AstRewriteMatch[]): readonly string[] =>
  matches.flatMap((match) => {
    if (match.note) {
      return [match.note];
    }
    if (match.kind === 'review') {
      return [match.reason];
    }
    return [];
  });

const invalidEditsResult = (error: unknown): RegradeClassResult => ({
  kind: 'needs-review',
  notes: [
    error instanceof Error
      ? `AST rewrite edits could not be applied: ${error.message}`
      : 'AST rewrite edits could not be applied.',
  ],
  reason: 'ast-rewrite-invalid-edits',
});

const astRewriteFailureResult = (
  context: RegradeClassContext,
  reason: string,
  error: unknown
): RegradeClassResult => ({
  kind: 'needs-review',
  notes: [
    error instanceof Error
      ? `AST rewrite failed for ${context.path}: ${error.message}`
      : `AST rewrite failed for ${context.path}.`,
  ],
  reason,
});

const reviewDetailsFor = (
  classId: string,
  matches: readonly AstRewriteMatch[]
): readonly RegradeReviewDetail[] | undefined => {
  const details = matches.flatMap((match) => {
    if (match.kind !== 'review' || match.detail === undefined) {
      return [];
    }
    return [{ ...match.detail, classId: match.detail.classId ?? classId }];
  });
  return details.length === 0 ? undefined : details;
};

export const createAstRewriteClass = (
  options: AstRewriteClassOptions
): RegradeClass => ({
  apply: (
    source: string,
    context: RegradeClassContext = defaultRegradeClassContext
  ): RegradeClassResult => {
    if (options.shouldScan) {
      try {
        if (!options.shouldScan(context)) {
          return {
            kind: 'skipped',
            notes: ['Skipped by AST rewrite scan-target filtering.'],
            reason: 'ast-rewrite-scan-target-filtered',
          };
        }
      } catch (error: unknown) {
        return astRewriteFailureResult(
          context,
          'ast-rewrite-scan-target-failed',
          error
        );
      }
    }

    const parsed = parseWithDiagnostics(context.path, source);
    if (!parsed.ast || parsed.diagnostics.length > 0) {
      return {
        kind: 'needs-review',
        notes:
          parsed.diagnostics.length > 0
            ? parsed.diagnostics.map(
                (diagnostic) =>
                  `Could not safely parse ${context.path}: ${diagnostic.message}`
              )
            : [`Could not parse ${context.path} for AST rewrite.`],
        reason: 'ast-rewrite-parse-failed',
      };
    }

    const matches: AstRewriteMatch[] = [];
    try {
      walkWithScopeContext(parsed.ast, (node, scopeContext) => {
        matches.push(
          ...toArray(
            options.visit(node, {
              ...scopeContext,
              path: context.path,
              source,
            })
          )
        );
      });
    } catch (error: unknown) {
      return astRewriteFailureResult(
        context,
        'ast-rewrite-visitor-failed',
        error
      );
    }

    const reviewMatches = matches.filter((match) => match.kind === 'review');
    if (reviewMatches.length > 0) {
      const reviewDetails = reviewDetailsFor(options.id, reviewMatches);
      return {
        kind: 'needs-review',
        notes: notesFor(reviewMatches),
        reason: reviewMatches[0]?.reason ?? 'ast-rewrite-review-required',
        ...(reviewDetails === undefined ? {} : { reviewDetails }),
      };
    }

    const edits = dedupeEdits(
      matches.flatMap((match) => (match.kind === 'edit' ? [match.edit] : []))
    );
    if (edits.length === 0) {
      return {
        kind: 'no-op',
        notes: ['No AST rewrite matches found.'],
      };
    }

    try {
      validateSourceEdits(edits);
      return {
        kind: 'rewrite',
        nextSource: applySourceEdits(source, edits),
        notes: notesFor(matches),
      };
    } catch (error) {
      return invalidEditsResult(error);
    }
  },
  describe: options.describe,
  id: options.id,
});

export interface AstIdentifierRenameClassOptions {
  readonly describe?: string;
  readonly from: string;
  readonly id?: string;
  readonly reviewDeclarationTypes?: ReadonlySet<string>;
  readonly shouldPreserve?: (
    occurrence: AstIdentifierRenameOccurrence
  ) => boolean;
  readonly to: string;
}

export interface AstIdentifierRenameOccurrence {
  readonly end: number;
  readonly from: string;
  readonly path: string;
  readonly source: string;
  readonly start: number;
  readonly to: string;
}

export interface AstStringLiteralRenameClassOptions {
  readonly describe?: string;
  readonly from: string;
  readonly id?: string;
  readonly shouldPreserve?: (
    occurrence: AstIdentifierRenameOccurrence
  ) => boolean;
  readonly to: string;
}

const isIdentifierNamed = (node: AstNode, name: string): boolean =>
  node.type === 'Identifier' && identifierName(node) === name;

const identifierTokenSpan = (
  node: AstNode,
  source: string,
  name: string
): { readonly end: number; readonly start: number } | null => {
  const end = node.start + name.length;
  return source.slice(node.start, end) === name
    ? { end, start: node.start }
    : null;
};

export const createAstIdentifierRenameClass = (
  options: AstIdentifierRenameClassOptions
): RegradeClass => {
  const reviewDeclarationTypes =
    options.reviewDeclarationTypes ?? new Set<string>();

  return createAstRewriteClass({
    describe:
      options.describe ??
      `Rename identifier "${options.from}" to "${options.to}".`,
    id: options.id ?? `ast-identifier-rename:${options.from}->${options.to}`,
    visit: (node, context) => {
      if (!isIdentifierNamed(node, options.from)) {
        return null;
      }

      const span = identifierTokenSpan(node, context.source, options.from);
      if (span === null) {
        const location = offsetToLineColumn(context.source, node.start);
        const caution = `Identifier "${options.from}" token span could not be verified; routed to review.`;
        return {
          detail: {
            candidateReplacement: options.to,
            expectedTarget: `Rename identifier "${options.from}" to "${options.to}".`,
            judgment: 'unresolved',
            matchedForm: options.from,
            nodeKind: node.type,
            preserveCautions: [caution],
            reason: 'ast-identifier-token-span-unverified',
            signals: ['ast:identifier-rename'],
            span: {
              column: location.column,
              end: node.end,
              line: location.line,
              start: node.start,
            },
            suggestedValidation: 'bun run typecheck',
            symbol: options.from,
          },
          kind: 'review',
          note: caution,
          reason: 'ast-identifier-token-span-unverified',
        };
      }

      if (
        options.shouldPreserve?.({
          end: span.end,
          from: options.from,
          path: context.path,
          source: context.source,
          start: span.start,
          to: options.to,
        }) === true
      ) {
        return null;
      }

      const declaration = context.getDeclaration(options.from);
      if (declaration && reviewDeclarationTypes.has(declaration.type)) {
        const location = offsetToLineColumn(context.source, span.start);
        const caution = `Identifier "${options.from}" resolves to ${declaration.type}; routed to review.`;
        return {
          detail: {
            candidateReplacement: options.to,
            expectedTarget: `Rename identifier "${options.from}" to "${options.to}".`,
            judgment: 'unresolved',
            matchedForm: options.from,
            nodeKind: node.type,
            preserveCautions: [caution],
            reason: 'ast-identifier-review-declaration',
            signals: ['ast:identifier-rename'],
            span: {
              column: location.column,
              end: span.end,
              line: location.line,
              start: span.start,
            },
            suggestedValidation: 'bun run typecheck',
            symbol: options.from,
          },
          kind: 'review',
          note: caution,
          reason: 'ast-identifier-review-declaration',
        };
      }

      return {
        edit: createSourceEdit(span.start, span.end, options.to),
        kind: 'edit',
        note: `Renamed identifier "${options.from}" to "${options.to}".`,
      };
    },
  });
};

const stringLiteralValueSpan = (
  node: AstNode,
  source: string,
  value: string
): { readonly end: number; readonly start: number } | null => {
  const raw = source.slice(node.start, node.end);
  const relativeStart = raw.indexOf(value);
  if (relativeStart === -1 || raw.includes(value, relativeStart + 1)) {
    return null;
  }
  const start = node.start + relativeStart;
  return { end: start + value.length, start };
};

export const createAstStringLiteralRenameClass = (
  options: AstStringLiteralRenameClassOptions
): RegradeClass =>
  createAstRewriteClass({
    describe:
      options.describe ??
      `Rename string literal "${options.from}" to "${options.to}".`,
    id:
      options.id ?? `ast-string-literal-rename:${options.from}->${options.to}`,
    visit: (node, context) => {
      if (!isStringLiteral(node) || getStringValue(node) !== options.from) {
        return null;
      }

      const span = stringLiteralValueSpan(node, context.source, options.from);
      if (span === null) {
        const location = offsetToLineColumn(context.source, node.start);
        const caution = `String literal "${options.from}" token span could not be verified; routed to review.`;
        return {
          detail: {
            candidateReplacement: options.to,
            expectedTarget: `Rename string literal "${options.from}" to "${options.to}".`,
            judgment: 'unresolved',
            matchedForm: options.from,
            nodeKind: node.type,
            preserveCautions: [caution],
            reason: 'ast-string-literal-token-span-unverified',
            signals: ['ast:string-literal-rename'],
            span: {
              column: location.column,
              end: node.end,
              line: location.line,
              start: node.start,
            },
            suggestedValidation: 'bun run typecheck',
            symbol: options.from,
          },
          kind: 'review',
          note: caution,
          reason: 'ast-string-literal-token-span-unverified',
        };
      }

      if (
        options.shouldPreserve?.({
          end: span.end,
          from: options.from,
          path: context.path,
          source: context.source,
          start: span.start,
          to: options.to,
        }) === true
      ) {
        return null;
      }

      return {
        edit: createSourceEdit(span.start, span.end, options.to),
        kind: 'edit',
        note: `Renamed string literal "${options.from}" to "${options.to}".`,
      };
    },
  });

export const createGovernedAstIdentifierRenameClasses = (
  transition: GovernedVocabularyTransition,
  options: {
    readonly shouldPreserve?: (
      occurrence: AstIdentifierRenameOccurrence
    ) => boolean;
  } = {}
): readonly RegradeClass[] => [
  ...transition.symbolRenames.map((rename) =>
    createAstIdentifierRenameClass({
      describe: `Rename governed symbol "${rename.from}" to "${rename.to}" for ${transition.id}.`,
      from: rename.from,
      id: `ast-symbol-rename:${transition.id}:${rename.from}->${rename.to}`,
      reviewDeclarationTypes: new Set(rename.reviewDeclarationTypes),
      ...(options.shouldPreserve === undefined
        ? {}
        : { shouldPreserve: options.shouldPreserve }),
      to: rename.to,
    })
  ),
  ...transition.stringLiteralRenames.map((rename) =>
    createAstStringLiteralRenameClass({
      describe: `Rename governed string literal "${rename.from}" to "${rename.to}" for ${transition.id}.`,
      from: rename.from,
      id: `ast-string-literal-rename:${transition.id}:${rename.from}->${rename.to}`,
      ...(options.shouldPreserve === undefined
        ? {}
        : { shouldPreserve: options.shouldPreserve }),
      to: rename.to,
    })
  ),
];
