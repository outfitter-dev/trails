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
  VocabularyOccurrenceSourceKind,
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

/**
 * Compact, canonical evidence for an applied Regrade run.
 *
 * @example
 * ```ts
 * const serialized = serializeRegradeHistoryReceipt(receipt);
 * if (serialized.isErr()) throw serialized.error;
 * ```
 */
export {
  REGRADE_HISTORY_RECEIPT_SCHEMA_VERSION,
  canonicalRegradeJson,
  regradeClassifiedStateHash,
  regradeFormJudgmentSchema,
  regradeHistoryReceiptSchema,
  regradeReceiptContentHash,
  regradeReceiptPlanContentHash,
  regradeReceiptPlanSchema,
  resolveRegradeHistoryReceipt,
  serializeRegradeHistoryReceipt,
} from './history-receipt.js';
/**
 * Type the authored and resolved sides of compact Regrade history.
 *
 * @example
 * ```ts
 * const receipt: RegradeHistoryReceipt = parsed;
 * ```
 */
export type {
  RegradeFormJudgment,
  RegradeHistoryReceipt,
  RegradeReceiptPlan,
  RegradeReceiptPlanProvenance,
  ResolvedRegradeHistoryReceipt,
  ResolvedRegradeHistoryReceiptRun,
} from './history-receipt.js';
