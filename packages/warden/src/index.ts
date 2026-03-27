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
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
  WardenRule,
  WardenSeverity,
} from './rules/index.js';

// Individual rules
export { noThrowInImplementation } from './rules/no-throw-in-implementation.js';
export { contextNoSurfaceTypes } from './rules/context-no-surface-types.js';
export { requireOutputSchema } from './rules/require-output-schema.js';
export { followsMatchesCalls } from './rules/follows-matches-calls.js';
export { noRecursiveFollows } from './rules/no-recursive-follows.js';
export { followsTrailsExist } from './rules/follows-trails-exist.js';
export { validDetourRefs } from './rules/valid-detour-refs.js';
export { noDirectImplInRoute } from './rules/no-direct-impl-in-route.js';
export { noDirectImplementationCall } from './rules/no-direct-implementation-call.js';
export { noSyncResultAssumption } from './rules/no-sync-result-assumption.js';
export { implementationReturnsResult } from './rules/implementation-returns-result.js';
export { noThrowInDetourTarget } from './rules/no-throw-in-detour-target.js';
export { eventOriginsExist } from './rules/event-origins-exist.js';
export { preferSchemaInference } from './rules/prefer-schema-inference.js';
export { examplesMatchSchema } from './rules/examples-match-schema.js';
export { validDescribeRefs } from './rules/valid-describe-refs.js';

// Rule registry
export { wardenRules } from './rules/index.js';

// CLI runner
export type { WardenOptions, WardenReport } from './cli.js';
export { formatWardenReport, runWarden } from './cli.js';

// CI formatters
export {
  formatGitHubAnnotations,
  formatJson,
  formatSummary,
} from './formatters.js';

// Drift detection
export type { DriftResult } from './drift.js';
export { checkDrift } from './drift.js';

// Trail-based API
export { wardenTopo, lintFile } from './trails/index.js';
export type {
  RuleInput,
  ProjectAwareRuleInput,
  RuleOutput,
} from './trails/index.js';
export {
  ruleInputSchema,
  projectAwareRuleInputSchema,
  ruleOutputSchema,
} from './trails/index.js';
