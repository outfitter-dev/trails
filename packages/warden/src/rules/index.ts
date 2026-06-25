import { activationOrphan } from './activation-orphan.js';
import { cliCommandRouteCoherence } from './cli-command-route-coherence.js';
import { circularRefs } from './circular-refs.js';
import { contourExists } from './contour-exists.js';
import { contextNoSurfaceTypes } from './context-no-surface-types.js';
import { composesDeclarations } from './composes-declarations.js';
import { deadInternalTrail } from './dead-internal-trail.js';
import { deadPublicTrail } from './dead-public-trail.js';
import { draftFileMarking } from './draft-file-marking.js';
import { draftVisibleDebt } from './draft-visible-debt.js';
import { duplicatePublicContract } from './duplicate-public-contract.js';
import { errorMappingCompleteness } from './error-mapping-completeness.js';
import { exampleValid } from './example-valid.js';
import { firesDeclarations } from './fires-declarations.js';
import { implementationReturnsResult } from './implementation-returns-result.js';
import { incompleteAccessorForStandardOp } from './incomplete-accessor-for-standard-op.js';
import { incompleteCrud } from './incomplete-crud.js';
import { intentPropagation } from './intent-propagation.js';
import { layerFieldNameDrift } from './layer-field-name-drift.js';
import { libraryProjectionCoherence } from './library-projection-coherence.js';
import { missingVisibility } from './missing-visibility.js';
import { missingReconcile } from './missing-reconcile.js';
import { noDevPermitInSource } from './no-dev-permit-in-source.js';
import { noDestructuredCompose } from './no-destructured-compose.js';
import { noLegacyLayerImports } from './no-legacy-layer-imports.js';
import { noDirectImplementationCall } from './no-direct-implementation-call.js';
import { noNativeErrorResult } from './no-native-error-result.js';
import { noRedundantResultErrorWrap } from './no-redundant-result-error-wrap.js';
import { noRetiredCrossVocabulary } from './no-retired-cross-vocabulary.js';
import { noSyncResultAssumption } from './no-sync-result-assumption.js';
import { noThrowInDetourRecover } from './no-throw-in-detour-recover.js';
import { noThrowInImplementation } from './no-throw-in-implementation.js';
import { noTopLevelSurface } from './no-top-level-surface.js';
import { onReferencesExist } from './on-references-exist.js';
import { orphanedSignal } from './orphaned-signal.js';
import { ownerProjectionParity } from './owner-projection-parity.js';
import { permitGovernance } from './permit-governance.js';
import { preferSchemaInference } from './prefer-schema-inference.js';
import { publicExportExampleCoverage } from './public-export-example-coverage.js';
import { publicInternalDeepImports } from './public-internal-deep-imports.js';
import { publicOutputSchema } from './public-output-schema.js';
import { publicUnionOutputDiscriminants } from './public-union-output-discriminants.js';
import { readIntentFires } from './read-intent-fires.js';
import { referenceExists } from './reference-exists.js';
import { resolvedImportBoundary } from './resolved-import-boundary.js';
import { resourceDeclarations } from './resource-declarations.js';
import { resourceExists } from './resource-exists.js';
import { resourceIdGrammar } from './resource-id-grammar.js';
import { resourceMockCoverage } from './resource-mock-coverage.js';
import { scheduledDestroyIntent } from './scheduled-destroy-intent.js';
import { signalGraphCoaching } from './signal-graph-coaching.js';
import { staticResourceAccessorPreference } from './static-resource-accessor-preference.js';
import { surfaceFacetCoherence } from './surface-facet-coherence.js';
import { trailForkCoaching } from './trail-fork-coaching.js';
import {
  forkWithoutPreservedBlaze,
  markerSchemaUnsupported,
  versionPinnedCompose,
} from './trail-versioning-source.js';
import {
  deprecationWithoutGuidance,
  pendingForce,
  versionGap,
  versionWithoutExamples,
} from './trail-versioning-topo.js';
import type { TopoAwareWardenRule, WardenRule } from './types.js';
import { unmaterializedActivationSource } from './unmaterialized-activation-source.js';
import { unreachableDetourShadowing } from './unreachable-detour-shadowing.js';
import { validDetourContract } from './valid-detour-contract.js';
import { validDescribeRefs } from './valid-describe-refs.js';
import { wardenExportSymmetry } from './warden-export-symmetry.js';
import { wardenRulesUseAst } from './warden-rules-use-ast.js';
import { webhookRouteCollision } from './webhook-route-collision.js';

export type {
  WardenFix,
  WardenFixCapability,
  WardenFixClass,
  WardenFixEdit,
  WardenFixScanTargets,
  WardenFixSafety,
  WardenGuidance,
  WardenGuidanceLink,
  WardenRuleLifecycle,
  WardenRuleLifecycleState,
  WardenRuleConcern,
  WardenRuleMetadata,
  WardenRuleScope,
  ProjectAwareWardenRule,
  ProjectContext,
  TopoAwareWardenRule,
  WardenDiagnostic,
  WardenRule,
  WardenRuleTier,
  WardenSeverity,
} from './types.js';

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
} from './metadata.js';
export type { BuiltinWardenRuleName } from './metadata.js';

export { activationOrphan } from './activation-orphan.js';
export { cliCommandRouteCoherence } from './cli-command-route-coherence.js';
export { noThrowInImplementation } from './no-throw-in-implementation.js';
export { circularRefs } from './circular-refs.js';
export { contourExists } from './contour-exists.js';
export { contextNoSurfaceTypes } from './context-no-surface-types.js';
export { composesDeclarations } from './composes-declarations.js';
export { deadInternalTrail } from './dead-internal-trail.js';
export { deadPublicTrail } from './dead-public-trail.js';
export { draftFileMarking } from './draft-file-marking.js';
export { draftVisibleDebt } from './draft-visible-debt.js';
export { duplicatePublicContract } from './duplicate-public-contract.js';
export { errorMappingCompleteness } from './error-mapping-completeness.js';
export { exampleValid } from './example-valid.js';
export { firesDeclarations } from './fires-declarations.js';
export { incompleteAccessorForStandardOp } from './incomplete-accessor-for-standard-op.js';
export { incompleteCrud } from './incomplete-crud.js';
export { intentPropagation } from './intent-propagation.js';
export { libraryProjectionCoherence } from './library-projection-coherence.js';
export { layerFieldNameDrift } from './layer-field-name-drift.js';
export { missingVisibility } from './missing-visibility.js';
export { missingReconcile } from './missing-reconcile.js';
export { onReferencesExist } from './on-references-exist.js';
export { noDevPermitInSource } from './no-dev-permit-in-source.js';
export { noDestructuredCompose } from './no-destructured-compose.js';
export { noLegacyLayerImports } from './no-legacy-layer-imports.js';
export { noDirectImplementationCall } from './no-direct-implementation-call.js';
export { noNativeErrorResult } from './no-native-error-result.js';
export { noRedundantResultErrorWrap } from './no-redundant-result-error-wrap.js';
export { noRetiredCrossVocabulary } from './no-retired-cross-vocabulary.js';
export { noSyncResultAssumption } from './no-sync-result-assumption.js';
export { implementationReturnsResult } from './implementation-returns-result.js';
export { noThrowInDetourRecover } from './no-throw-in-detour-recover.js';
export { noTopLevelSurface } from './no-top-level-surface.js';
export { orphanedSignal } from './orphaned-signal.js';
export { ownerProjectionParity } from './owner-projection-parity.js';
export { permitGovernance } from './permit-governance.js';
export { preferSchemaInference } from './prefer-schema-inference.js';
export { publicInternalDeepImports } from './public-internal-deep-imports.js';
export { publicOutputSchema } from './public-output-schema.js';
export { publicUnionOutputDiscriminants } from './public-union-output-discriminants.js';
export { readIntentFires } from './read-intent-fires.js';
export { referenceExists } from './reference-exists.js';
export { resolvedImportBoundary } from './resolved-import-boundary.js';
export { resourceDeclarations } from './resource-declarations.js';
export { resourceExists } from './resource-exists.js';
export { resourceIdGrammar } from './resource-id-grammar.js';
export { resourceMockCoverage } from './resource-mock-coverage.js';
export { scheduledDestroyIntent } from './scheduled-destroy-intent.js';
export { signalGraphCoaching } from './signal-graph-coaching.js';
export { staticResourceAccessorPreference } from './static-resource-accessor-preference.js';
export { surfaceFacetCoherence } from './surface-facet-coherence.js';
export { trailForkCoaching } from './trail-fork-coaching.js';
export {
  forkWithoutPreservedBlaze,
  markerSchemaUnsupported,
  versionPinnedCompose,
} from './trail-versioning-source.js';
export {
  deprecationWithoutGuidance,
  pendingForce,
  versionGap,
  versionWithoutExamples,
} from './trail-versioning-topo.js';
export { unmaterializedActivationSource } from './unmaterialized-activation-source.js';
export { unreachableDetourShadowing } from './unreachable-detour-shadowing.js';
export { validDetourContract } from './valid-detour-contract.js';
export { validDescribeRefs } from './valid-describe-refs.js';
export { webhookRouteCollision } from './webhook-route-collision.js';

/** All built-in warden rules, keyed by rule name. */
export const wardenRules: ReadonlyMap<string, WardenRule> = new Map<
  string,
  WardenRule
>([
  [noThrowInImplementation.name, noThrowInImplementation],
  [circularRefs.name, circularRefs],
  [contourExists.name, contourExists],
  [contextNoSurfaceTypes.name, contextNoSurfaceTypes],
  [composesDeclarations.name, composesDeclarations],
  [deadInternalTrail.name, deadInternalTrail],
  [deadPublicTrail.name, deadPublicTrail],
  [draftFileMarking.name, draftFileMarking],
  [draftVisibleDebt.name, draftVisibleDebt],
  [errorMappingCompleteness.name, errorMappingCompleteness],
  [exampleValid.name, exampleValid],
  [firesDeclarations.name, firesDeclarations],
  [incompleteCrud.name, incompleteCrud],
  [intentPropagation.name, intentPropagation],
  [layerFieldNameDrift.name, layerFieldNameDrift],
  [missingVisibility.name, missingVisibility],
  [missingReconcile.name, missingReconcile],
  [onReferencesExist.name, onReferencesExist],
  [orphanedSignal.name, orphanedSignal],
  [ownerProjectionParity.name, ownerProjectionParity],
  [publicExportExampleCoverage.name, publicExportExampleCoverage],
  [publicInternalDeepImports.name, publicInternalDeepImports],
  [resourceDeclarations.name, resourceDeclarations],
  [readIntentFires.name, readIntentFires],
  [referenceExists.name, referenceExists],
  [resolvedImportBoundary.name, resolvedImportBoundary],
  [resourceIdGrammar.name, resourceIdGrammar],
  [resourceExists.name, resourceExists],
  [resourceMockCoverage.name, resourceMockCoverage],
  [preferSchemaInference.name, preferSchemaInference],
  [staticResourceAccessorPreference.name, staticResourceAccessorPreference],
  [surfaceFacetCoherence.name, surfaceFacetCoherence],
  [trailForkCoaching.name, trailForkCoaching],
  [validDescribeRefs.name, validDescribeRefs],
  [noDevPermitInSource.name, noDevPermitInSource],
  [noDestructuredCompose.name, noDestructuredCompose],
  [noDirectImplementationCall.name, noDirectImplementationCall],
  [noLegacyLayerImports.name, noLegacyLayerImports],
  [noNativeErrorResult.name, noNativeErrorResult],
  [noRedundantResultErrorWrap.name, noRedundantResultErrorWrap],
  [noRetiredCrossVocabulary.name, noRetiredCrossVocabulary],
  [noSyncResultAssumption.name, noSyncResultAssumption],
  [implementationReturnsResult.name, implementationReturnsResult],
  [noThrowInDetourRecover.name, noThrowInDetourRecover],
  [noTopLevelSurface.name, noTopLevelSurface],
  [unreachableDetourShadowing.name, unreachableDetourShadowing],
  [wardenExportSymmetry.name, wardenExportSymmetry],
  [wardenRulesUseAst.name, wardenRulesUseAst],
  [forkWithoutPreservedBlaze.name, forkWithoutPreservedBlaze],
  [markerSchemaUnsupported.name, markerSchemaUnsupported],
  [versionPinnedCompose.name, versionPinnedCompose],
]);

/**
 * Built-in topo-aware warden rules, keyed by rule name.
 *
 * These rules inspect the compiled runtime trail graph once per topo,
 * rather than scanning source files. Kept in a separate registry because
 * their dispatch shape differs from `WardenRule` / `ProjectAwareWardenRule`.
 *
 * @remarks
 * Topo-aware rules only fire when the warden runtime is invoked with a
 * resolved `Topo` (see `WardenOptions.topo`). Runs without a topo — e.g.
 * pure source-directory lints — silently skip this registry. Rules
 * registered here must tolerate non-execution when no topo is available.
 */
export const wardenTopoRules: ReadonlyMap<string, TopoAwareWardenRule> =
  new Map<string, TopoAwareWardenRule>([
    [activationOrphan.name, activationOrphan],
    [cliCommandRouteCoherence.name, cliCommandRouteCoherence],
    [duplicatePublicContract.name, duplicatePublicContract],
    [incompleteAccessorForStandardOp.name, incompleteAccessorForStandardOp],
    [libraryProjectionCoherence.name, libraryProjectionCoherence],
    [permitGovernance.name, permitGovernance],
    [publicOutputSchema.name, publicOutputSchema],
    [publicUnionOutputDiscriminants.name, publicUnionOutputDiscriminants],
    [scheduledDestroyIntent.name, scheduledDestroyIntent],
    [signalGraphCoaching.name, signalGraphCoaching],
    [unmaterializedActivationSource.name, unmaterializedActivationSource],
    [validDetourContract.name, validDetourContract],
    [deprecationWithoutGuidance.name, deprecationWithoutGuidance],
    [pendingForce.name, pendingForce],
    [versionGap.name, versionGap],
    [versionWithoutExamples.name, versionWithoutExamples],
    [webhookRouteCollision.name, webhookRouteCollision],
  ]);
