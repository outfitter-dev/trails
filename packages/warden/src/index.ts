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
  WardenGuidance,
  WardenGuidanceLink,
  WardenRule,
  WardenRuleConcern,
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
  wardenRuleConcerns,
  wardenRuleLifecycleStates,
  wardenRuleScopes,
  wardenRuleTiers,
  wardenRules,
  wardenTopoRules,
} from './rules/index.js';

// Rule-scoped cache controls for long-lived consumers (watch mode, LSPs).
export { clearImplementationReturnsResultCache } from './rules/implementation-returns-result.js';

// CLI runner
export type {
  WardenOptions,
  WardenReport,
  WardenRunOptions,
  WardenTopoTarget,
} from './cli.js';
export { formatWardenReport, runWarden } from './cli.js';

// CLI command surface
export type {
  ParsedWardenCommand,
  RunWardenCommandOptions,
  WardenCommandResult,
} from './command.js';
export {
  formatWardenCommandOutput,
  loadWardenConfig,
  parseWardenCommandArgs,
  resolveWardenTopoTargets,
  runWardenCommand,
} from './command.js';

// Config schema
export {
  wardenConfigSchema,
  wardenDepthValues,
  wardenDraftsValues,
  wardenFailOnValues,
  wardenFormatValues,
  wardenLockValues,
} from './config.js';
export type {
  WardenConfig,
  WardenConfigInput,
  WardenDepth,
  WardenDraftsMode,
  WardenFailOn,
  WardenFormat,
  WardenLockMode,
  EffectiveWardenConfig,
  ResolveWardenConfigOptions,
  WardenConfigLayer,
  WardenConfigResolution,
} from './config.js';
export { resolveWardenConfig } from './config.js';

// CI formatters
export {
  formatGitHubAnnotations,
  formatJson,
  formatSummary,
} from './formatters.js';

// Drift detection
export type { DriftResult } from './drift.js';
export { checkDrift } from './drift.js';

// Resolver helpers
export {
  collectImportResolutionsForFile,
  collectImportSpecifiers,
  createWardenResolver,
  defaultWardenResolveOptions,
} from './resolve.js';
export type {
  WardenImportResolution,
  WardenImportResolutionErrorKind,
  WardenImportSpecifier,
  WardenProjectResolver,
  WardenResolverOptions,
} from './resolve.js';

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
  activationOrphanTrail,
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
  layerFieldNameDriftTrail,
  missingVisibilityTrail,
  missingReconcileTrail,
  noDevPermitInSourceTrail,
  noDirectImplementationCallTrail,
  noLegacyLayerImportsTrail,
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
  publicOutputSchemaTrail,
  publicUnionOutputDiscriminantsTrail,
  readIntentFiresTrail,
  referenceExistsTrail,
  resolvedImportBoundaryTrail,
  ruleInput,
  ruleOutput,
  resourceDeclarationsTrail,
  resourceIdGrammarTrail,
  resourceExistsTrail,
  scheduledDestroyIntentTrail,
  signalGraphCoachingTrail,
  unmaterializedActivationSourceTrail,
  topoAwareRuleInput,
  unreachableDetourShadowingTrail,
  validDetourContractTrail,
  validDescribeRefsTrail,
  wardenExportSymmetryTrail,
  wardenRulesUseAstTrail,
  webhookRouteCollisionTrail,
  wrapRule,
  wrapTopoRule,
} from './trails/index.js';
export type {
  ProjectAwareRuleInput,
  RuleInput,
  RuleOutput,
  TopoAwareRuleInput,
} from './trails/index.js';
