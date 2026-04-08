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
export { contextNoTrailheadTypes } from './rules/context-no-trailhead-types.js';
export { draftFileMarking } from './rules/draft-file-marking.js';
export { draftVisibleDebt } from './rules/draft-visible-debt.js';
export { firesDeclarations } from './rules/fires-declarations.js';
export { onReferencesExist } from './rules/on-references-exist.js';
export { validDetourRefs } from './rules/valid-detour-refs.js';
export { noDirectImplInRoute } from './rules/no-direct-impl-in-route.js';
export { noDirectImplementationCall } from './rules/no-direct-implementation-call.js';
export { noSyncResultAssumption } from './rules/no-sync-result-assumption.js';
export { implementationReturnsResult } from './rules/implementation-returns-result.js';
export { noThrowInDetourTarget } from './rules/no-throw-in-detour-target.js';
export { preferSchemaInference } from './rules/prefer-schema-inference.js';
export { resourceDeclarations } from './rules/resource-declarations.js';
export { resourceExists } from './rules/resource-exists.js';
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

// Draft helpers
export {
  DRAFT_FILE_PREFIX,
  DRAFT_FILE_SEGMENT,
  isDraftMarkedFile,
  stripDraftFileMarkers,
} from './draft.js';

// AST helpers for repo-local tooling
export {
  findStringLiterals,
  getStringValue,
  isStringLiteral,
  offsetToLine,
  parse,
  walk,
} from './rules/ast.js';
export type { AstNode, StringLiteralMatch } from './rules/ast.js';

// Trail layer
export { wardenTopo } from './trails/topo.js';
export { runWardenTrails } from './trails/run.js';
export {
  contextNoTrailheadTypesTrail,
  crossDeclarationsTrail,
  diagnosticSchema,
  firesDeclarationsTrail,
  implementationReturnsResultTrail,
  noDirectImplInRouteTrail,
  noDirectImplementationCallTrail,
  noSyncResultAssumptionTrail,
  noThrowInDetourTargetTrail,
  noThrowInImplementationTrail,
  onReferencesExistTrail,
  preferSchemaInferenceTrail,
  ruleInput,
  ruleOutput,
  resourceDeclarationsTrail,
  resourceExistsTrail,
  validDescribeRefsTrail,
  validDetourRefsTrail,
} from './trails/index.js';
export type { RuleInput, RuleOutput } from './trails/index.js';
