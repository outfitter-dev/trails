import type {
  AstNode,
  AstScopeContext,
  SourceEdit,
} from '@ontrails/warden/ast';
import {
  applySourceEdits,
  createSourceEdit,
  identifierName,
  offsetToLineColumn,
  parseWithDiagnostics,
  validateSourceEdits,
  walkWithScopeContext,
} from '@ontrails/warden/ast';

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
    if (options.shouldScan && !options.shouldScan(context)) {
      return {
        kind: 'skipped',
        notes: ['Skipped by AST rewrite scan-target filtering.'],
        reason: 'ast-rewrite-scan-target-filtered',
      };
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
  readonly to: string;
}

const isIdentifierNamed = (node: AstNode, name: string): boolean =>
  node.type === 'Identifier' && identifierName(node) === name;

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

      const declaration = context.getDeclaration(options.from);
      if (declaration && reviewDeclarationTypes.has(declaration.type)) {
        const location = offsetToLineColumn(context.source, node.start);
        return {
          detail: {
            expectedTarget: `Rename identifier "${options.from}" to "${options.to}".`,
            nodeKind: node.type,
            reason: 'ast-identifier-review-declaration',
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
          note: `Identifier "${options.from}" resolves to ${declaration.type}; routed to review.`,
          reason: 'ast-identifier-review-declaration',
        };
      }

      return {
        edit: createSourceEdit(node.start, node.end, options.to),
        kind: 'edit',
        note: `Renamed identifier "${options.from}" to "${options.to}".`,
      };
    },
  });
};
