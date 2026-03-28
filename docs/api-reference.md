# Trails API Reference

Canonical public surface. For naming conventions and decision history, see `docs/adr/001-naming-conventions.md`.

---

## `@ontrails/core`

```typescript
// Definitions
trail(id, spec)                    // define a unit of work (with optional follow for composition)
event(id, spec)                    // define a payload schema with provenance
topo(name, ...modules)             // assemble into a queryable topology

// Types
Trail<I, O>, Event<T>, Topo
TrailSpec<I, O>, HikeSpec<I, O>, EventSpec<T>, TrailExample<I, O>
AnyTrail, AnyHike, AnyEvent

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
FollowFn, ProgressCallback, ProgressEvent, Logger, Surface

// Layers
Layer                              // wrap(trail, implementation) → implementation
composeLayers(layers, trail, implementation)

// Validation
validateInput(schema, data)        // → Result<T, ValidationError>
validateOutput(schema, data)       // → Result<T, ValidationError>
validateTopo(topo)                 // → Result<void, ValidationError>; called by testAll()
TopoIssue

// Schema derivation
deriveFields(schema, overrides?)   // → Field[]
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
blaze(topo, options?)              // one-liner (from @ontrails/cli/commander)
buildCliCommands(topo, options?)   // escape hatch step 1
toCommander(commands, options?)    // escape hatch step 2
deriveFlags(schema, overrides?)    // Zod → CLI flags
output(value, mode)                // write to stdout in text/json/jsonl
resolveOutputMode(flags)           // determine output format from flags/env

BuildCliCommandsOptions, ActionResultContext, OutputMode
CliCommand, CliFlag, CliArg
outputModePreset(), cwdPreset(), dryRunPreset()
defaultOnResult(ctx), passthroughResolver, isInteractive(options?)
InputResolver, ResolveInputOptions
autoIterateLayer, dateShortcutsLayer
```

## `@ontrails/mcp`

```typescript
blaze(topo, options?)              // one-liner
buildMcpTools(topo, options?)      // escape hatch step 1
connectStdio(server)               // escape hatch step 2
deriveToolName(appName, trailId)   // tool name derivation
deriveAnnotations(trail)           // MCP annotations from markers
createMcpProgressCallback(extra)   // progress bridge

BlazeMcpOptions, BuildMcpToolsOptions
McpToolDefinition, McpToolResult, McpContent, McpExtra, McpAnnotations
```

## `@ontrails/schema`

```typescript
generateSurfaceMap(topo), hashSurfaceMap(map), diffSurfaceMaps(before, after)
writeSurfaceMap(map, options?), readSurfaceMap(options?)
writeSurfaceLock(hash, options?), readSurfaceLock(options?)

SurfaceMap, SurfaceMapEntry, DiffResult, DiffEntry, JsonSchema
WriteOptions, ReadOptions
```

## `@ontrails/testing`

```typescript
// Test runners
testAll(topo, ctx?)
testExamples(topo, ctx?), testTrail(trail, scenarios, ctx?)
testContracts(topo, ctx?), testDetours(topo, ctx?)

// Assertion helpers
expectOk(result), expectErr(result)
assertFullMatch(result, expected), assertSchemaMatch(result, schema)
assertErrorMatch(result, errorClass)

// Factories
createTestContext(options?), createTestLogger()
createCliHarness(topo, options?), createMcpHarness(topo, options?)

TestScenario, HikeScenario, TestLogger, TestTrailContextOptions, TestHikeOptions
CliHarness, CliHarnessOptions, CliHarnessResult
McpHarness, McpHarnessOptions, McpHarnessResult
```

## `@ontrails/warden`

```typescript
runWarden(options?), formatWardenReport(report), checkDrift(rootDir, topo?)
wardenRules                        // ReadonlyMap<string, WardenRule> — 10 AST-based rules
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
