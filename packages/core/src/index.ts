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
  FollowFn,
  ProgressCallback,
  ProgressEvent,
  Logger,
} from './types.js';

// Context factory
export { createTrailContext } from './context.js';

// Service
export { findDuplicateServiceId, isService, service } from './service.js';
export type {
  AnyService,
  Service,
  ServiceContext,
  ServiceSpec,
} from './service.js';

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

// Event
export { event } from './event.js';
export type { AnyEvent, Event, EventSpec } from './event.js';

// Topo
export { topo } from './topo.js';
export type { Topo } from './topo.js';

// Topo validation
export { validateTopo } from './validate-topo.js';
export type { TopoIssue } from './validate-topo.js';

// Layer
export { composeLayers } from './layer.js';
export type { Layer } from './layer.js';

// Derive
export { deriveFields } from './derive.js';
export type { Field, FieldOverride } from './derive.js';

// Execute
export { executeTrail } from './execute.js';
export type { ExecuteTrailOptions } from './execute.js';

// Dispatch
export { dispatch } from './dispatch.js';
export type { DispatchOptions } from './dispatch.js';

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
