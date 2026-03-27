/**
 * Warden trails — each lint rule wrapped as a trail, plus a lint hike.
 */

import { topo } from '@ontrails/core';

import * as contextNoSurfaceTypes from './context-no-surface-types.js';
import * as eventOriginsExist from './event-origins-exist.js';
import * as examplesMatchSchema from './examples-match-schema.js';
import * as followsMatchesCalls from './follows-matches-calls.js';
import * as followsTrailsExist from './follows-trails-exist.js';
import * as implementationReturnsResult from './implementation-returns-result.js';
import * as lint from './lint.js';
import * as noDirectImplInRoute from './no-direct-impl-in-route.js';
import * as noDirectImplementationCall from './no-direct-implementation-call.js';
import * as noRecursiveFollows from './no-recursive-follows.js';
import * as noSyncResultAssumption from './no-sync-result-assumption.js';
import * as noThrowInDetourTarget from './no-throw-in-detour-target.js';
import * as noThrowInImplementation from './no-throw-in-implementation.js';
import * as preferSchemaInference from './prefer-schema-inference.js';
import * as requireOutputSchema from './require-output-schema.js';
import * as validDescribeRefs from './valid-describe-refs.js';
import * as validDetourRefs from './valid-detour-refs.js';

export const wardenTopo = topo(
  'warden',
  contextNoSurfaceTypes,
  eventOriginsExist,
  examplesMatchSchema,
  followsMatchesCalls,
  followsTrailsExist,
  implementationReturnsResult,
  lint,
  noDirectImplInRoute,
  noDirectImplementationCall,
  noRecursiveFollows,
  noSyncResultAssumption,
  noThrowInDetourTarget,
  noThrowInImplementation,
  preferSchemaInference,
  requireOutputSchema,
  validDescribeRefs,
  validDetourRefs
);

/** Conventional alias for surface adapters. */
export { wardenTopo as app };

// Re-export individual trails for direct consumption
export { contextNoSurfaceTypesTrail } from './context-no-surface-types.js';
export { eventOriginsExistTrail } from './event-origins-exist.js';
export { examplesMatchSchemaTrail } from './examples-match-schema.js';
export { followsMatchesCallsTrail } from './follows-matches-calls.js';
export { followsTrailsExistTrail } from './follows-trails-exist.js';
export { implementationReturnsResultTrail } from './implementation-returns-result.js';
export { noDirectImplInRouteTrail } from './no-direct-impl-in-route.js';
export { noDirectImplementationCallTrail } from './no-direct-implementation-call.js';
export { noRecursiveFollowsTrail } from './no-recursive-follows.js';
export { noSyncResultAssumptionTrail } from './no-sync-result-assumption.js';
export { noThrowInDetourTargetTrail } from './no-throw-in-detour-target.js';
export { noThrowInImplementationTrail } from './no-throw-in-implementation.js';
export { preferSchemaInferenceTrail } from './prefer-schema-inference.js';
export { requireOutputSchemaTrail } from './require-output-schema.js';
export { validDescribeRefsTrail } from './valid-describe-refs.js';
export { validDetourRefsTrail } from './valid-detour-refs.js';
export { lintFile } from './lint.js';

// Schemas
export type {
  ProjectAwareRuleInput,
  RuleInput,
  RuleOutput,
} from './schemas.js';
export {
  projectAwareRuleInputSchema,
  ruleInputSchema,
  ruleOutputSchema,
} from './schemas.js';
