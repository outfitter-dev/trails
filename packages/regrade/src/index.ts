// Root package surface for `@ontrails/regrade`.
export {
  literalRegradeTopo,
  literalRegradeTrail,
} from './literal-transform.js';
export {
  buildRegradeReport,
  createTermRewriteClass,
  createWardenTermRewriteClass,
  loadWardenTermRewriteClasses,
  regradeReportOutput,
  runRegrade,
  selectRegradeClasses,
  wardenTermRewriteClasses,
} from './downstream/report.js';
export {
  runVocabularyRegrade,
  vocabularyRegradePlanSchema,
  vocabularyRegradeRunOutput,
} from './downstream/vocabulary.js';
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
  RegradeWardenClassSet,
} from './downstream/report.js';
export type {
  VocabularyOccurrence,
  VocabularyPreserveRule,
  VocabularyRegradePlan,
  VocabularyRegradeScope,
  VocabularyRegradeRun,
  VocabularyRunGate,
  VocabularyRunLedger,
  VocabularyRunReport,
  VocabularyVerdict,
} from './downstream/vocabulary.js';
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
