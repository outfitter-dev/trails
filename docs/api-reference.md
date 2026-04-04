# Trails API Reference

Canonical public trailhead-facing reference. For naming conventions and decision history, see [ADR-0001](docs/adr/0001-naming-conventions.md).

---

## `@ontrails/core`

```typescript
// Definitions
trail(id, spec)                    // define a unit of work (with optional crosses for composition)
signal(id, spec)                    // define a payload schema with provenance
provision(id, spec)                  // define a first-class provision dependency
createProvisionLookup(getContext)   // bind ctx.provision() to a specific context snapshot
topo(name, ...modules)             // assemble trails, signals, and provisions into a queryable topology
// Topo methods: .get(id), .has(id), .list(), .listEvents(), .ids(), .count
//               .getProvision(id), .hasProvision(id), .listProvisions(), .provisionIds(), .provisionCount

// Types
Trail<I, O>, Event<T>, Provision<T>, Topo, Intent
TrailSpec<I, O>, EventSpec<T>, ProvisionSpec<T>, TrailExample<I, O>
AnyTrail, AnyEvent, AnyProvision, ProvisionContext, ProvisionOverrideMap

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
CrossFn, ProvisionLookup, ProgressCallback, ProgressEvent, Logger, Trailhead

// Execution pipeline
executeTrail(trail, rawInput, options?) // validate → resolve context → resolve provisions → compose gates → run
run(topo, id, input, options?)    // look up and execute a trail by ID; accepts ctx/provision overrides
RunOptions

// Gates
Gate                               // wrap(trail, implementation) → implementation
composeGates(gates, trail, implementation)

// Validation
validateInput(schema, data)        // → Result<T, ValidationError>
validateOutput(schema, data)       // → Result<T, ValidationError>
validateTopo(topo)                 // → Result<void, ValidationError>; called by testAll()
TopoIssue

// Schema derivation
deriveFields(schema, overrides?)   // → Field[]
deriveCliPath(trailId)             // dotted trail ID → ordered CLI path segments
Field, FieldOverride

// Resilience
retry(fn, options?), withTimeout(fn, ms, signal?), RetryOptions

// Branded types
brand, unbrand, uuid, email, nonEmptyString, positiveInt, shortId, hashId
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
securePath, isPathSafe, resolveSafePath
findWorkspaceRoot, isInsideWorkspace, getRelativePath
```

## `@ontrails/cli`

```typescript
trailhead(topo, options?)              // one-liner (from @ontrails/cli/commander)
buildCliCommands(topo, options?)   // escape hatch step 1
validateCliCommands(commands)      // validate command tree shape and collisions
toCommander(commands, options?)    // escape hatch step 2
deriveFlags(schema, overrides?)    // Zod → CLI flags
output(value, mode)                // write to stdout in text/json/jsonl
resolveOutputMode(flags)           // determine output format from flags/env

BuildCliCommandsOptions, ActionResultContext, OutputMode
CliCommand, CliFlag, CliArg
outputModePreset(), cwdPreset(), dryRunPreset()
defaultOnResult(ctx), passthroughResolver, isInteractive(options?)
InputResolver, ResolveInputOptions
autoIterateGate, dateShortcutsGate
```

## `@ontrails/mcp`

```typescript
trailhead(topo, options?)              // one-liner
buildMcpTools(topo, options?)      // escape hatch step 1; returns Result<McpToolDefinition[], Error>
connectStdio(server)               // escape hatch step 2
deriveToolName(appName, trailId)   // tool name derivation
deriveAnnotations(trail)           // MCP annotations from intent and metadata
createMcpProgressCallback(extra)   // progress bridge

TrailheadMcpOptions, BuildMcpToolsOptions
McpToolDefinition,                 // includes trailId: string
McpToolResult, McpContent, McpExtra, McpAnnotations
```

## `@ontrails/http`

```typescript
trailhead(topo, options?)              // one-liner HTTP server
buildHttpRoutes(topo, options?)    // escape hatch: route definitions without server; returns Result<HttpRouteDefinition[], Error>

TrailheadHttpOptions, BuildHttpRoutesOptions
HttpMethod, HttpRouteDefinition
```

## `@ontrails/schema`

```typescript
generateOpenApiSpec(topo, options?) // OpenAPI 3.1 spec from topo
generateTrailheadMap(topo), hashTrailheadMap(map), diffTrailheadMaps(before, after)
writeTrailheadMap(map, options?), readTrailheadMap(options?)
writeTrailheadLock(hash, options?), readTrailheadLock(options?)

TrailheadMap, TrailheadMapEntry, DiffResult, DiffEntry, JsonSchema
WriteOptions, ReadOptions

OpenApiOptions, OpenApiSpec, OpenApiServer
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
wardenRules                        // ReadonlyMap<string, WardenRule> — 13 AST-based rules
wardenTopo                         // pre-built Topo of all warden trails
runWardenTrails(filePath, sourceCode, options?) // run warden rules against a single file
formatGitHubAnnotations(report), formatJson(report), formatSummary(report)

WardenOptions, WardenReport, WardenDiagnostic, WardenSeverity, DriftResult
ProjectAwareWardenRule, ProjectContext
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
| `trailhead` | Static entry point / discovery |
| `scout` | Agent-side runtime discovery |
| `validateExample`, `validateFollow` | Contract verification family |
| `generateDocs`, `generateOpenApi`, `generateLlmsTxt` | Build-time doc generation |
| `deriveMocks`, `deriveExamples` | Schema-derived test data |
