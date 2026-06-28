# Trails API Reference

Canonical public surface-facing reference. For naming conventions and decision history, see [ADR-0001](./adr/0001-naming-conventions.md).

---

## `@ontrails/core`

```typescript
// Definitions
trail(id, spec)                    // define a unit of work (with optional composes for composition)
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
openReadTrailsDb(options?), openWriteTrailsDb(options?), ensureSubsystemSchema(db, options)
deriveTrailsDir(options?), deriveTrailsDbPath(options?), deriveTrailsStateDir(options?)
deriveTrailsStateHome(options?), deriveTrailsProjectKey(options?)
// topo-store API (createTopoStore, createMockTopoStore, topoStore, snapshot helpers, etc.)
// has moved to @ontrails/topographer per ADR-0042. See that section below.

// Types
Trail<I, O>, Signal<T>, ScheduleSource, WebhookSource<T>, Contour<TName, TShape, TIdentity>, Resource<T>, Topo, Intent
ObserveConfig, ObserveInput, LogSink, TraceSink
TrailSpec<I, O>, SignalSpec<T>, ScheduleSpec, WebhookSpec<T>, ResourceSpec<T>, TrailExample<I, O>
AnyTrail, AnySignal, AnyContour, AnyResource, ResourceContext, ResourceOverrideMap
BlobRef, BlobRefDescriptor
ContourOptions, ContourIdBrand, ContourIdMetadata, ContourIdSchema, ContourIdValue, ContourReference
TrailsDbLocationOptions, EnsureSubsystemSchemaOptions
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
TrailsError, ValidationError, NotFoundError, VersionNotSupportedError, AlreadyExistsError,
ConflictError, PermissionError, PermitError, AuthError, TimeoutError,
RateLimitError, NetworkError, InternalError, DerivationError,
RecoverableCompletionError, CancelledError, AmbiguousError, AssertionError,
RetryExhaustedError
ErrorCategory, isTrailsError(value?), isRetryable(error)
mapSurfaceError(surface, error), projectSurfaceError(surface, error)
projectErrorClassSurface(surface, errorName)

// Implementation & context
Implementation<I, O>              // (input, ctx) => Result | Promise<Result>
TrailContext, createTrailContext(overrides?)
SURFACE_KEY                        // invoking surface extension key
ComposeFn, ResourceLookup, ProgressCallback, ProgressEvent, Logger
normalizeComposeBatchConcurrency(options?), createComposeBatchValidationResults(calls, error)
claimNextComposeBatchIndex(counter, calls)

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

Current shipped surface packages are `@ontrails/cli`, `@ontrails/commander`, `@ontrails/mcp`, `@ontrails/http`, and `@ontrails/hono`. A WebSocket surface is planned but has no public package or API yet.

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
```

## `@ontrails/commander`

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

## `@ontrails/http/fetch`

```typescript
createRouteHandler(route, options?)    // materialize one Web Fetch Request -> Response handler
createFetchHandler(graph, options?)    // materialize a full topo Web Fetch dispatcher

CreateRouteHandlerOptions, CreateFetchHandlerOptions
```

The fetch kernel owns query/body parsing, content-length checks, public HTTP error projection, diagnostics, request ID/header forwarding, abort propagation, and webhook verification/parsing semantics for HTTP bindings.

## `@ontrails/http/bun`

```typescript
createApp(graph, options?)             // create Bun routes + fetch fallback + onError handler
surface(graph, options?)               // serve the topo with Bun.serve()

BunHttpApp, CreateAppOptions, SurfaceHttpResult
```

Use this subpath for Bun-native serving without Hono or another third-party HTTP framework.

## `@ontrails/hono`

```typescript
surface(graph, options?)               // one-liner: create and serve Hono app; returns close handle + url
createApp(graph, options?)             // create a Hono app without serving

CreateAppOptions, SurfaceHttpResult
```

## `@ontrails/topographer`

These are programmatic Topographer APIs for deriving, hashing, diffing, reading, and writing TopoGraph artifacts. App authors usually run the artifact lifecycle through the top-level CLI commands instead: `trails compile`, `trails validate`, and `trails diff`. The package does not expose a separate CLI binary, and retired `trails topo compile` / `trails topo verify` / `trails topo check` forms are not aliases.

```typescript
// TopoGraph and lock artifact helpers
deriveTopoGraph(graph), deriveTopoGraphHash(topoGraph), deriveTopoGraphDiff(before, after)
writeTrailsLock(lock, options?), readTrailsLock(options?)
readTopoGraph(options?), readWorkspaceTrailIndex(options?)
writeTopoGraph(topoGraph, options?), writeLockManifest(manifest, options?), readLockManifest(options?) // legacy beta artifact-family helpers

// Topo store (durable graph substrate; relocated from @ontrails/core per ADR-0042)
createTopoStore(options?), createMockTopoStore(seed?), topoStore
createTopoSnapshot(topo, options?), listTopoSnapshots(options?)
pinTopoSnapshot(id, name, options?), unpinTopoSnapshot(nameOrId, options?)
TOPO_STORE_SCHEMA_VERSION

TopoGraph, TopoGraphEntry, TopoGraphContourReference, TrailsLock, LockManifest, DiffResult, DiffEntry, JsonSchema
WriteOptions, ReadOptions
ReadOnlyTopoStore, MockTopoStoreSeed, TopoSnapshot, TopoStoreRef
TopoStoreActivationContextRecord, TopoStoreExportRecord, TopoStoreResourceRecord
TopoStoreSurfaceProjectionRecord, TopoStoreTrailRecord, TopoStoreTrailDetailRecord
CreateTopoSnapshotInput, ListTopoSnapshotsOptions
```

### `@ontrails/topographer/backend-support`

```typescript
createStoredTopoSnapshot(db, topo, input?), getStoredTopoExport(db, snapshotId)
countTopoSnapshots(db), countPinnedSnapshots(db), countPrunableSnapshots(db, options?)
pruneUnpinnedSnapshots(db, options?)

StoredTopoExport
```

## `@ontrails/wayfinder`

These are cold read trails and helpers for querying saved graph artifacts and package-level authoring evidence. Graph queries read root `trails.lock` and topo-store records; adapter queries read `@ontrails/adapter-kit` package and conformance evidence. They do not boot apps, resolve resources, reach the network, or mutate local state.

```typescript
// Graph-read topo and query trails
wayfinderTopo
wayfindOverviewTrail, wayfindSearchTrail
wayfindTrailsTrail, wayfindContoursTrail, wayfindResourcesTrail, wayfindSignalsTrail
wayfindSurfacesTrail, wayfindFacetsTrail, wayfindVersionsTrail, wayfindExamplesTrail
wayfindErrorsTrail, wayfindAdaptersTrail
wayfindDescribeTrail, wayfindContractTrail, wayfindNearbyTrail, wayfindImpactTrail
wayfindOutlineTrail, wayfindDiffTrail

// Artifact loading, provenance, and typed filters
loadWayfinderArtifacts, wayfinderTopoGraphSource, wayfinderTopoStoreSource
wayfinderFact
createWayfinderFilterContext, createWayfinderEntityPredicate
createWayfinderGraphEntityPredicate, filterWayfinderEntityRefs, listWayfinderEntityRefs
wayfinderEntityFilterSchema, wayfinderEntityKindSchema, wayfinderIntentSchema

WayfinderArtifactLoad, WayfinderArtifactLoaderOptions, WayfinderTopoStoreLoad
WayfinderArtifactKind, WayfinderArtifactSource, WayfinderContractRef
WayfinderFact, WayfinderFactCategory, WayfinderFreshness
WayfinderFreshnessFresh, WayfinderFreshnessMissing
WayfinderFreshnessSchemaVersionDrift, WayfinderFreshnessStale, WayfinderStaleReason
WayfinderEntityFilters, WayfinderEntityFilterInput, WayfinderEntityKind
WayfinderEntityRef, WayfinderFilterContext, WayfinderIntent
OutlineFeature, OutlineInput, OutlineOutput, OutlineView
```

Wayfinder trails are internal by default. Surface hosts expose selected query trails deliberately, usually by exact trail ID for operator tooling.

## `@ontrails/store`

```typescript
store(tables)                      // backend-agnostic store definition
crudOperations                     // canonical create/read/update/delete/list order
crudAccessorExpectations           // canonical accessor methods/fallbacks per CRUD operation
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

// `versioned: true` on a store table adds a framework-managed integer `version`
// field to returned entities and allows `upsert()` optimistic concurrency.
// writable store resources fire canonical scoped signals when accessed through `db.from(ctx)`.
```

### `@ontrails/store/trails`

```typescript
crud(table, resource, options?)        // derive create/read/update/delete/list trails
sync(options)                          // copy one source entity into a target store table
reconcile(options)                     // upsert a versioned entity with conflict recovery

CrudTrails<T>, CrudOptions<T>, CrudBlazeOverrides<T>
SyncEndpoint<T, C>, SyncOptions<TSource, TTarget, TSourceConnection, TTargetConnection>
SyncTransform<TSource, TTarget>
ReconcileConflict<T>, ReconcileOptions<T, C>, ReconcileStrategy<T>
CrudOperation, CrudAccessorExpectation
```

### `@ontrails/store/adapter-support`

```typescript
bindStoreDefinition(definition, scope) // bind derived store signals to a resource scope
createStoreTableSignals(tableName, payload), composeStoreSignalId(scope, tableName, change)
isValidResourceId(resourceId)

StoreSignalChange
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
testComposes(trail, scenarios, options?)
testContracts(topo, ctxOrFactory?), testDetours(topo)

// Assertion helpers
expectOk(result), expectErr(result)
assertFullMatch(result, expected), assertSchemaMatch(result, schema)
assertErrorMatch(result, errorClass)

// Factories
createTestContext(options?), createTestLogger()
createComposeContext(options?)       // minimal context for testing trail composition via ctx.compose()

TestExecutionOptions, TestComposeOptions
TestScenario, ComposeScenario, TestLogger, TestTrailContextOptions
```

Surface harnesses and all-surface validation live on explicit subpaths so the root contract-testing import path does not require CLI, MCP, or HTTP peers:

```typescript
// @ontrails/testing/cli
createCliHarness(options: { graph: Topo })
CliHarness, CliHarnessOptions, CliHarnessResult

// @ontrails/testing/mcp
createMcpHarness(options: { graph: Topo })
McpHarness, McpHarnessOptions, McpHarnessResult

// @ontrails/testing/http
createHttpHarness(options: { graph: Topo })
HttpHarness, HttpHarnessOptions, HttpHarnessResult

// @ontrails/testing/established
testAllEstablished(topo, optionsOrFactory?)
TestAllEstablishedOptions

// @ontrails/testing/surface-parity
testSurfaceParity(topo, options?), runSurfaceParityExample(...)
SurfaceParityOptions, SurfaceParityComparison
```

## `@ontrails/warden`

```typescript
// Main runtime
runWarden(options?), formatWardenReport(report), checkDrift(rootDir, topo?)
// WardenOptions includes optional tier: source-static | project-static | topo-aware | drift | advisory
// WardenOptions includes projectRules: false for embedders that opt out of project-local rules
loadProjectWardenRules(rootDir)    // load .trails/rules.ts or direct .trails/rules/*.ts modules

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
parse(filePath, sourceCode), parseWithDiagnostics(filePath, sourceCode)
walk(ast, visitor), walkScope(ast, visitor)
walkWithParents(ast, visitor), walkWithScopeContext(ast, visitor)
offsetToLine(source, offset), offsetToLineColumn(source, offset)
createSourceEdit(start, end, replacement)
validateSourceEdits(edits), applySourceEdits(source, edits)
findTrailDefinitions(ast), findBlazeBodies(node)
findContourDefinitions(ast, context?, options?), isBlazeCall(node)
findStringLiterals(ast, predicate?), isStringLiteral(node), getStringValue(node)

AstNode, TrailDefinition, ContourDefinition, FindContourDefinitionsOptions
FrameworkNamespaceContext, StringLiteralMatch
AstParentContext, AstScopeContext, AstScopeDeclaration
AstParseResult, AstParseDiagnostic, SourceEdit, SourceLocation
```

## `@ontrails/regrade`

```typescript
// Downstream migration reporting and safe rewrites
runRegrade({ root, classes, selection?, collection?, apply?, includeEntries? }) // Result<RegradeReport | null, InternalError>
runVocabularyRegrade({ root, plan, apply?, includeEntries? }) // Result<RegradeReport | null, Error>
buildRegradeReport({ root, files, skipped, classes, selection?, includeEntries? })
selectRegradeClasses(classes, selection?)

// Built-in Warden-backed migration classes
loadWardenTermRewriteClasses(root?)
wardenTermRewriteClasses
createWardenTermRewriteClass(rule)
createTermRewriteClass({ from, to, id?, describe? })

// AST-backed class builders
createAstRewriteClass({ id, describe, shouldScan?, visit })
createAstIdentifierRenameClass({ from, to, id?, describe?, reviewDeclarationTypes? })

// Schemas
regradeReportOutput
vocabularyRegradePlanSchema, vocabularyRegradeRunOutput
literalRegradeTopo, literalRegradeTrail

// Types
RegradeClass, RegradeClassResult, RegradeReport, RegradeReportEntry
RegradeReviewDetail, RegradeReviewSpan, RegradeScanTargets, RegradeSelection
RegradeScanDirectoryBucket, RegradeScanExtensionBucket, RegradeScanSummary
VocabularyRegradePlan, VocabularyRunLedger, VocabularyRunReport
```

Regrade reports always include full aggregate counts, unknown class IDs, scan statistics, and skip reasons. Report `entries` default to actionable rewrite and review outcomes; pass `includeEntries: 'all'` to include no-op and skip entries. The `scan` block summarizes matched, scanned, and skipped files, then groups matched files by extension and top-level path segment; vocabulary reports include occurrence counts in those buckets. Vocabulary regrade runs add a `run` block with the authored plan, observed form and occurrence ledger, and projected completion gate so CLI and MCP callers can see what was modified, skipped, or deferred with an `open` count. Vocabulary plans can also carry `scope.ignore` path globs, exposed as `trails regrade --ignore <glob>`, to keep migration scope away from local notes, scratch space, generated state, or other paths that should not be scanned for that transition.

## `@ontrails/config`

```typescript
// Schema & resolution
defineConfig(options)                // define a config schema with base, profiles, and extensions
appConfig(name, options)             // lower-level config factory without Trails conventions

// Trails conventions
findTrailsConfigModulePath(options)  // locate root trails.config.*
findTrailsLocalConfigModulePath(rootDir) // locate root trails.config.local.*
findTrailsProjectRoot(options?)      // walk upward to a project root marker
resolveTrailsProjectRoot(options?)   // explicit root or discovered/fallback root

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
// Resource
authResource                         // resource for auth adapter lifecycle
                                     // (permit scope enforcement is intrinsic to executeTrail)

// Permits
getPermit(ctx)                       // extract the resolved permit from context
Permit                               // { id, scopes, roles?, tenantId?, metadata? }
PermitExtractionInput                // surface-agnostic auth input

// Adapters
AuthAdapter                          // interface: authenticate(input) -> Result<Permit | null>
// The root also re-exports JWT adapter names for convenience.
// Prefer the @ontrails/permits/jwt subpath for JWT adapter imports.

// Trail definitions
authVerify                           // verify a bearer token and return a permit

// Governance
validatePermits(trails)              // check trails against permit governance rules
PermitDiagnostic
```

### `@ontrails/permits/jwt`

```typescript
createJwtAdapter(options)            // built-in HS256 JWT adapter
JwtAlgorithm, JwtAdapterOptions
```

## `@ontrails/permits/testing`

```typescript
createTestPermit(overrides?)         // create a permit for tests
createPermitForTrail(trail)          // create a permit matching a trail's requirements
```

## `@ontrails/observe`

```typescript
// Log and trace sink contracts
LogLevel, LogRecord, Logger, LogSink, LogFormatter
TraceRecord, TraceContext, TraceSink
ObserveCapabilities, ObserveConfig, ObserveInput

// Sink composition
combine(...sinks)                    // compose log and trace sink contracts

// Built-in sinks and formatters
createConsoleSink(options?)          // write log records to console output
createFileSink(options)              // append log records to a file
createMemorySink(options?)           // bounded in-memory trace sink
createBoundedMemorySink(options?)    // explicit alias for createMemorySink
createJsonFormatter()                // JSON log formatter
createPrettyFormatter(options?)      // human-readable log formatter
renderTraceTree(records)             // render trace records as a tree

CombinedSink, ConsoleSinkOptions, FileSinkOptions, FileLogSink, FileSinkConfig
MemorySinkOptions, MemoryTraceSink, PrettyFormatterOptions
```

## `@ontrails/logtape`

```typescript
createLogtapeSink({ logger })         // forward observe LogRecord values to a LogTape-shaped logger

LogtapeLoggerLike, LogtapeSinkOptions
```

## `@ontrails/pino`

```typescript
createPinoSink(logger, options?)       // forward observe LogRecord values to a Pino-shaped logger

PinoLogMethod, PinoLoggerLike, PinoSinkOptions
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

// Compatibility/local testing sinks (implemented by @ontrails/tracing; prefer @ontrails/observe for new sink usage)
createMemorySink(options?)           // bounded in-memory sink for testing
createBoundedMemorySink(options?)    // explicit alias for createMemorySink
createDevStore(options?)             // SQLite-backed persistent sink for development
registerTraceStore(store)            // expose a store to tracing query/status trails
registerTracingState(state)          // bootstrap full tracing state
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

For v1, OpenTelemetry trace export lives at `@ontrails/tracing/otel`; there is no standalone `@ontrails/otel` package. Use `@ontrails/pino` separately for Pino-shaped log forwarding.

## `@ontrails/tracing/otel`

`@ontrails/tracing/otel` is the v1 OpenTelemetry adapter home. It translates Trails-native `TraceRecord` values outward and does not require an OpenTelemetry SDK runtime dependency.

```typescript
createOtelAdapter(options)           // create a TraceSink with explicit flush()

OtelAdapterOptions                   // { exporter, batchSize? }
OtelExporter                         // (spans: readonly OtelSpan[]) => void | Promise<void>
OtelSink                             // TraceSink plus flush()
OtelSpan                             // OTel-shaped span record
```

The adapter emits stable `trails.*` attributes for trace identity, lineage, trail IDs, intent, surface, permits, status, timing, signal lifecycle, and activation boundaries. Custom primitive attrs are forwarded only when they are safe and cannot override stable `trails.*` fields. Call `sink.flush()` during shutdown after the app stops accepting work; failed exporter batches remain buffered for retry.

## Reserved

| Name | Intent |
| --- | --- |
| `trailblaze(topo, options?)` | Future hosted runtime; not shipped |
| `trailhead()` | Historical boundary API retired in favor of `surface()` |
| `scout` | Agent-side runtime discovery |
| `validateExample`, `validateCompose` | Contract verification family |
| `generateDocs`, `generateOpenApi`, `generateLlmsTxt` | Build-time doc generation |
| `deriveMocks`, `deriveExamples` | Schema-derived test data |
