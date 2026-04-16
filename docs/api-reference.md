# Trails API Reference

Canonical public surface-facing reference. For naming conventions and decision history, see [ADR-0001](./adr/0001-naming-conventions.md).

---

## `@ontrails/core`

```typescript
// Definitions
trail(id, spec)                    // define a unit of work (with optional crosses for composition)
signal(id, spec)                    // define a payload schema with provenance
resource(id, spec)                  // define a first-class resource dependency
createResourceLookup(getContext)   // bind ctx.resource() to a specific context snapshot
topo(name, ...modules)             // assemble trails, signals, and resources into a queryable topology
// Topo methods: .get(id), .has(id), .list(), .listSignals(), .ids(), .count
//               .getResource(id), .hasResource(id), .listResources(), .resourceIds(), .resourceCount
createTopoStore(options?), createMockTopoStore(seed?), topoStore

// Types
Trail<I, O>, Signal<T>, Resource<T>, Topo, Intent
TrailSpec<I, O>, SignalSpec<T>, ResourceSpec<T>, TrailExample<I, O>
AnyTrail, AnySignal, AnyResource, ResourceContext, ResourceOverrideMap

// Type utilities
TrailInput<T>                      // extract input type from a Trail
TrailOutput<T>                     // extract output type from a Trail
TrailResult<T>                     // extract Result<Output, Error> from a Trail
inputOf(trail)                     // get the input Zod schema
outputOf(trail)                    // get the output Zod schema (or undefined)

// Result
Result<T, E>
Result.ok(value?), Result.err(error), Result.combine(results)
Result.fromFetch(url, opts?), Result.fromJson(string), Result.toJson(value)

// Error taxonomy
TrailsError, ValidationError, NotFoundError, AlreadyExistsError,
ConflictError, PermissionError, AuthError, TimeoutError, RateLimitError,
NetworkError, InternalError, CancelledError, AmbiguousError, AssertionError
ErrorCategory, isTrailsError(value?), isRetryable(error)

// Implementation & context
Implementation<I, O>              // (input, ctx) => Result | Promise<Result>
TrailContext, createTrailContext(overrides?)
CrossFn, ResourceLookup, ProgressCallback, ProgressEvent, Logger

// Execution pipeline
executeTrail(trail, rawInput, options?) // validate → resolve context → resolve resources → compose layers → run
run(topo, id, input, options?)    // look up and execute a trail by ID; accepts ctx/resource overrides
RunOptions

// Layers
Layer                               // wrap(trail, implementation) → implementation
composeLayers(layers, trail, implementation)

// Validation
validateInput(schema, data)        // → Result<T, ValidationError>
validateOutput(schema, data)       // → Result<T, ValidationError>
validateTopo(topo)                 // → Result<void, ValidationError>; called by testAll()
validateEstablishedTopo(topo)      // → Result<void, ValidationError>; rejects draft-contaminated outputs
TopoIssue

// Schema derivation
deriveFields(schema, overrides?)   // → Field[] (faithfully representable fields only)
deriveCliPath(trailId)             // trail ID → hierarchical CLI command path
Field, FieldOverride

// Draft state
DRAFT_ID_PREFIX, isDraftId(value), deriveDraftReport(topo)
validateDraftFreeTopo(topo)        // alias of validateEstablishedTopo

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

```typescript
surface(topo, options?)                // one-liner: parse argv, execute, return exit code
createProgram(topo, options?)          // create a Commander program without parsing argv
deriveCliCommands(topo, options?)      // projection: Result-returning command definitions
validateCliCommands(commands)          // validate command tree shape and collisions
toCommander(commands, options?)        // translate commands to Commander.js program
deriveFlags(schema, overrides?)        // Zod → CLI flags
output(value, mode)                    // write to stdout in text/json/jsonl
deriveOutputMode(flags, topoName)      // determine output format from flags/topo-derived env

CreateProgramOptions, DeriveCliCommandsOptions, ActionResultContext, OutputMode
CliCommand, CliFlag, CliArg
outputModePreset(), cwdPreset(), dryRunPreset()
defaultOnResult(ctx), passthroughResolver, isInteractive(options?)
InputResolver, ResolveInputOptions
autoIterateLayer, dateShortcutsLayer
```

## `@ontrails/mcp`

```typescript
surface(topo, options?)                // one-liner: create server, connect stdio, return close handle
createServer(topo, options?)           // create an MCP server without connecting
deriveMcpTools(topo, options?)         // projection: Result-returning tool definitions
connectStdio(server)                   // connect a created server to stdio transport
deriveToolName(appName, trailId)       // tool name derivation
deriveAnnotations(trail)               // MCP annotations from intent and metadata
createMcpProgressCallback(extra)       // progress bridge

CreateServerOptions, DeriveMcpToolsOptions
McpToolDefinition,                     // includes trailId: string
McpToolResult, McpContent, McpExtra, McpAnnotations
```

## `@ontrails/http`

```typescript
deriveHttpRoutes(topo, options?)       // projection: route definitions without server; returns Result<HttpRouteDefinition[], Error>

DeriveHttpRoutesOptions, HttpMethod, HttpRouteDefinition, InputSource
```

## `@ontrails/hono`

```typescript
surface(topo, options?)                // one-liner: create and serve Hono app; returns close handle + url
createApp(topo, options?)              // create a Hono app without serving

CreateAppOptions, SurfaceHttpResult
```

## `@ontrails/schema`

```typescript
deriveOpenApiSpec(topo, options?) // OpenAPI 3.1 spec from topo
deriveSurfaceMap(topo), deriveSurfaceMapHash(map), deriveSurfaceMapDiff(before, after)
writeSurfaceMap(map, options?), readSurfaceMap(options?)
writeSurfaceLock(lock, options?), readSurfaceLockData(options?), readSurfaceLock(options?)

SurfaceMap, SurfaceMapEntry, SurfaceMapContourReference, SurfaceLock, DiffResult, DiffEntry, JsonSchema
WriteOptions, ReadOptions

OpenApiOptions, OpenApiSpec, OpenApiServer
```

## `@ontrails/store`

```typescript
store(tables)                      // connector-agnostic store definition
// every normalized table exposes derived schemas and signals directly:
// table.schema          — normalized full entity schema
// table.insertSchema    — entity schema minus generated fields
// table.updateSchema    — partial update schema keyed by identity
// table.fixtureSchema   — fixture schema with generated fields optional
// table.signals.created | table.signals.updated | table.signals.removed

StoreDefinition, StoreTable, StoreTableSignals, StoreTablesInput, StoreTableInput
EntityOf<T>, InsertOf<T>, UpdateOf<T>, UpsertOf<T>, FixtureInputOf<T>, FixtureOf<T>
FiltersOf<T>, StoreListOptions
StoreConnection<T>, StoreTableConnection<T>, ReadOnlyStoreConnection<T>
StoreAccessor<T>, StoreTableAccessor<T>, ReadOnlyStoreTableAccessor<T>

// `versioned: true` on a store table adds a framework-managed integer `version`
// field to returned entities and allows `upsert()` optimistic concurrency.
// writable store resources fire the derived signals when accessed through `db.from(ctx)`.
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
createCliHarness(topo, options?), createMcpHarness(topo, options?)

TestExecutionOptions, TestCrossOptions
TestScenario, CrossScenario, TestLogger, TestTrailContextOptions
CliHarness, CliHarnessOptions, CliHarnessResult
McpHarness, McpHarnessOptions, McpHarnessResult
```

## `@ontrails/warden`

```typescript
runWarden(options?), formatWardenReport(report), checkDrift(rootDir, topo?)
wardenRules                        // ReadonlyMap<string, WardenRule> — 15 AST-based rules
wardenTopo                         // pre-built Topo of all warden trails
runWardenTrails(filePath, sourceCode, options?) // run warden rules against a single file
formatGitHubAnnotations(report), formatJson(report), formatSummary(report)

WardenOptions, WardenReport, WardenDiagnostic, WardenSeverity, DriftResult
ProjectAwareWardenRule, ProjectContext
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

// Resource & layer
configResource                       // resource for resolved config state
configLayer                          // layer for per-trail config context

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
PermitExtractionInput                // transport-agnostic auth input

// Connectors
AuthConnector                        // interface: authenticate(input) → Result<Permit | null>
createJwtConnector(options)          // built-in HS256 JWT connector (from @ontrails/permits/jwt)

// Trail definitions
authVerify                           // verify a bearer token and return a permit

// Testing
createTestPermit(overrides?)         // create a permit for tests
createPermitForTrail(trail)          // create a permit matching a trail's requirements

// Governance
validatePermits(trails)              // check trails against permit governance rules
PermitDiagnostic
```

## `@ontrails/tracing`

Tracing is intrinsic in `executeTrail` — every trail execution produces a `TraceRecord` automatically. `ctx.trace(label, fn)` records nested spans. No layer attachment required.

```typescript
// Sink registration (from @ontrails/core or re-exported from @ontrails/tracing)
registerTraceSink(sink)              // install a sink for trace records
getTraceSink()                       // get the currently registered sink
clearTraceSink()                     // revert to the default no-op sink

// Sinks
createMemorySink()                   // in-memory sink for testing
createDevStore(options?)             // SQLite-backed persistent sink for development
createOtelConnector(options?)        // OpenTelemetry span exporter

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

TraceRecord, TraceSink, SamplingConfig, TraceContext, TraceFn
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
| `trailblaze(topo, options?)` | Full hosted runtime |
| `trailhead` | Conceptual boundary where a graph becomes reachable (reserved noun) |
| `scout` | Agent-side runtime discovery |
| `validateExample`, `validateCross` | Contract verification family |
| `generateDocs`, `generateOpenApi`, `generateLlmsTxt` | Build-time doc generation |
| `deriveMocks`, `deriveExamples` | Schema-derived test data |
