/**
 * Warden - Governance package for Trails.
 *
 * Provides lint rules, drift detection, and a CLI runner to enforce
 * contract-first discipline at development time.
 *
 * Package: `@ontrails/warden`
 */

// Rule types
export type {
  ProjectAwareWardenRule,
  ProjectContext,
  TopoAwareWardenRule,
  WardenDiagnostic,
  WardenRule,
  WardenSeverity,
} from './rules/index.js';

// Rule registry
export { wardenRules, wardenTopoRules } from './rules/index.js';

// Rule-scoped cache controls for long-lived consumers (watch mode, LSPs).
export { clearImplementationReturnsResultCache } from './rules/implementation-returns-result.js';

// CLI runner
export type { WardenOptions, WardenReport } from './cli.js';
export { formatWardenReport, runWarden } from './cli.js';

// CI formatters
export {
  formatGitHubAnnotations,
  formatJson,
  formatSummary,
} from './formatters.js';

// Drift detection
export type { DriftResult } from './drift.js';
export { checkDrift } from './drift.js';

// Draft helpers
export {
  DRAFT_FILE_PREFIX,
  DRAFT_FILE_SEGMENT,
  isDraftMarkedFile,
  stripDraftFileMarkers,
} from './draft.js';

// AST helpers for repo-local tooling
export {
  findStringLiterals,
  getStringValue,
  isStringLiteral,
  offsetToLine,
  parse,
  walk,
} from './rules/ast.js';
export type { AstNode, StringLiteralMatch } from './rules/ast.js';

// Trail layer
export { wardenTopo } from './trails/topo.js';
export { runTopoAwareWardenTrails, runWardenTrails } from './trails/run.js';
export {
  circularRefsTrail,
  contourExistsTrail,
  contextNoSurfaceTypesTrail,
  crossDeclarationsTrail,
  deadInternalTrailTrail,
  diagnosticSchema,
  draftFileMarkingTrail,
  draftVisibleDebtTrail,
  errorMappingCompletenessTrail,
  exampleValidTrail,
  firesDeclarationsTrail,
  implementationReturnsResultTrail,
  incompleteAccessorForStandardOpTrail,
  incompleteCrudTrail,
  intentPropagationTrail,
  missingVisibilityTrail,
  missingReconcileTrail,
  noDirectImplInRouteTrail,
  noDirectImplementationCallTrail,
  noSyncResultAssumptionTrail,
  noThrowInDetourTargetTrail,
  noThrowInImplementationTrail,
  onReferencesExistTrail,
  orphanedSignalTrail,
  permitGovernanceTrail,
  preferSchemaInferenceTrail,
  projectAwareRuleInput,
  referenceExistsTrail,
  ruleInput,
  ruleOutput,
  resourceDeclarationsTrail,
  resourceIdGrammarTrail,
  resourceExistsTrail,
  topoAwareRuleInput,
  unreachableDetourShadowingTrail,
  validDescribeRefsTrail,
  validDetourRefsTrail,
  wardenExportSymmetryTrail,
  wardenRulesUseAstTrail,
  wrapRule,
  wrapTopoRule,
} from './trails/index.js';
export type {
  ProjectAwareRuleInput,
  RuleInput,
  RuleOutput,
  TopoAwareRuleInput,
} from './trails/index.js';
