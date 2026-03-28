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
  Surface,
} from './types.js';

// Context factory
export { createTrailContext } from './context.js';

// Trail
export { trail } from './trail.js';
export type { AnyTrail, Trail, TrailSpec, TrailExample } from './trail.js';

// Hike
export { hike } from './hike.js';
export type { AnyHike, Hike, HikeSpec } from './hike.js';

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

// Health
export type { HealthStatus, HealthResult } from './health.js';

// Adapters
export type {
  IndexAdapter,
  StorageAdapter,
  CacheAdapter,
  SearchOptions,
  SearchResult,
  StorageOptions,
} from './adapters.js';

// Derive
export { deriveFields } from './derive.js';
export type { Field, FieldOverride } from './derive.js';

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
