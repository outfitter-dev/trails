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
  WardenFix,
  WardenFixCapability,
  WardenFixClass,
  WardenFixEdit,
  WardenFixSafety,
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
  wardenFixClasses,
  wardenFixSafeties,
  wardenRuleConcerns,
  wardenRuleLifecycleStates,
  wardenRuleScopes,
  wardenRuleTiers,
  wardenRules,
  wardenTopoRules,
} from './rules/index.js';

// Rule-scoped cache controls for long-lived consumers (watch mode, LSPs).
export { clearImplementationReturnsResultCache } from './rules/implementation-returns-result.js';
export {
  isWardenDevPermitTestScanTarget,
  isWardenInfrastructureScanTarget,
  isWardenSourceScanTarget,
  isWardenTestScanTarget,
} from './rules/scan.js';

// CLI runner
export type {
  WardenOptions,
  WardenReport,
  WardenRunOptions,
  WardenTopoTarget,
} from './cli.js';
export { formatWardenReport, runWarden } from './cli.js';

// Adapter authoring checks
export {
  adapterCheckRuleName,
  runWardenAdapterChecks,
} from './adapter-check.js';

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

// Guide projection
export type {
  WardenGuideFormat,
  WardenGuideManifest,
  WardenRuleGuideEntry,
} from './guide.js';
export {
  buildWardenAgentGuide,
  buildWardenGuideManifest,
  formatWardenGuide,
  formatWardenGuideMarkdown,
  wardenGuideFormatValues,
} from './guide.js';

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
  composesDeclarationsTrail,
  deadInternalTrailTrail,
  deprecationWithoutGuidanceTrail,
  diagnosticSchema,
  draftFileMarkingTrail,
  draftVisibleDebtTrail,
  errorMappingCompletenessTrail,
  exampleValidTrail,
  firesDeclarationsTrail,
  forkWithoutPreservedBlazeTrail,
  implementationReturnsResultTrail,
  incompleteAccessorForStandardOpTrail,
  incompleteCrudTrail,
  intentPropagationTrail,
  layerFieldNameDriftTrail,
  markerSchemaUnsupportedTrail,
  missingVisibilityTrail,
  missingReconcileTrail,
  noDevPermitInSourceTrail,
  noDestructuredComposeTrail,
  noDirectImplementationCallTrail,
  noLegacyLayerImportsTrail,
  noNativeErrorResultTrail,
  noRedundantResultErrorWrapTrail,
  noRetiredCrossVocabularyTrail,
  noSyncResultAssumptionTrail,
  noThrowInDetourRecoverTrail,
  noThrowInImplementationTrail,
  noTopLevelSurfaceTrail,
  onReferencesExistTrail,
  orphanedSignalTrail,
  ownerProjectionParityTrail,
  pendingForceTrail,
  permitGovernanceTrail,
  preferSchemaInferenceTrail,
  projectAwareRuleInput,
  publicExportExampleCoverageTrail,
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
  resourceMockCoverageTrail,
  scheduledDestroyIntentTrail,
  signalGraphCoachingTrail,
  staticResourceAccessorPreferenceTrail,
  surfaceFacetCoherenceTrail,
  unmaterializedActivationSourceTrail,
  topoAwareRuleInput,
  unreachableDetourShadowingTrail,
  validDetourContractTrail,
  validDescribeRefsTrail,
  versionGapTrail,
  versionPinnedComposeTrail,
  versionWithoutExamplesTrail,
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
