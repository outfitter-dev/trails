import { circularRefs } from './circular-refs.js';
import { contourExists } from './contour-exists.js';
import { contextNoSurfaceTypes } from './context-no-surface-types.js';
import { crossDeclarations } from './cross-declarations.js';
import { deadInternalTrail } from './dead-internal-trail.js';
import { draftFileMarking } from './draft-file-marking.js';
import { draftVisibleDebt } from './draft-visible-debt.js';
import { errorMappingCompleteness } from './error-mapping-completeness.js';
import { exampleValid } from './example-valid.js';
import { firesDeclarations } from './fires-declarations.js';
import { implementationReturnsResult } from './implementation-returns-result.js';
import { incompleteAccessorForStandardOp } from './incomplete-accessor-for-standard-op.js';
import { incompleteCrud } from './incomplete-crud.js';
import { intentPropagation } from './intent-propagation.js';
import { missingVisibility } from './missing-visibility.js';
import { missingReconcile } from './missing-reconcile.js';
import { noDirectImplementationCall } from './no-direct-implementation-call.js';
import { noNativeErrorResult } from './no-native-error-result.js';
import { noSyncResultAssumption } from './no-sync-result-assumption.js';
import { noThrowInDetourRecover } from './no-throw-in-detour-recover.js';
import { noThrowInImplementation } from './no-throw-in-implementation.js';
import { onReferencesExist } from './on-references-exist.js';
import { orphanedSignal } from './orphaned-signal.js';
import { ownerProjectionParity } from './owner-projection-parity.js';
import { permitGovernance } from './permit-governance.js';
import { preferSchemaInference } from './prefer-schema-inference.js';
import { publicInternalDeepImports } from './public-internal-deep-imports.js';
import { publicUnionOutputDiscriminants } from './public-union-output-discriminants.js';
import { readIntentFires } from './read-intent-fires.js';
import { referenceExists } from './reference-exists.js';
import { resourceDeclarations } from './resource-declarations.js';
import { resourceExists } from './resource-exists.js';
import { resourceIdGrammar } from './resource-id-grammar.js';
import type { TopoAwareWardenRule, WardenRule } from './types.js';
import { unreachableDetourShadowing } from './unreachable-detour-shadowing.js';
import { validDetourContract } from './valid-detour-contract.js';
import { validDescribeRefs } from './valid-describe-refs.js';
import { wardenExportSymmetry } from './warden-export-symmetry.js';
import { wardenRulesUseAst } from './warden-rules-use-ast.js';

export type {
  WardenRuleLifecycle,
  WardenRuleLifecycleState,
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
  wardenRuleLifecycleStates,
  wardenRuleScopes,
  wardenRuleTiers,
} from './metadata.js';
export type { BuiltinWardenRuleName } from './metadata.js';

export { noThrowInImplementation } from './no-throw-in-implementation.js';
export { circularRefs } from './circular-refs.js';
export { contourExists } from './contour-exists.js';
export { contextNoSurfaceTypes } from './context-no-surface-types.js';
export { crossDeclarations } from './cross-declarations.js';
export { deadInternalTrail } from './dead-internal-trail.js';
export { draftFileMarking } from './draft-file-marking.js';
export { draftVisibleDebt } from './draft-visible-debt.js';
export { errorMappingCompleteness } from './error-mapping-completeness.js';
export { exampleValid } from './example-valid.js';
export { firesDeclarations } from './fires-declarations.js';
export { incompleteAccessorForStandardOp } from './incomplete-accessor-for-standard-op.js';
export { incompleteCrud } from './incomplete-crud.js';
export { intentPropagation } from './intent-propagation.js';
export { missingVisibility } from './missing-visibility.js';
export { missingReconcile } from './missing-reconcile.js';
export { onReferencesExist } from './on-references-exist.js';
export { noDirectImplementationCall } from './no-direct-implementation-call.js';
export { noNativeErrorResult } from './no-native-error-result.js';
export { noSyncResultAssumption } from './no-sync-result-assumption.js';
export { implementationReturnsResult } from './implementation-returns-result.js';
export { noThrowInDetourRecover } from './no-throw-in-detour-recover.js';
export { orphanedSignal } from './orphaned-signal.js';
export { ownerProjectionParity } from './owner-projection-parity.js';
export { permitGovernance } from './permit-governance.js';
export { preferSchemaInference } from './prefer-schema-inference.js';
export { publicInternalDeepImports } from './public-internal-deep-imports.js';
export { publicUnionOutputDiscriminants } from './public-union-output-discriminants.js';
export { readIntentFires } from './read-intent-fires.js';
export { referenceExists } from './reference-exists.js';
export { resourceDeclarations } from './resource-declarations.js';
export { resourceExists } from './resource-exists.js';
export { resourceIdGrammar } from './resource-id-grammar.js';
export { unreachableDetourShadowing } from './unreachable-detour-shadowing.js';
export { validDetourContract } from './valid-detour-contract.js';
export { validDescribeRefs } from './valid-describe-refs.js';

/** All built-in warden rules, keyed by rule name. */
export const wardenRules: ReadonlyMap<string, WardenRule> = new Map<
  string,
  WardenRule
>([
  [noThrowInImplementation.name, noThrowInImplementation],
  [circularRefs.name, circularRefs],
  [contourExists.name, contourExists],
  [contextNoSurfaceTypes.name, contextNoSurfaceTypes],
  [crossDeclarations.name, crossDeclarations],
  [deadInternalTrail.name, deadInternalTrail],
  [draftFileMarking.name, draftFileMarking],
  [draftVisibleDebt.name, draftVisibleDebt],
  [errorMappingCompleteness.name, errorMappingCompleteness],
  [exampleValid.name, exampleValid],
  [firesDeclarations.name, firesDeclarations],
  [incompleteCrud.name, incompleteCrud],
  [intentPropagation.name, intentPropagation],
  [missingVisibility.name, missingVisibility],
  [missingReconcile.name, missingReconcile],
  [onReferencesExist.name, onReferencesExist],
  [orphanedSignal.name, orphanedSignal],
  [ownerProjectionParity.name, ownerProjectionParity],
  [publicInternalDeepImports.name, publicInternalDeepImports],
  [resourceDeclarations.name, resourceDeclarations],
  [readIntentFires.name, readIntentFires],
  [referenceExists.name, referenceExists],
  [resourceIdGrammar.name, resourceIdGrammar],
  [resourceExists.name, resourceExists],
  [preferSchemaInference.name, preferSchemaInference],
  [validDescribeRefs.name, validDescribeRefs],
  [noDirectImplementationCall.name, noDirectImplementationCall],
  [noNativeErrorResult.name, noNativeErrorResult],
  [noSyncResultAssumption.name, noSyncResultAssumption],
  [implementationReturnsResult.name, implementationReturnsResult],
  [noThrowInDetourRecover.name, noThrowInDetourRecover],
  [unreachableDetourShadowing.name, unreachableDetourShadowing],
  [wardenExportSymmetry.name, wardenExportSymmetry],
  [wardenRulesUseAst.name, wardenRulesUseAst],
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
    [incompleteAccessorForStandardOp.name, incompleteAccessorForStandardOp],
    [permitGovernance.name, permitGovernance],
    [publicUnionOutputDiscriminants.name, publicUnionOutputDiscriminants],
    [validDetourContract.name, validDetourContract],
  ]);
