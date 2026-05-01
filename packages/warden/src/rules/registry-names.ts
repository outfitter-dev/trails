/**
 * Registry name snapshot used by `warden-export-symmetry`.
 *
 * Imports each rule module directly to avoid a dependency cycle with
 * `./index.ts`, which itself imports `warden-export-symmetry`. Keep this
 * list in lockstep with `wardenRules` / `wardenTopoRules` in `./index.ts` —
 * the `warden-export-symmetry` rule will fail the build if they drift.
 */
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
import { missingReconcile } from './missing-reconcile.js';
import { missingVisibility } from './missing-visibility.js';
import { noDirectImplementationCall } from './no-direct-implementation-call.js';
import { noSyncResultAssumption } from './no-sync-result-assumption.js';
import { noThrowInDetourRecover } from './no-throw-in-detour-recover.js';
import { noThrowInImplementation } from './no-throw-in-implementation.js';
import { onReferencesExist } from './on-references-exist.js';
import { orphanedSignal } from './orphaned-signal.js';
import { permitGovernance } from './permit-governance.js';
import { preferSchemaInference } from './prefer-schema-inference.js';
import { referenceExists } from './reference-exists.js';
import { resourceDeclarations } from './resource-declarations.js';
import { resourceExists } from './resource-exists.js';
import { resourceIdGrammar } from './resource-id-grammar.js';
import { unreachableDetourShadowing } from './unreachable-detour-shadowing.js';
import { validDetourContract } from './valid-detour-contract.js';
import { validDescribeRefs } from './valid-describe-refs.js';
import { wardenRulesUseAst } from './warden-rules-use-ast.js';

/**
 * All non-`warden-export-symmetry` rule identifiers registered in
 * `wardenRules` / `wardenTopoRules`. Excludes the symmetry rule itself to
 * avoid a self-referential check; the symmetry rule adds its own name back in
 * when comparing against the public barrel.
 */
export const registeredRuleNames: readonly string[] = [
  circularRefs.name,
  contextNoSurfaceTypes.name,
  contourExists.name,
  crossDeclarations.name,
  deadInternalTrail.name,
  draftFileMarking.name,
  draftVisibleDebt.name,
  errorMappingCompleteness.name,
  exampleValid.name,
  firesDeclarations.name,
  implementationReturnsResult.name,
  incompleteAccessorForStandardOp.name,
  incompleteCrud.name,
  intentPropagation.name,
  missingReconcile.name,
  missingVisibility.name,
  noDirectImplementationCall.name,
  noSyncResultAssumption.name,
  noThrowInDetourRecover.name,
  noThrowInImplementation.name,
  onReferencesExist.name,
  orphanedSignal.name,
  permitGovernance.name,
  preferSchemaInference.name,
  referenceExists.name,
  resourceDeclarations.name,
  resourceExists.name,
  resourceIdGrammar.name,
  unreachableDetourShadowing.name,
  validDetourContract.name,
  validDescribeRefs.name,
  wardenRulesUseAst.name,
];
