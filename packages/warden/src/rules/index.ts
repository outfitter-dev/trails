import { contextNoSurfaceTypes } from './context-no-surface-types.js';
import { followDeclarations } from './follow-declarations.js';
import { implementationReturnsResult } from './implementation-returns-result.js';
import { noDirectImplInRoute } from './no-direct-impl-in-route.js';
import { noDirectImplementationCall } from './no-direct-implementation-call.js';
import { noSyncResultAssumption } from './no-sync-result-assumption.js';
import { noThrowInDetourTarget } from './no-throw-in-detour-target.js';
import { noThrowInImplementation } from './no-throw-in-implementation.js';
import { preferSchemaInference } from './prefer-schema-inference.js';
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
export { contextNoSurfaceTypes } from './context-no-surface-types.js';
export { followDeclarations } from './follow-declarations.js';
export { validDetourRefs } from './valid-detour-refs.js';
export { noDirectImplInRoute } from './no-direct-impl-in-route.js';
export { noDirectImplementationCall } from './no-direct-implementation-call.js';
export { noSyncResultAssumption } from './no-sync-result-assumption.js';
export { implementationReturnsResult } from './implementation-returns-result.js';
export { noThrowInDetourTarget } from './no-throw-in-detour-target.js';
export { preferSchemaInference } from './prefer-schema-inference.js';
export { validDescribeRefs } from './valid-describe-refs.js';

/** All built-in warden rules, keyed by rule name. */
export const wardenRules: ReadonlyMap<string, WardenRule> = new Map<
  string,
  WardenRule
>([
  [noThrowInImplementation.name, noThrowInImplementation],
  [contextNoSurfaceTypes.name, contextNoSurfaceTypes],
  [followDeclarations.name, followDeclarations],
  [preferSchemaInference.name, preferSchemaInference],
  [validDescribeRefs.name, validDescribeRefs],
  [validDetourRefs.name, validDetourRefs],
  [noDirectImplementationCall.name, noDirectImplementationCall],
  [noSyncResultAssumption.name, noSyncResultAssumption],
  [implementationReturnsResult.name, implementationReturnsResult],
  [noThrowInDetourTarget.name, noThrowInDetourTarget],
  [noDirectImplInRoute.name, noDirectImplInRoute],
]);
