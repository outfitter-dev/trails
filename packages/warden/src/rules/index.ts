import { contextNoSurfaceTypes } from './context-no-surface-types.js';
import { eventOriginsExist } from './event-origins-exist.js';
import { examplesMatchSchema } from './examples-match-schema.js';
import { followsMatchesCalls } from './follows-matches-calls.js';
import { followsTrailsExist } from './follows-trails-exist.js';
import { implementationReturnsResult } from './implementation-returns-result.js';
import { noDirectImplementationCall } from './no-direct-implementation-call.js';
import { noRecursiveFollows } from './no-recursive-follows.js';
import { noSyncResultAssumption } from './no-sync-result-assumption.js';
import { noThrowInDetourTarget } from './no-throw-in-detour-target.js';
import { noThrowInImplementation } from './no-throw-in-implementation.js';
import { preferSchemaInference } from './prefer-schema-inference.js';
import { requireOutputSchema } from './require-output-schema.js';
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
export { requireOutputSchema } from './require-output-schema.js';
export { followsMatchesCalls } from './follows-matches-calls.js';
export { noRecursiveFollows } from './no-recursive-follows.js';
export { followsTrailsExist } from './follows-trails-exist.js';
export { validDetourRefs } from './valid-detour-refs.js';
export { noDirectImplInRoute } from './no-direct-impl-in-route.js';
export { noDirectImplementationCall } from './no-direct-implementation-call.js';
export { noSyncResultAssumption } from './no-sync-result-assumption.js';
export { implementationReturnsResult } from './implementation-returns-result.js';
export { noThrowInDetourTarget } from './no-throw-in-detour-target.js';
export { eventOriginsExist } from './event-origins-exist.js';
export { preferSchemaInference } from './prefer-schema-inference.js';
export { examplesMatchSchema } from './examples-match-schema.js';
export { validDescribeRefs } from './valid-describe-refs.js';

/**
 * All built-in warden rules, keyed by rule name.
 */
export const wardenRules: ReadonlyMap<string, WardenRule> = new Map<
  string,
  WardenRule
>([
  [noThrowInImplementation.name, noThrowInImplementation],
  [contextNoSurfaceTypes.name, contextNoSurfaceTypes],
  [requireOutputSchema.name, requireOutputSchema],
  [preferSchemaInference.name, preferSchemaInference],
  [examplesMatchSchema.name, examplesMatchSchema],
  [followsMatchesCalls.name, followsMatchesCalls],
  [noRecursiveFollows.name, noRecursiveFollows],
  [followsTrailsExist.name, followsTrailsExist],
  [validDescribeRefs.name, validDescribeRefs],
  [validDetourRefs.name, validDetourRefs],
  [noDirectImplementationCall.name, noDirectImplementationCall],
  [noSyncResultAssumption.name, noSyncResultAssumption],
  [implementationReturnsResult.name, implementationReturnsResult],
  [noThrowInDetourTarget.name, noThrowInDetourTarget],
  [eventOriginsExist.name, eventOriginsExist],
]);
