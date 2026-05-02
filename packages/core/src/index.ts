// Result
export { Result, resultAccessorNames } from './result.js';
export type { ResultAccessorName } from './result.js';

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
  codesByCategory,
  errorClasses,
  errorCategories,
  exitCodeMap,
  statusCodeMap,
  jsonRpcCodeMap,
  retryableMap,
  RetryExhaustedError,
  isRetryable,
  isTrailsError,
} from './errors.js';
export type {
  DynamicErrorClassRegistryEntry,
  ErrorCategory,
  ErrorCategoryCodes,
  ErrorClassConstructor,
  ErrorClassRegistryEntry,
  FixedErrorClassRegistryEntry,
} from './errors.js';
export {
  createSurfaceErrorMapper,
  createTransportErrorMapper,
  mapSurfaceError,
  mapTransportError,
  projectErrorClassSurface,
  projectSurfaceError,
  surfaceErrorMap,
  surfaceErrorRegistry,
  surfaceNames,
  transportErrorMap,
  transportErrorRegistry,
  transportNames,
} from './transport-error-map.js';
export type {
  ErrorClassSurfaceProjection,
  MapTransportError,
  SurfaceErrorCode,
  SurfaceErrorMapper,
  SurfaceErrorMappings,
  SurfaceErrorProjection,
  SurfaceName,
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
export { SURFACE_KEY, TRAILHEAD_KEY } from './types.js';

// Context factory
export { createTrailContext, passthroughTrace } from './context.js';

// Resource
export {
  createResourceLookup,
  findDuplicateResourceId,
  isResource,
  resource,
} from './resource.js';
export { drainResources } from './resource-config.js';
export type { ResourceDrainReport } from './resource-config.js';
export type {
  AnyResource,
  Resource,
  ResourceContext,
  ResourceOverrideMap,
  ResourceSpec,
} from './resource.js';

// Trail
export {
  activationSourceKinds,
  isActivationEntrySpec,
  isActivationSource,
  isKnownActivationSourceKind,
} from './activation-source.js';
export type {
  ActivationEntry,
  ActivationEntrySpec,
  ActivationSource,
  ActivationSourceKind,
  ActivationSourceMeta,
  ActivationSourceRef,
  ActivationWhere,
  ActivationWhereExample,
  ActivationWherePredicate,
  ActivationWhereSpec,
  BuiltinActivationSourceKind,
} from './activation-source.js';
export { intentValues, trail } from './trail.js';
export type {
  AnyTrail,
  BlazeInput,
  Intent,
  Trail,
  TrailSpec,
  TrailExample,
  TrailExampleSignalAssertion,
  TrailVisibility,
} from './trail.js';
export {
  filterSurfaceTrails,
  matchesTrailPattern,
  shouldIncludeTrailForSurface,
} from './surface-filter.js';
export type { SurfaceFilterOptions } from './surface-filter.js';
export {
  shouldValidateSurfaceTopo,
  validateSurfaceTopo,
  withSurfaceMarker,
} from './surface-derivation.js';
export type {
  BaseSurfaceOptions,
  SurfaceConfigValues,
  SurfaceSelectionOptions,
  SurfaceMarkedContext,
  SurfaceValidationOptions,
} from './surface-derivation.js';
export {
  deriveStructuredSignalExamples,
  deriveStructuredTrailExamples,
} from './structured-examples.js';
export type {
  StructuredSignalExample,
  StructuredSignalExampleProvenance,
  StructuredTrailExample,
  StructuredTrailExampleKind,
  StructuredTrailExampleProvenance,
  StructuredTrailExampleSignalAssertion,
} from './structured-examples.js';

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
export {
  SIGNAL_DIAGNOSTICS_SINK_KEY,
  SIGNAL_DIAGNOSTICS_STRICT_MODE_KEY,
  createSignalFireSuppressedDiagnostic,
  createSignalHandlerFailedDiagnostic,
  createSignalHandlerRejectedDiagnostic,
  createSignalInvalidDiagnostic,
  createSignalUnknownDiagnostic,
  recordSignalDiagnostic,
  shouldPromoteSignalDiagnostic,
  signalDiagnosticDefinitions,
  summarizeSignalPayload,
} from './signal-diagnostics.js';
export type {
  CreateSignalFireSuppressedDiagnosticInput,
  CreateSignalHandlerDiagnosticInput,
  CreateSignalInvalidDiagnosticInput,
  SignalDiagnostic,
  SignalDiagnosticCategory,
  SignalDiagnosticCause,
  SignalDiagnosticCode,
  SignalDiagnosticCommonInput,
  SignalDiagnosticContext,
  SignalDiagnosticLevel,
  SignalDiagnosticPathSegment,
  SignalDiagnosticRecordResult,
  SignalDiagnosticSchemaIssue,
  SignalDiagnosticSink,
  SignalDiagnosticOrigin,
  SignalDiagnosticSourceLocation,
  SignalDiagnosticStrictMode,
  SignalFireSuppressedDiagnostic,
  SignalHandlerFailedDiagnostic,
  SignalHandlerRejectedDiagnostic,
  SignalInvalidDiagnostic,
  SignalPayloadShape,
  SignalPayloadSummary,
  SignalUnknownDiagnostic,
} from './signal-diagnostics.js';
export {
  attachLateBoundSignalRef,
  cloneSignalWithId,
  createLateBoundSignalMarker,
  getLateBoundSignalRef,
  parseLateBoundSignalMarker,
} from './internal/signal-ref.js';
export type {
  LateBoundSignalMarker,
  LateBoundSignalRef,
} from './internal/signal-ref.js';

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
export {
  countPinnedSnapshots,
  countPrunableSnapshots,
  countTopoSnapshots,
  pruneUnpinnedSnapshots,
} from './internal/topo-snapshots.js';
export {
  createTopoSnapshot as createStoredTopoSnapshot,
  getStoredTopoExport,
} from './internal/topo-store.js';
export type { StoredTopoExport } from './internal/topo-store.js';
export {
  deriveTrailsDbPath,
  deriveTrailsDir,
  ensureSubsystemSchema,
  openReadTrailsDb,
  openWriteTrailsDb,
} from './internal/trails-db.js';
export type {
  EnsureSubsystemSchemaOptions,
  TrailsDbLocationOptions,
} from './internal/trails-db.js';

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
export {
  claimNextCrossBatchIndex,
  createCrossBatchValidationResults,
  normalizeCrossBatchConcurrency,
} from './internal/cross-batch.js';

// Execute
export { DETOUR_MAX_ATTEMPTS_CAP } from './detours.js';
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
export {
  stripDefaultWrappers,
  stripDefaultsFromShape,
} from './internal/zod-wrappers.js';

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
export {
  BLOB_REF_SCHEMA_META_KEY,
  blobRefDescriptorSchema,
  blobRefJsonSchema,
  blobRefSchema,
  createBlobRef,
  isBlobRef,
  toBlobRefDescriptor,
} from './blob-ref.js';
export type { BlobRef, BlobRefDescriptor } from './blob-ref.js';

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
