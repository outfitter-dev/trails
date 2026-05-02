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
  BuiltinWardenRuleName,
  ProjectAwareWardenRule,
  ProjectContext,
  TopoAwareWardenRule,
  WardenDiagnostic,
  WardenRule,
  WardenRuleLifecycle,
  WardenRuleLifecycleState,
  WardenRuleMetadata,
  WardenRuleScope,
  WardenRuleTier,
  WardenSeverity,
} from './rules/index.js';

// Rule registry
export {
  builtinWardenRuleMetadata,
  getWardenRuleMetadata,
  listWardenRuleMetadata,
  wardenRuleLifecycleStates,
  wardenRuleScopes,
  wardenRuleTiers,
  wardenRules,
  wardenTopoRules,
} from './rules/index.js';

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
  noDirectImplementationCallTrail,
  noNativeErrorResultTrail,
  noSyncResultAssumptionTrail,
  noThrowInDetourRecoverTrail,
  noThrowInImplementationTrail,
  onReferencesExistTrail,
  orphanedSignalTrail,
  ownerProjectionParityTrail,
  permitGovernanceTrail,
  preferSchemaInferenceTrail,
  projectAwareRuleInput,
  publicInternalDeepImportsTrail,
  publicUnionOutputDiscriminantsTrail,
  readIntentFiresTrail,
  referenceExistsTrail,
  ruleInput,
  ruleOutput,
  resourceDeclarationsTrail,
  resourceIdGrammarTrail,
  resourceExistsTrail,
  topoAwareRuleInput,
  unreachableDetourShadowingTrail,
  validDetourContractTrail,
  validDescribeRefsTrail,
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
