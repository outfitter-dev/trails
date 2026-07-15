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
  GovernedVocabularyHistoryEvidence,
  GovernedVocabularyHistoryFormObservation,
  GovernedVocabularyHistoryIssue,
  ProjectAwareWardenRule,
  ProjectContext,
  TopoAwareWardenRule,
  WardenDiagnostic,
  WardenExportedSymbolDefinition,
  WardenFix,
  WardenFixCapability,
  WardenFixClass,
  WardenFixEdit,
  WardenFixScanTargets,
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
  formatGovernedVocabularyTransitionGuide,
  getGovernedVocabularyTransition,
  governedVocabularyLiteralRenameSchema,
  governedVocabularyFileRenameSchema,
  governedVocabularyHistoryProvenanceSchema,
  governedVocabularyPreserveRuleSchema,
  governedVocabularyProvenancePolicySchema,
  governedVocabularyRegistrySchema,
  governedVocabularyScopeSchema,
  governedVocabularySymbolRenameSchema,
  governedVocabularyTargetSchema,
  governedVocabularyTransitionSchema,
  governedVocabularyTransitionStatuses,
  governedVocabularyTransitions,
  getWardenRuleMetadata,
  listWardenRuleMetadata,
  listGovernedVocabularyTransitions,
  requireGovernedVocabularyTransition,
  wardenFixClasses,
  wardenFixSafeties,
  wardenRuleConcerns,
  wardenRuleLifecycleStates,
  wardenRuleScopes,
  wardenRuleTiers,
  wardenRules,
  wardenTopoRules,
} from './rules/index.js';
export type {
  GovernedVocabularyLiteralRename,
  GovernedVocabularyHistoryProvenance,
  GovernedVocabularyPreserveRule,
  GovernedVocabularyProvenancePolicy,
  GovernedVocabularyScope,
  GovernedVocabularySymbolRename,
  GovernedVocabularyTarget,
  GovernedVocabularyTransition,
  GovernedVocabularyTransitionInput,
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
  WardenScope,
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
export type { CheckDriftOptions, DriftResult } from './drift.js';
export { checkDrift } from './drift.js';

// Project-local rule loading
export type { ProjectWardenRules } from './project-rules.js';
export { loadProjectWardenRules } from './project-rules.js';

// Guide rendering
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
export {
  runProjectWardenRules,
  runTopoAwareWardenTrails,
  runWardenTrails,
} from './trails/run.js';
export {
  activationOrphanTrail,
  capturedKernelTrail,
  cliCommandRouteCoherenceTrail,
  circularRefsTrail,
  entityExistsTrail,
  contextNoSurfaceTypesTrail,
  composesDeclarationsTrail,
  deadInternalTrailTrail,
  deadPublicTrailTrail,
  deprecationWithoutGuidanceTrail,
  diagnosticSchema,
  duplicateExportedSymbolTrail,
  duplicatePublicContractTrail,
  draftFileMarkingTrail,
  draftVisibleDebtTrail,
  errorMappingCompletenessTrail,
  exampleValidTrail,
  firesDeclarationsTrail,
  forkWithoutPreservedImplementationTrail,
  governedSymbolResidueTrail,
  governedVocabularyPermutationWatchTrail,
  implementationReturnsResultTrail,
  incompleteAccessorForStandardOpTrail,
  incompleteCrudTrail,
  intentPropagationTrail,
  layerFieldNameDriftTrail,
  libraryRenderCoherenceTrail,
  markerSchemaUnsupportedTrail,
  missingVisibilityTrail,
  missingReconcileTrail,
  noDevPermitInSourceTrail,
  noDestructuredComposeTrail,
  noDirectImplementationCallTrail,
  noLegacyCliAliasExportTrail,
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
  ownerRenderParityTrail,
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
  surfaceOverlayCoherenceTrail,
  surfaceTrailheadCoherenceTrail,
  trailForkCoachingTrail,
  trailheadOverrideDivergenceTrail,
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
