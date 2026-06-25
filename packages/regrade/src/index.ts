// Root package surface for `@ontrails/regrade`.
export {
  literalRegradeTopo,
  literalRegradeTrail,
} from './literal-transform.js';
export {
  buildRegradeReport,
  createTermRewriteClass,
  createWardenTermRewriteClass,
  regradeReportOutput,
  runRegrade,
  selectRegradeClasses,
  wardenTermRewriteClasses,
} from './downstream/report.js';
export type {
  RegradeApplySummary,
  RegradeClass,
  RegradeClassContext,
  RegradeClassResult,
  RegradeReport,
  RegradeReportEntry,
  RegradeReportEntrySelection,
  RegradeReviewDetail,
  RegradeReviewSpan,
  RegradeScanTargets,
  RegradeSelection,
} from './downstream/report.js';
export {
  createAstIdentifierRenameClass,
  createAstRewriteClass,
} from './downstream/ast-rewrite.js';
export type {
  AstIdentifierRenameClassOptions,
  AstRewriteClassOptions,
  AstRewriteContext,
  AstRewriteMatch,
  AstRewriteVisitResult,
} from './downstream/ast-rewrite.js';
