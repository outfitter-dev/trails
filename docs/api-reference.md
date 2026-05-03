# Trails API Reference

Canonical public surface-facing reference. For naming conventions and decision history, see [ADR-0001](./adr/0001-naming-conventions.md).

---

## `@ontrails/core`

```typescript
// Definitions
trail(id, spec)                    // define a unit of work (with optional crosses for composition)
signal(id, spec)                    // define a payload schema with provenance
schedule(id, spec)                  // define an inert cron activation source
webhook(id, spec)                   // define an inert HTTP webhook activation source
contour(name, shape, options)       // define a first-class domain object with identity metadata
resource(id, spec)                  // define a first-class resource dependency
createResourceLookup(getContext)   // bind ctx.resource() to a specific context snapshot
drainResources(resources, ctx, configValues?) // evict and dispose cached resource singletons
topo(name, ...modules, options?)   // assemble trails, contours, signals, resources, and optional observe sinks
intentValues                       // owner-held runtime vocabulary for trail intent
blobRefSchema, createBlobRef(...)  // declare and create binary output references
// Topo methods: .get(id), .has(id), .list(), .listSignals(), .ids(), .count
//               .getContour(name), .hasContour(name), .listContours(), .contourIds(), .contourCount
//               .getResource(id), .hasResource(id), .listResources(), .resourceIds(), .resourceCount
createTopoStore(options?), createMockTopoStore(seed?), topoStore
createStoredTopoSnapshot(db, topo, input?), getStoredTopoExport(db, snapshotId)
openReadTrailsDb(options?), openWriteTrailsDb(options?), ensureSubsystemSchema(db, options)
deriveTrailsDir(options?), deriveTrailsDbPath(options?)
countTopoSnapshots(db), countPinnedSnapshots(db), countPrunableSnapshots(db, options?)
pruneUnpinnedSnapshots(db, options?)

// Types
Trail<I, O>, Signal<T>, ScheduleSource, WebhookSource<T>, Contour<TName, TShape, TIdentity>, Resource<T>, Topo, Intent
ObserveConfig, ObserveInput, LogSink, TraceSink
TrailSpec<I, O>, SignalSpec<T>, ScheduleSpec, WebhookSpec<T>, ResourceSpec<T>, TrailExample<I, O>
AnyTrail, AnySignal, AnyContour, AnyResource, ResourceContext, ResourceOverrideMap
BlobRef, BlobRefDescriptor
ContourOptions, ContourIdBrand, ContourIdMetadata, ContourIdSchema, ContourIdValue, ContourReference
StoredTopoExport, TrailsDbLocationOptions, EnsureSubsystemSchemaOptions
ActivationSource, ActivationEntry, ActivationProvenance
WebhookMethod, WebhookVerify, WebhookVerifyRequest, WebhookVerifyHeaders, WebhookValidationIssue

// Type utilities
TrailInput<T>                      // extract input type from a Trail
TrailOutput<T>                     // extract output type from a Trail
TrailResult<T>                     // extract Result<Output, Error> from a Trail
inputOf(trail)                     // get the input Zod schema
outputOf(trail)                    // get the output Zod schema (or undefined)
getContourIdMetadata(schema)       // read runtime contour identity metadata from a branded schema
getContourReferences(contour)      // read structural contour references declared inside a contour

// Result
Result<T, E>
resultAccessorNames                // canonical Result instance accessors used by Warden
Result.ok(value?), Result.err(error), Result.combine(results)
Result.fromFetch(url, opts?), Result.fromJson(string), Result.toJson(value)

// Error taxonomy
TrailsError, ValidationError, NotFoundError, AlreadyExistsError,
ConflictError, PermissionError, AuthError, TimeoutError, RateLimitError,
NetworkError, InternalError, DerivationError, CancelledError, AmbiguousError,
AssertionError, RetryExhaustedError
ErrorCategory, isTrailsError(value?), isRetryable(error)
mapSurfaceError(surface, error), projectSurfaceError(surface, error)
projectErrorClassSurface(surface, errorName)
mapTransportError(surface, error)       // deprecated compatibility alias

// Implementation & context
Implementation<I, O>              // (input, ctx) => Result | Promise<Result>
TrailContext, createTrailContext(overrides?)
SURFACE_KEY                        // invoking surface extension key
TRAILHEAD_KEY                      // deprecated compatibility alias for SURFACE_KEY
CrossFn, ResourceLookup, ProgressCallback, ProgressEvent, Logger
normalizeCrossBatchConcurrency(options?), createCrossBatchValidationResults(calls, error)
claimNextCrossBatchIndex(counter, calls)

// Execution pipeline
DETOUR_MAX_ATTEMPTS_CAP
executeTrail(trail, rawInput, options?) // validate → resolve context → resolve resources → compose layers → run
run(topo, id, input, options?)    // look up and execute a trail by ID; accepts ctx/resource overrides
RunOptions

// Execution layers (pipeline utility, not a v1 graph primitive)
Layer                               // wrap(trail, implementation) → implementation
composeLayers(layers, trail, implementation)

// Validation
validateInput(schema, data)        // → Result<T, ValidationError>
validateOutput(schema, data)       // → Result<T, ValidationError>
stripDefaultWrappers(schema), stripDefaultsFromShape(schema)
validateTopo(topo)                 // → Result<void, ValidationError>; called by testAll()
validateEstablishedTopo(topo)      // → Result<void, ValidationError>; rejects draft-contaminated outputs
TopoIssue

// Schema derivation
deriveFields(schema, overrides?)   // → Field[] (faithfully representable fields only)
deriveCliPath(trailId)             // trail ID → hierarchical CLI command path
Field, FieldOverride

// Surface derivation
validateSurfaceTopo(topo, options?) // shared established-topo guard for surface projections
withSurfaceMarker(surface, ctx?)    // merge a surface marker into execution context extensions
BaseSurfaceOptions, SurfaceSelectionOptions, SurfaceValidationOptions, SurfaceConfigValues

// Webhook activation sources
webhookMethods
validateWebhookSource(source)       // validate method/path/parse/verify shape
verifyWebhookRequest(source, request) // run an optional source verify hook
getWebhookHeader(request, name)     // case-insensitive helper for verify hooks

// Draft state
DRAFT_ID_PREFIX, isDraftId(value), deriveDraftReport(topo)
validateDraftFreeTopo(topo)        // reject draft-contaminated IDs and schemas

// Resilience
retry(fn, options?), withTimeout(fn, ms, signal?), RetryOptions

// Branded types
brand, unbrand, uuid, email, nonEmptyString, positiveInt, shortId, deriveIdHash
Branded<T, Tag>, UUID, Email, NonEmptyString, PositiveInt

// Guards
isDefined, isNonEmptyString, isPlainObject, hasProperty, assertNever
isNonEmptyArray, NonEmptyArray<T>

// Collections & utilities
chunk(arr, size), dedupe(arr, key?), groupBy(arr, key), sortBy(arr, key)
DeepPartial<T>, Prettify<T>, AtLeastOne<T>

// Serialization
serializeError(error), deserializeError(data)
SerializedError, zodToJsonSchema(schema)

// Path security & workspace
securePath, isPathSafe, deriveSafePath
findWorkspaceRoot, isInsideWorkspace, deriveRelativePath
```

## `@ontrails/core/trails`

```typescript
deriveTrail(contour, operation, spec) // derive CRUD-shaped trail contract pieces from a contour

DeriveTrailOperation                  // 'create' | 'read' | 'update' | 'delete' | 'list'
DeriveTrailInput<TContour, TOp, TGenerated>
DeriveTrailOutput<TContour, TOp>
DeriveTrailSpec<TContour, TOp, TGenerated>
```

## `@ontrails/cli`

Current shipped surface packages are `@ontrails/cli`, `@ontrails/mcp`, `@ontrails/http`, and `@ontrails/hono`. A WebSocket surface is planned but has no public package or API yet.

```typescript
deriveCliCommands(graph, options?)     // projection: Result-returning command definitions
validateCliCommands(commands)          // validate command tree shape and collisions
deriveFlags(schema, overrides?)        // Zod → CLI flags
output(value, mode)                    // write to stdout in text/json/jsonl
deriveOutputMode(flags, topoName)      // determine output format from flags/topo-derived env

DeriveCliCommandsOptions, ActionResultContext, OutputMode
CliCommand, CliFlag, CliArg
outputModePreset(), cwdPreset(), dryRunPreset()
defaultOnResult(ctx), passthroughResolver, isInteractive(options?)
InputResolver, ResolveInputOptions
autoIterateLayer, dateShortcutsLayer
```

## `@ontrails/cli/commander`

```typescript
surface(graph, options?)               // one-liner: parse argv, execute, return exit code
createProgram(graph, options?)         // create a Commander program without parsing argv
toCommander(commands, options?)        // translate commands to Commander.js program

CreateProgramOptions, SurfaceCliResult, ToCommanderOptions
```

## `@ontrails/mcp`

```typescript
surface(graph, options?)               // one-liner: create server, connect stdio, return close handle
createServer(graph, options?)          // create an MCP server without connecting
deriveMcpTools(graph, options?)        // projection: Result-returning tool definitions
connectStdio(server)                   // connect a created server to stdio transport
deriveToolName(appName, trailId)       // tool name derivation
deriveAnnotations(trail)               // MCP annotations from intent, idempotency, and description
createMcpProgressCallback(extra)       // progress bridge

CreateServerOptions, DeriveMcpToolsOptions
McpToolDefinition,                     // includes trailId: string
McpToolResult, McpContent, McpExtra, McpAnnotations
```

## `@ontrails/http`

```typescript
deriveHttpRoutes(graph, options?)      // projection: route definitions without server; returns Result<HttpRouteDefinition[], Error>
deriveOpenApiSpec(graph, options?)     // OpenAPI 3.1 spec for the HTTP surface
deriveHttpMethod(intent)               // intent → HTTP method
deriveHttpOperationMethod(intent)      // intent → OpenAPI operation method
deriveHttpInputSource(method)          // HTTP method → input source
httpMethodByIntent

DeriveHttpRoutesOptions, HttpMethod, HttpOperationMethod, HttpRouteDefinition, InputSource
OpenApiOptions, OpenApiSpec, OpenApiServer
```

## `@ontrails/hono`

```typescript
surface(graph, options?)               // one-liner: create and serve Hono app; returns close handle + url
createApp(graph, options?)             // create a Hono app without serving

CreateAppOptions, SurfaceHttpResult
```

## `@ontrails/topographer`

```typescript
deriveSurfaceMap(graph), deriveSurfaceMapHash(map), deriveSurfaceMapDiff(before, after)
writeSurfaceMap(map, options?), readSurfaceMap(options?)
writeSurfaceLock(lock, options?), readSurfaceLockData(options?), readSurfaceLock(options?)

SurfaceMap, SurfaceMapEntry, SurfaceMapContourReference, SurfaceLock, DiffResult, DiffEntry, JsonSchema
WriteOptions, ReadOptions
```

## `@ontrails/store`

```typescript
store(tables)                      // connector-agnostic store definition
crudOperations                     // canonical create/read/update/delete/list order
crudAccessorExpectations           // canonical accessor methods/fallbacks per CRUD operation
bindStoreDefinition(definition, scope) // bind derived store signals to a resource scope
createStoreTableSignals(tableName, payload), composeStoreSignalId(scope, tableName, change)
isValidResourceId(resourceId)
// every normalized table exposes derived schemas and signals directly:
// table.schema          — normalized full entity schema
// table.insertSchema    — entity schema minus generated fields
// table.updateSchema    — partial update schema keyed by identity
// table.fixtureSchema   — fixture schema with generated fields optional
// table.signals.created | table.signals.updated | table.signals.removed
// pre-bind handles preserve shape; the canonical bound id is resource:table.change

StoreDefinition, StoreTable, StoreTableSignals, StoreTablesInput, StoreTableInput
EntityOf<T>, InsertOf<T>, UpdateOf<T>, UpsertOf<T>, FixtureInputOf<T>, FixtureOf<T>
FiltersOf<T>, StoreListOptions
StoreConnection<T>, StoreTableConnection<T>, ReadOnlyStoreConnection<T>
StoreAccessor<T>, StoreTableAccessor<T>, ReadOnlyStoreTableAccessor<T>
CrudOperation, CrudAccessorExpectation
StoreSignalChange

// `versioned: true` on a store table adds a framework-managed integer `version`
// field to returned entities and allows `upsert()` optimistic concurrency.
// writable store resources fire canonical scoped signals when accessed through `db.from(ctx)`.
```

## `@ontrails/store/testing`

```typescript
createStoreAccessorContractCases(options) // shared writable accessor contract cases

StoreAccessorContractOptions<T>, StoreAccessorContractSubject<T>
```

## `@ontrails/drizzle`

```typescript
connectDrizzle(definition, options?)         // bind a root store definition to a writable Drizzle resource
connectReadOnlyDrizzle(definition, options?) // bind a root store definition to a read-only Drizzle resource
binding.tables                               // expose raw derived Drizzle tables on the bound resource

DrizzleStoreOptions
DrizzleStoreResource, DrizzleStoreConnection, ReadOnlyDrizzleStoreConnection
DrizzleQueryContext, DrizzleStoreSchema
```

## `@ontrails/testing`

```typescript
// Test runners
testAll(topo, ctxOrFactory?)
testExamples(topo, ctxOrFactory?), testTrail(trail, scenarios, ctx?)
testCrosses(trail, scenarios, options?)
testContracts(topo, ctxOrFactory?), testDetours(topo)

// Assertion helpers
expectOk(result), expectErr(result)
assertFullMatch(result, expected), assertSchemaMatch(result, schema)
assertErrorMatch(result, errorClass)

// Factories
createTestContext(options?), createTestLogger()
createCrossContext(options?)       // minimal context for testing trail composition via ctx.cross()
createCliHarness(options: { graph: Topo }), createMcpHarness(options: { graph: Topo })

TestExecutionOptions, TestCrossOptions
TestScenario, CrossScenario, TestLogger, TestTrailContextOptions
CliHarness, CliHarnessOptions, CliHarnessResult
McpHarness, McpHarnessOptions, McpHarnessResult
```

## `@ontrails/warden`

```typescript
// Main runtime
runWarden(options?), formatWardenReport(report), checkDrift(rootDir, topo?)
// WardenOptions includes optional tier: source-static | project-static | topo-aware | drift | advisory

// Built-in registries and wrapped topo
wardenRules                        // ReadonlyMap<string, WardenRule> — built-in per-file rules (file-scoped and project-aware)
wardenTopoRules                    // ReadonlyMap<string, TopoAwareWardenRule> — built-in topo-aware rules
wardenTopo                         // pre-built Topo of all wrapped built-in warden rule trails

// Built-in rule metadata
builtinWardenRuleMetadata
getWardenRuleMetadata(ruleOrName), listWardenRuleMetadata()
wardenRuleTiers, wardenRuleScopes, wardenRuleLifecycleStates

// Trail runners
runWardenTrails(filePath, sourceCode, options?) // run file-scoped warden rules against a single file
runTopoAwareWardenTrails(topo)     // run built-in topo-aware warden rule trails once per topo

// Formatting helpers
formatGitHubAnnotations(report), formatJson(report), formatSummary(report)

// Cache controls for long-lived tooling
clearImplementationReturnsResultCache()

// Draft-state helpers
DRAFT_FILE_PREFIX, DRAFT_FILE_SEGMENT
isDraftMarkedFile(path), stripDraftFileMarkers(path)

// Trail-wrapping helpers and schemas
wrapRule({ rule, examples })
wrapTopoRule({ rule, examples })
ruleInput, projectAwareRuleInput, ruleOutput, topoAwareRuleInput, diagnosticSchema
<builtInRuleName>Trail             // built-in wrapped rule trails, e.g. noThrowInImplementationTrail

// Types
WardenOptions, WardenReport, WardenDiagnostic, WardenSeverity, DriftResult
ProjectAwareWardenRule, ProjectContext, TopoAwareWardenRule, WardenRule
WardenRuleMetadata, WardenRuleTier, WardenRuleScope, WardenRuleLifecycle
RuleInput, ProjectAwareRuleInput, RuleOutput, TopoAwareRuleInput
```

## `@ontrails/warden/ast`

```typescript
parse(filePath, sourceCode), walk(ast, visitor), offsetToLine(source, offset)
walkScope(ast, visitor)
findTrailDefinitions(ast), findBlazeBodies(node)
findContourDefinitions(ast, context?, options?), isBlazeCall(node)
findStringLiterals(ast, predicate?), isStringLiteral(node), getStringValue(node)

AstNode, TrailDefinition, ContourDefinition, FindContourDefinitionsOptions
FrameworkNamespaceContext, StringLiteralMatch
```

## `@ontrails/config`

```typescript
// Schema & resolution
defineConfig(options)                // define a config schema with base, profiles, and extensions
appConfig(name, options)             // lower-level config factory without Trails conventions

// Extensions
env(schema, envVar)                  // bind a schema field to an environment variable
secret(schema)                       // mark a field as sensitive (redacted in output)
deprecated(schema, message)          // mark a field as deprecated with migration guidance

// Resource
configResource                       // resource for resolved config state

// State management
registerConfigState(state)           // register resolved config at bootstrap
getConfigState()                     // read registered config state
clearConfigState()                   // clear global config state (for tests)

// Derivation helpers
deriveConfig(options?)               // resolve config values against schema + sources
deriveConfigFields(schema)           // field descriptions from the schema
deriveConfigProvenance(result)       // provenance by resolved field
deriveConfigEnvExample(schema)       // .env.example content from the schema
deriveConfigExample(schema, format?) // commented example config for TOML / YAML / JSON
deriveConfigJsonSchema(schema)       // JSON Schema Draft 2020-12 from the config schema

// Trail definitions
configCheck                          // validate config values against schema
configDescribe                       // describe all schema fields
configExplain                        // show which source won per field
configInit                           // generate example config files

DefineConfigOptions, ConfigState, ConfigFieldMeta, ConfigDiagnostic
```

## `@ontrails/permits`

```typescript
// Resource & layer
authResource                         // resource for auth connector lifecycle
authLayer                            // layer that enforces permit scopes on trails

// Permits
getPermit(ctx)                       // extract the resolved permit from context
Permit                               // { id, scopes, roles?, tenantId?, metadata? }
PermitExtractionInput                // surface-agnostic auth input

// Connectors
AuthConnector                        // interface: authenticate(input) → Result<Permit | null>
createJwtConnector(options)          // built-in HS256 JWT connector (from @ontrails/permits/jwt)

// Trail definitions
authVerify                           // verify a bearer token and return a permit

// Governance
validatePermits(trails)              // check trails against permit governance rules
PermitDiagnostic
```

## `@ontrails/permits/testing`

```typescript
createTestPermit(overrides?)         // create a permit for tests
createPermitForTrail(trail)          // create a permit matching a trail's requirements
```

## `@ontrails/tracing`

Tracing is intrinsic in `executeTrail`. With a real sink installed, a trail execution writes a root `TraceRecord`, `ctx.trace(label, fn)` writes child spans, typed signal fan-out records `signal.*` lifecycle entries, and activation materializers record `activation.*` boundary entries. With `NOOP_SINK`, `executeTrail` short-circuits the tracing allocation path and `ctx.trace(label, fn)` stays a passthrough.

```typescript
// Sink registration (from @ontrails/core and re-exported from @ontrails/tracing)
registerTraceSink(sink)              // install a sink for trace records
getTraceSink()                       // get the currently registered sink
clearTraceSink()                     // revert to the default no-op sink
NOOP_SINK                            // stable disabled-tracing sentinel
TRACE_CONTEXT_KEY                    // context extensions key for the active trace context
createTraceRecord(options)           // construct a root or child TraceRecord explicitly

// Activation boundary helpers (from @ontrails/core and re-exported from @ontrails/tracing)
createActivationTraceRecord(name, options?) // construct an activation boundary TraceRecord
writeActivationTraceRecord(name, attrs, status?, category?, parent?) // write an activation boundary TraceRecord

// Signal lifecycle helpers (from @ontrails/tracing)
createSignalTraceRecord(parent, name, attrs?) // construct a signal lifecycle TraceRecord
writeSignalTraceRecord(ctx, name, attrs, status?, category?) // write a signal lifecycle TraceRecord

// Sinks
createMemorySink(options?)           // bounded in-memory sink for testing
createBoundedMemorySink(options?)    // explicit alias for createMemorySink
createDevStore(options?)             // SQLite-backed persistent sink for development
createOtelConnector(options?)        // OpenTelemetry span exporter
toTraceStore(store)                  // read-only TraceStore view that does not own the writable connection
countTraceRecords(db), previewTraceCleanup(db, options?), applyTraceCleanup(db, options?)
withTraceStoreDb(options, run), ensureTraceSchema(db)
DEFAULT_MAX_RECORDS, DEFAULT_MAX_AGE

// Resource & trails
tracingResource                      // resource for tracing state
tracingStatus                        // trail: report tracing state and record count
tracingQuery                         // trail: query execution history with filters

// Context access (inside a trail blaze)
ctx.trace(label, fn)                 // record a nested span around fn
getTraceContext(ctx)                 // get current trace context
createChildTraceContext(parent)      // create a child trace context

// Sampling
shouldSample(intent, config?)        // sampling decision based on intent
DEFAULT_SAMPLING                     // default sampling rates by intent

TraceRecord, TraceSink, SamplingConfig, TraceContext, TraceFn, TraceCleanupReport
```

## `@ontrails/logging`

```typescript
createLogger(config?)
createConsoleSink(options?), createFileSink(options)
createJsonFormatter(), createPrettyFormatter(options?)
LEVEL_PRIORITY

LogLevel, LogRecord, LogMetadata, Logger, LoggerConfig
LogSink, LogFormatter
ConsoleSinkOptions, FileSinkOptions, PrettyFormatterOptions
```

---

## Reserved

| Name | Intent |
| --- | --- |
| `trailblaze(topo, options?)` | Future hosted runtime; not shipped |
| `trailhead` | Historical boundary term retired from active user-facing vocabulary |
| `scout` | Agent-side runtime discovery |
| `validateExample`, `validateCross` | Contract verification family |
| `generateDocs`, `generateOpenApi`, `generateLlmsTxt` | Build-time doc generation |
| `deriveMocks`, `deriveExamples` | Schema-derived test data |
