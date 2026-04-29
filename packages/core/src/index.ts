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
  PermitError,
  TimeoutError,
  RateLimitError,
  NetworkError,
  InternalError,
  AuthError,
  CancelledError,
  DerivationError,
  errorCategories,
  exitCodeMap,
  statusCodeMap,
  jsonRpcCodeMap,
  retryableMap,
  RetryExhaustedError,
  isRetryable,
  isTrailsError,
} from './errors.js';
export type { ErrorCategory } from './errors.js';
export {
  createTransportErrorMapper,
  mapTransportError,
  transportErrorMap,
  transportErrorRegistry,
  transportNames,
} from './transport-error-map.js';
export type {
  TransportErrorCode,
  TransportErrorMapper,
  TransportErrorMappings,
  TransportName,
} from './transport-error-map.js';

// Types
export type {
  Detour,
  DetourAttempt,
  Implementation,
  TrailContext,
  TrailContextInit,
  CrossBatchOptions,
  CrossFn,
  FireFn,
  BasePermit,
  PermitRequirement,
  ProgressCallback,
  ProgressEvent,
  Logger,
  ResourceLookup,
} from './types.js';
export { TRAILHEAD_KEY } from './types.js';

// Context factory
export { createTrailContext, passthroughTrace } from './context.js';

// Resource
export {
  createResourceLookup,
  findDuplicateResourceId,
  isResource,
  resource,
} from './resource.js';
export type {
  AnyResource,
  Resource,
  ResourceContext,
  ResourceOverrideMap,
  ResourceSpec,
} from './resource.js';

// Trail
export { trail } from './trail.js';
export type {
  AnyTrail,
  BlazeInput,
  Intent,
  Trail,
  TrailSpec,
  TrailExample,
  TrailVisibility,
} from './trail.js';
export {
  filterSurfaceTrails,
  matchesTrailPattern,
  shouldIncludeTrailForSurface,
} from './surface-filter.js';
export type { SurfaceFilterOptions } from './surface-filter.js';

// Type utilities
export type {
  CrossInput,
  TrailInput,
  TrailOutput,
  TrailResult,
} from './type-utils.js';
export { inputOf, outputOf } from './type-utils.js';

// Signal
export { signal } from './signal.js';
export type { AnySignal, Signal, SignalSpec } from './signal.js';

// Contour
export { contour } from './contour.js';
export {
  CONTOUR_ID_METADATA,
  getContourIdMetadata,
  getContourReferences,
} from './contour.js';
export type {
  AnyContour,
  Contour,
  ContourIdBrand,
  ContourIdMetadata,
  ContourIdSchema,
  ContourIdValue,
  ContourOptions,
  ContourReference,
} from './contour.js';

// Topo
export { topo } from './topo.js';
export type { Topo, TopoIdentity } from './topo.js';
export {
  createTopoSnapshot,
  createMockTopoStore,
  createTopoStore,
  listTopoSnapshots,
  pinTopoSnapshot,
  topoStore,
  unpinTopoSnapshot,
} from './topo-store.js';
export type {
  CreateTopoSnapshotInput,
  ListTopoSnapshotsOptions,
  MockTopoStoreSeed,
  ReadOnlyTopoStore,
  TopoSnapshot,
  TopoStoreExportRecord,
  TopoStoreResourceRecord,
  TopoStoreRef,
  TopoStoreTrailDetailRecord,
  TopoStoreTrailRecord,
} from './topo-store.js';

// Draft state
export {
  DRAFT_ID_PREFIX,
  deriveDraftReport,
  isDraftId,
  validateDraftFreeTopo,
} from './draft.js';
export type {
  DraftDependency,
  DraftDependencyKind,
  DraftFinding,
  DraftReport,
} from './draft.js';

// Topo validation
export { validateTopo } from './validate-topo.js';
export type { TopoIssue } from './validate-topo.js';
export { validateEstablishedTopo } from './validate-established-topo.js';

// Layer
export { composeLayers } from './layer.js';
export type { Layer } from './layer.js';

// Derive
export { deriveCliPath, deriveFields } from './derive.js';
export type { Field, FieldOverride } from './derive.js';

// Cross schema
export { buildCrossValidationSchema } from './cross-schema.js';

// Execute
export { executeTrail } from './execute.js';
export type { ExecuteTrailOptions } from './execute.js';

// Intrinsic tracing
export {
  clearTraceSink,
  createTraceRecord,
  getTraceContext,
  getTraceSink,
  NOOP_SINK,
  registerTraceSink,
  TRACE_CONTEXT_KEY,
} from './internal/tracing.js';
export type {
  TraceContext,
  TraceRecord,
  TraceSink,
} from './internal/tracing.js';
export type { TraceFn } from './types.js';

// Run
export { run } from './run.js';
export type { RunOptions } from './run.js';

// Trail factories
export { deriveTrail, ingest } from './trails/index.js';
export type {
  DeriveTrailInput,
  DeriveTrailOperation,
  DeriveTrailOutput,
  DeriveTrailSpec,
  IngestOptions,
  IngestTransform,
} from './trails/index.js';

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
  deriveBackoffDelay,
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
  deriveIdHash,
} from './branded.js';
export type {
  Branded,
  UUID,
  Email,
  NonEmptyString,
  PositiveInt,
} from './branded.js';

// Path Security
export { securePath, isPathSafe, deriveSafePath } from './path-security.js';

// Workspace
export {
  findWorkspaceRoot,
  isInsideWorkspace,
  deriveRelativePath,
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
