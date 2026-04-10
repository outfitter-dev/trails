import { contextNoTrailheadTypes } from './context-no-trailhead-types.js';
import { crossDeclarations } from './cross-declarations.js';
import { deadInternalTrail } from './dead-internal-trail.js';
import { draftFileMarking } from './draft-file-marking.js';
import { draftVisibleDebt } from './draft-visible-debt.js';
import { errorMappingCompleteness } from './error-mapping-completeness.js';
import { firesDeclarations } from './fires-declarations.js';
import { implementationReturnsResult } from './implementation-returns-result.js';
import { intentPropagation } from './intent-propagation.js';
import { missingVisibility } from './missing-visibility.js';
import { noDirectImplInRoute } from './no-direct-impl-in-route.js';
import { noDirectImplementationCall } from './no-direct-implementation-call.js';
import { noSyncResultAssumption } from './no-sync-result-assumption.js';
import { noThrowInDetourTarget } from './no-throw-in-detour-target.js';
import { noThrowInImplementation } from './no-throw-in-implementation.js';
import { onReferencesExist } from './on-references-exist.js';
import { preferSchemaInference } from './prefer-schema-inference.js';
import { resourceDeclarations } from './resource-declarations.js';
import { resourceExists } from './resource-exists.js';
import type { WardenRule } from './types.js';
import { validDescribeRefs } from './valid-describe-refs.js';
import { validDetourRefs } from './valid-detour-refs.js';

export type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
  WardenRule,
  WardenSeverity,
} from './types.js';

export { noThrowInImplementation } from './no-throw-in-implementation.js';
export { contextNoTrailheadTypes } from './context-no-trailhead-types.js';
export { crossDeclarations } from './cross-declarations.js';
export { deadInternalTrail } from './dead-internal-trail.js';
export { draftFileMarking } from './draft-file-marking.js';
export { draftVisibleDebt } from './draft-visible-debt.js';
export { errorMappingCompleteness } from './error-mapping-completeness.js';
export { firesDeclarations } from './fires-declarations.js';
export { intentPropagation } from './intent-propagation.js';
export { missingVisibility } from './missing-visibility.js';
export { onReferencesExist } from './on-references-exist.js';
export { validDetourRefs } from './valid-detour-refs.js';
export { noDirectImplInRoute } from './no-direct-impl-in-route.js';
export { noDirectImplementationCall } from './no-direct-implementation-call.js';
export { noSyncResultAssumption } from './no-sync-result-assumption.js';
export { implementationReturnsResult } from './implementation-returns-result.js';
export { noThrowInDetourTarget } from './no-throw-in-detour-target.js';
export { preferSchemaInference } from './prefer-schema-inference.js';
export { resourceDeclarations } from './resource-declarations.js';
export { resourceExists } from './resource-exists.js';
export { validDescribeRefs } from './valid-describe-refs.js';

/** All built-in warden rules, keyed by rule name. */
export const wardenRules: ReadonlyMap<string, WardenRule> = new Map<
  string,
  WardenRule
>([
  [noThrowInImplementation.name, noThrowInImplementation],
  [contextNoTrailheadTypes.name, contextNoTrailheadTypes],
  [crossDeclarations.name, crossDeclarations],
  [deadInternalTrail.name, deadInternalTrail],
  [draftFileMarking.name, draftFileMarking],
  [draftVisibleDebt.name, draftVisibleDebt],
  [errorMappingCompleteness.name, errorMappingCompleteness],
  [firesDeclarations.name, firesDeclarations],
  [intentPropagation.name, intentPropagation],
  [missingVisibility.name, missingVisibility],
  [onReferencesExist.name, onReferencesExist],
  [resourceDeclarations.name, resourceDeclarations],
  [resourceExists.name, resourceExists],
  [preferSchemaInference.name, preferSchemaInference],
  [validDescribeRefs.name, validDescribeRefs],
  [validDetourRefs.name, validDetourRefs],
  [noDirectImplementationCall.name, noDirectImplementationCall],
  [noSyncResultAssumption.name, noSyncResultAssumption],
  [implementationReturnsResult.name, implementationReturnsResult],
  [noThrowInDetourTarget.name, noThrowInDetourTarget],
  [noDirectImplInRoute.name, noDirectImplInRoute],
]);
