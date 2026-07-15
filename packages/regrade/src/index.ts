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
  deriveFileRenameCandidates,
  runFileRenameRegrade,
} from './downstream/file-renames.js';
export type {
  FileRenameCandidate,
  FileRenameRegradeRun,
} from './downstream/file-renames.js';
export {
  cliAliasesExportRestructureClass,
  createWardenExportRestructureClass,
  exportRestructureClasses,
  loadWardenRegradeClasses,
  mcpTrailheadsExportRestructureClass,
} from './downstream/export-restructure.js';
export {
  VOCABULARY_TRANSITION_RECORD_SCHEMA_VERSION,
  buildVocabularyTransitionRecord,
  deriveVocabularyFormProposals,
  readVocabularyTransitionRecord,
  runVocabularyRegrade,
  transitionRecordReportWithSummary,
  vocabularyDispositionValues,
  vocabularyRegradePlanSchema,
  vocabularyRegradeRunOutput,
  vocabularyTransitionRecordPath,
  vocabularyTransitionRecordSchema,
  writeVocabularyTransitionRecord,
} from './downstream/vocabulary.js';
export {
  listVocabularyRegradePlansFromRegistry,
  listVocabularyRegradeAuditPlansFromRegistry,
  vocabularyRegradePlanFromTransition,
  vocabularyRegradePlanForInput,
  vocabularyRegradeTransitionForInput,
} from './downstream/vocabulary-registry.js';
export type {
  RegradeApplySummary,
  RegradeClass,
  RegradeClassContext,
  RegradeClassResult,
  RegradeReport,
  RegradeReportEntry,
  RegradeReportEntrySelection,
  RegradeReviewDetail,
  RegradeReviewJudgment,
  RegradeReviewSpan,
  RegradeScanTargets,
  RegradeSelection,
  RegradeWardenClassSet,
} from './downstream/report.js';
export type {
  RegradeScanDirectoryBucket,
  RegradeScanExtensionBucket,
  RegradeScanSummary,
} from './downstream/scan-summary.js';
export type {
  VocabularyDisposition,
  VocabularyFileRename,
  VocabularyFileRenameEvidence,
  VocabularyFormProposal,
  VocabularyOccurrence,
  VocabularyPreserveInventoryEntry,
  VocabularyPreserveRule,
  VocabularyRegradePlan,
  VocabularyRegradeScope,
  VocabularyRegradeRun,
  VocabularyScopePolicy,
  VocabularyScopeTier,
  VocabularyRunGate,
  VocabularyRunLedger,
  VocabularyRunReport,
  VocabularyTransitionRecord,
  VocabularyTransitionRecordEnvironment,
  VocabularyTransitionRecordSummary,
  VocabularyVerdict,
} from './downstream/vocabulary.js';
export {
  createAstIdentifierRenameClass,
  createAstRewriteClass,
  createGovernedAstIdentifierRenameClasses,
} from './downstream/ast-rewrite.js';
export type {
  AstIdentifierRenameClassOptions,
  AstRewriteClassOptions,
  AstRewriteContext,
  AstRewriteMatch,
  AstRewriteVisitResult,
} from './downstream/ast-rewrite.js';
