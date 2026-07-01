/**
 * Registry name snapshot used by `warden-export-symmetry`.
 *
 * Imports each rule module directly to avoid a dependency cycle with
 * `./index.ts`, which itself imports `warden-export-symmetry`. Keep this
 * list in lockstep with `wardenRules` / `wardenTopoRules` in `./index.ts` —
 * the `warden-export-symmetry` rule will fail the build if they drift.
 */
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
import { governedSymbolResidue } from './governed-symbol-residue.js';
import { implementationReturnsResult } from './implementation-returns-result.js';
import { incompleteAccessorForStandardOp } from './incomplete-accessor-for-standard-op.js';
import { incompleteCrud } from './incomplete-crud.js';
import { intentPropagation } from './intent-propagation.js';
import { layerFieldNameDrift } from './layer-field-name-drift.js';
import { libraryProjectionCoherence } from './library-projection-coherence.js';
import { missingReconcile } from './missing-reconcile.js';
import { missingVisibility } from './missing-visibility.js';
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
import { unmaterializedActivationSource } from './unmaterialized-activation-source.js';
import { unreachableDetourShadowing } from './unreachable-detour-shadowing.js';
import { validDetourContract } from './valid-detour-contract.js';
import { validDescribeRefs } from './valid-describe-refs.js';
import { wardenRulesUseAst } from './warden-rules-use-ast.js';
import { webhookRouteCollision } from './webhook-route-collision.js';

/**
 * All non-`warden-export-symmetry` rule identifiers registered in
 * `wardenRules` / `wardenTopoRules`. Excludes the symmetry rule itself to
 * avoid a self-referential check; the symmetry rule adds its own name back in
 * when comparing against the public barrel.
 */
export const registeredRuleNames: readonly string[] = [
  activationOrphan.name,
  cliCommandRouteCoherence.name,
  circularRefs.name,
  contextNoSurfaceTypes.name,
  contourExists.name,
  composesDeclarations.name,
  deadInternalTrail.name,
  deadPublicTrail.name,
  deprecationWithoutGuidance.name,
  duplicatePublicContract.name,
  draftFileMarking.name,
  draftVisibleDebt.name,
  errorMappingCompleteness.name,
  exampleValid.name,
  firesDeclarations.name,
  governedSymbolResidue.name,
  forkWithoutPreservedBlaze.name,
  implementationReturnsResult.name,
  incompleteAccessorForStandardOp.name,
  incompleteCrud.name,
  intentPropagation.name,
  layerFieldNameDrift.name,
  libraryProjectionCoherence.name,
  markerSchemaUnsupported.name,
  missingReconcile.name,
  missingVisibility.name,
  noDevPermitInSource.name,
  noDestructuredCompose.name,
  noLegacyLayerImports.name,
  noDirectImplementationCall.name,
  noNativeErrorResult.name,
  noRedundantResultErrorWrap.name,
  noRetiredCrossVocabulary.name,
  noSyncResultAssumption.name,
  noThrowInDetourRecover.name,
  noThrowInImplementation.name,
  noTopLevelSurface.name,
  onReferencesExist.name,
  orphanedSignal.name,
  ownerProjectionParity.name,
  pendingForce.name,
  permitGovernance.name,
  preferSchemaInference.name,
  publicExportExampleCoverage.name,
  publicInternalDeepImports.name,
  publicOutputSchema.name,
  publicUnionOutputDiscriminants.name,
  readIntentFires.name,
  referenceExists.name,
  resolvedImportBoundary.name,
  resourceDeclarations.name,
  resourceExists.name,
  resourceIdGrammar.name,
  resourceMockCoverage.name,
  scheduledDestroyIntent.name,
  signalGraphCoaching.name,
  staticResourceAccessorPreference.name,
  surfaceFacetCoherence.name,
  trailForkCoaching.name,
  unmaterializedActivationSource.name,
  unreachableDetourShadowing.name,
  validDetourContract.name,
  validDescribeRefs.name,
  versionGap.name,
  versionPinnedCompose.name,
  versionWithoutExamples.name,
  wardenRulesUseAst.name,
  webhookRouteCollision.name,
];
