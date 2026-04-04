// Result
export { Result } from './result.js';

// Errors
export {
  TrailsError,
  ValidationError,
  AmbiguousError,
  AssertionError,
  NotFoundError,
  AlreadyExistsError,
  ConflictError,
  PermissionError,
  TimeoutError,
  RateLimitError,
  NetworkError,
  InternalError,
  AuthError,
  CancelledError,
  exitCodeMap,
  statusCodeMap,
  jsonRpcCodeMap,
  retryableMap,
  isRetryable,
  isTrailsError,
} from './errors.js';
export type { ErrorCategory } from './errors.js';

// Types
export type {
  Implementation,
  TrailContext,
  TrailContextInit,
  CrossFn,
  BasePermit,
  PermitRequirement,
  ProgressCallback,
  ProgressEvent,
  Logger,
  ProvisionLookup,
} from './types.js';
export { TRAILHEAD_KEY } from './types.js';

// Context factory
export { createTrailContext } from './context.js';

// Provision
export {
  createProvisionLookup,
  findDuplicateProvisionId,
  isProvision,
  provision,
} from './provision.js';
export type {
  AnyProvision,
  Provision,
  ProvisionContext,
  ProvisionOverrideMap,
  ProvisionSpec,
} from './provision.js';

// Trail
export { trail } from './trail.js';
export type {
  AnyTrail,
  Intent,
  Trail,
  TrailSpec,
  TrailExample,
} from './trail.js';

// Type utilities
export type { TrailInput, TrailOutput, TrailResult } from './type-utils.js';
export { inputOf, outputOf } from './type-utils.js';

// Signal
export { signal } from './signal.js';
export type { AnySignal, Signal, SignalSpec } from './signal.js';
export { event } from './event.js';
export type { AnyEvent, Event, EventSpec } from './event.js';

// Topo
export { topo } from './topo.js';
export type { Topo } from './topo.js';

// Topo validation
export { validateTopo } from './validate-topo.js';
export type { TopoIssue } from './validate-topo.js';

// Gate
export { composeGates } from './gate.js';
export type { Gate } from './gate.js';

// Derive
export { deriveCliPath, deriveFields } from './derive.js';
export type { Field, FieldOverride } from './derive.js';

// Execute
export { executeTrail } from './execute.js';
export type { ExecuteTrailOptions } from './execute.js';

// Run
export { run } from './run.js';
export type { RunOptions } from './run.js';

// Validation
export {
  validateInput,
  validateOutput,
  formatZodIssues,
  zodToJsonSchema,
} from './validation.js';

// Serialization
export { serializeError, deserializeError } from './serialization.js';
export type { SerializedError } from './serialization.js';

// Resilience
export {
  retry,
  withTimeout,
  shouldRetry,
  getBackoffDelay,
} from './resilience.js';
export type { RetryOptions } from './resilience.js';

// Fetch — fromFetch is available as Result.fromFetch()

// Branded types
export {
  brand,
  unbrand,
  uuid,
  email,
  nonEmptyString,
  positiveInt,
  shortId,
  hashId,
} from './branded.js';
export type {
  Branded,
  UUID,
  Email,
  NonEmptyString,
  PositiveInt,
} from './branded.js';

// Path Security
export { securePath, isPathSafe, resolveSafePath } from './path-security.js';

// Workspace
export {
  findWorkspaceRoot,
  isInsideWorkspace,
  getRelativePath,
} from './workspace.js';

// Blob
export { createBlobRef, isBlobRef } from './blob-ref.js';
export type { BlobRef } from './blob-ref.js';

// Guards
export {
  isDefined,
  isNonEmptyString,
  isPlainObject,
  hasProperty,
  assertNever,
} from './guards.js';

// Collections
export {
  chunk,
  dedupe,
  groupBy,
  sortBy,
  isNonEmptyArray,
} from './collections.js';
export type {
  NonEmptyArray,
  DeepPartial,
  Prettify,
  AtLeastOne,
} from './collections.js';
