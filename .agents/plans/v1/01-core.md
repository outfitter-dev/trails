# Stage 01 -- Core (`@ontrails/core`)

> The foundation of Trails. Result type, error taxonomy, trail/route/event definitions, trailhead, validation, patterns, types, and utilities. Everything a surface adapter needs to integrate.

---

## Prerequisites

- Stage 00 complete (monorepo scaffolded, CI green)

---

## 1. Package Setup

### 1.1 Create the package

```
packages/core/
├── src/
│   ├── index.ts
│   ├── result.ts
│   ├── errors.ts
│   ├── trail.ts
│   ├── route.ts
│   ├── event.ts
│   ├── trailhead.ts
│   ├── context.ts
│   ├── layer.ts
│   ├── types.ts
│   ├── health.ts
│   ├── adapters.ts
│   ├── validation.ts
│   ├── resilience.ts
│   ├── serialization.ts
│   ├── fetch.ts
│   ├── branded.ts
│   ├── guards.ts
│   ├── collections.ts
│   ├── path-security.ts
│   ├── workspace.ts
│   ├── blob-ref.ts
│   ├── job.ts
│   ├── patterns/
│   │   ├── index.ts
│   │   ├── pagination.ts
│   │   ├── bulk.ts
│   │   ├── timestamps.ts
│   │   ├── date-range.ts
│   │   ├── sorting.ts
│   │   ├── status.ts
│   │   ├── change.ts
│   │   └── progress.ts
│   ├── redaction/
│   │   ├── index.ts
│   │   ├── redactor.ts
│   │   └── patterns.ts
│   └── __tests__/
│       ├── result.test.ts
│       ├── errors.test.ts
│       ├── trail.test.ts
│       ├── route.test.ts
│       ├── event.test.ts
│       ├── trailhead.test.ts
│       ├── context.test.ts
│       ├── layer.test.ts
│       ├── validation.test.ts
│       ├── resilience.test.ts
│       ├── serialization.test.ts
│       ├── fetch.test.ts
│       ├── branded.test.ts
│       ├── guards.test.ts
│       ├── collections.test.ts
│       ├── path-security.test.ts
│       ├── workspace.test.ts
│       ├── blob-ref.test.ts
│       ├── job.test.ts
│       ├── patterns.test.ts
│       └── redaction.test.ts
├── package.json
└── tsconfig.json
```

### 1.2 `package.json`

```json
{
  "name": "@ontrails/core",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./patterns": "./src/patterns/index.ts",
    "./redaction": "./src/redaction/index.ts"
  },
  "peerDependencies": {
    "zod": "catalog:"
  },
  "scripts": {
    "build": "tsc -b",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist *.tsbuildinfo"
  }
}
```

One external dependency: `zod` (as a peer).

---

## 2. Result Type

**File:** `src/result.ts`

Built-in, no external dependency. Approximately 80 lines of code.

### 2.1 Core types

```typescript
type Result<T, E = Error> = Ok<T, E> | Err<T, E>;
```

Default error type is `Error`. Implementations return `Result<T, Error>`, not `Result<T, SpecificError>`.

### 2.2 `Ok<T, E>` class

Properties and methods:

- `readonly value: T`
- `isOk(): this is Ok<T, E>` -- returns `true`
- `isErr(): this is Err<T, E>` -- returns `false`
- `map<U>(fn: (value: T) => U): Result<U, E>` -- transforms the success value
- `flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E>` -- chains Result-returning functions
- `match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U` -- pattern matching
- `unwrap(): T` -- returns value (throws if Err, but should rarely be used)
- `unwrapOr(fallback: T): T` -- returns value or fallback

### 2.3 `Err<T, E>` class

Properties and methods:

- `readonly error: E`
- `isOk(): this is Ok<T, E>` -- returns `false`
- `isErr(): this is Err<T, E>` -- returns `true`
- `map<U>(_fn: (value: T) => U): Result<U, E>` -- passes through the error
- `flatMap<U>(_fn: (value: T) => Result<U, E>): Result<U, E>` -- passes through the error
- `match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U` -- calls err handler
- `unwrap(): never` -- throws the error
- `unwrapOr(fallback: T): T` -- returns fallback

### 2.4 `Result` namespace

Static constructors:

- `Result.ok<T>(value: T): Result<T, never>` -- create a success
- `Result.err<E>(error: E): Result<never, E>` -- create a failure
- `Result.combine<T, E>(results: Result<T, E>[]): Result<T[], E>` -- collects an array of Results into a Result of array. Returns the first error if any fail.

### 2.5 Tests

- Constructing Ok and Err
- `isOk()` / `isErr()` type narrowing
- `map()` transforms value, passes through error
- `flatMap()` chains, short-circuits on error
- `match()` dispatches to correct handler
- `unwrap()` returns value or throws
- `unwrapOr()` returns value or fallback
- `Result.combine()` collects successes, returns first error

---

## 3. Error Taxonomy

**File:** `src/errors.ts`

### 3.1 `TrailsError` base class

```typescript
abstract class TrailsError extends Error {
  abstract readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      context?: Record<string, unknown>;
    }
  );
}
```

All 13 error classes extend `TrailsError` directly. No `TaggedError` factory pattern -- just class inheritance.

### 3.2 Error classes

| Class | Category | Notes |
| --- | --- | --- |
| `ValidationError` | `validation` | Schema/input validation failures |
| `AmbiguousError` | `validation` | Multiple valid interpretations |
| `AssertionError` | `validation` | Internal assertions (invariant violations) |
| `NotFoundError` | `not_found` | Resource not found |
| `AlreadyExistsError` | `conflict` | Duplicate resource |
| `ConflictError` | `conflict` | State conflict (optimistic locking, etc.) |
| `PermissionError` | `permission` | Forbidden (has auth, lacks permission) |
| `TimeoutError` | `timeout` | Operation exceeded deadline |
| `RateLimitError` | `rate_limit` | Rate limit exceeded. Adds optional `retryAfter: number` |
| `NetworkError` | `network` | Network/connectivity failure |
| `InternalError` | `internal` | Unexpected internal errors |
| `AuthError` | `auth` | Authentication failure (no/invalid credentials) |
| `CancelledError` | `cancelled` | Operation cancelled (AbortSignal, user interrupt) |

Each class:

- Extends `TrailsError`
- Sets `category` as a readonly literal
- Sets `retryable` from the taxonomy (timeout, rate_limit, network are retryable)
- Accepts `message`, optional `cause`, optional `context`

### 3.3 Taxonomy maps

Export as plain objects:

```typescript
const exitCodeMap: Record<ErrorCategory, number> = {
  validation: 1,
  not_found: 2,
  conflict: 3,
  permission: 4,
  timeout: 5,
  rate_limit: 6,
  network: 7,
  internal: 8,
  auth: 9,
  cancelled: 130,
};

const statusCodeMap: Record<ErrorCategory, number> = {
  validation: 400,
  not_found: 404,
  conflict: 409,
  permission: 403,
  timeout: 504,
  rate_limit: 429,
  network: 502,
  internal: 500,
  auth: 401,
  cancelled: 499,
};

const jsonRpcCodeMap: Record<ErrorCategory, number> = {
  validation: -32602, // Invalid params
  not_found: -32601, // Method not found
  conflict: -32603, // Internal (no direct mapping)
  permission: -32600, // Invalid request
  timeout: -32603,
  rate_limit: -32603,
  network: -32603,
  internal: -32603,
  auth: -32600,
  cancelled: -32603,
};

const retryableMap: Record<ErrorCategory, boolean> = {
  validation: false,
  not_found: false,
  conflict: false,
  permission: false,
  timeout: true,
  rate_limit: true,
  network: true,
  internal: false,
  auth: false,
  cancelled: false,
};
```

### 3.4 `ErrorCategory` type

```typescript
type ErrorCategory =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'permission'
  | 'timeout'
  | 'rate_limit'
  | 'network'
  | 'internal'
  | 'auth'
  | 'cancelled';
```

### 3.5 Tests

- Each error class sets correct category, retryable, message, cause, context
- Taxonomy maps return correct values for each category
- `instanceof TrailsError` works for all subclasses
- `instanceof` works for specific classes (e.g., `error instanceof NotFoundError`)

---

## 4. Trail Definition

**File:** `src/trail.ts`

### 4.1 `trail(id, spec)` function

Defines a trail -- the atomic unit of work.

```typescript
function trail<I, O>(id: string, spec: TrailSpec<I, O>): Trail<I, O>;
```

**`TrailSpec<I, O>`** fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | `z.ZodType<I>` | Yes | Zod schema for input validation |
| `output` | `z.ZodType<O>` | No | Zod schema for output (required for MCP/HTTP surfaces) |
| `implementation` | `Implementation<I, O>` | Yes | The pure function (sync or async -- unified type) |
| `description` | `string` | No | Human-readable description |
| `examples` | `TrailExample<I, O>[]` | No | Input/output examples for agents and testing |
| `readOnly` | `boolean` | No | Marks as non-mutating |
| `destructive` | `boolean` | No | Marks as destructive (auto-adds `--dry-run` on CLI) |
| `idempotent` | `boolean` | No | Marks as idempotent |
| `markers` | `Record<string, unknown>` | No | Custom metadata annotations |
| `detours` | `Record<string, string[]>` | No | Error recovery paths by error class name |

The `readOnly`, `destructive`, and `idempotent` booleans are the trail's **markers** for surface adapters. CLI uses `destructive` to auto-add `--dry-run`. MCP uses `readOnly` for `readOnlyHint`. These are first-class fields, not stuffed into the `markers` bag.

`trail()` accepts the unified `Implementation` type, which handles both sync and async authoring. The returned `Trail` always exposes a normalized async `implementation`, so layers and surfaces only have one execution shape to handle.

**`TrailExample<I, O>`**:

```typescript
interface TrailExample<I, O> {
  name: string;
  description?: string;
  input: I;
  expected?: O; // For full-match testing
  error?: string; // Error class name for error-path examples
}
```

### 4.2 `Trail<I, O>` type

The returned spec type. Contains everything from `TrailSpec` plus the `id`:

```typescript
interface Trail<I = unknown, O = unknown> {
  readonly id: string;
  readonly input: z.ZodType<I>;
  readonly output?: z.ZodType<O>;
  readonly implementation: Implementation<I, O>;
  readonly description?: string;
  readonly examples?: TrailExample<I, O>[];
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
  readonly markers?: Record<string, unknown>;
  readonly detours?: Record<string, string[]>;
  readonly kind: 'trail';
}
```

The `kind: "trail"` discriminant enables `trailhead()` to auto-scan module exports for Trail shapes.

### 4.3 Tests

- `trail()` returns a Trail with correct id and kind
- Input schema is preserved
- Output schema is optional
- Implementation is callable
- Sync and async implementations are both handled by the unified `Implementation` type
- Examples are stored
- Markers are stored
- Detours are stored
- Boolean flags (readOnly, destructive, idempotent) default to undefined

---

## 5. Route Definition

**File:** `src/route.ts`

### 5.1 `route(id, spec)` function

Defines a composite trail that follows other trails.

```typescript
function route<I, O>(id: string, spec: RouteSpec<I, O>): Route<I, O>;
```

**`RouteSpec<I, O>`** extends `TrailSpec<I, O>` with:

| Field     | Type       | Required | Description                  |
| --------- | ---------- | -------- | ---------------------------- |
| `follows` | `string[]` | Yes      | Trail IDs this hike follows |

### 5.2 `Route<I, O>` type

```typescript
interface Route<I = unknown, O = unknown> extends Trail<I, O> {
  readonly follows: string[];
  readonly kind: 'hike';
}
```

A route IS a trail (extends the interface). The `kind: "route"` discriminant distinguishes it.

### 5.3 Tests

- `route()` returns a Route with correct id and kind
- `follows` array is preserved
- Hike extends Trail interface (all Trail tests apply)
- Sync and async implementations are handled by the unified `Implementation` type
- `kind` is `"hike"` not `"trail"`

---

## 6. Event Definition

**File:** `src/event.ts`

### 6.1 `event(id, spec)` function

Defines a server-originated event.

```typescript
function event<T>(id: string, spec: EventSpec<T>): Event<T>;
```

**`EventSpec<T>`** fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `payload` | `z.ZodType<T>` | Yes | Zod schema for event payload |
| `description` | `string` | No | Human-readable description |
| `markers` | `Record<string, unknown>` | No | Custom metadata |

### 6.2 `Event<T>` type

```typescript
interface Event<T = unknown> {
  readonly id: string;
  readonly payload: z.ZodType<T>;
  readonly description?: string;
  readonly markers?: Record<string, unknown>;
  readonly kind: 'event';
}
```

Note: `event()` ships as a definition primitive in stage 01. The runtime machinery (emission, delivery, subscriptions) ships later. You can define events from day one; the execution infrastructure follows.

### 6.3 Tests

- `event()` returns an Event with correct id and kind
- Payload schema is preserved
- Description and markers are optional

---

## 7. Trailhead

**File:** `src/trailhead.ts`

### 7.1 `trailhead(name, ...modules)` function

Collects trail modules into an app. Auto-scans module exports for Trail, Route, and Event shapes (by checking `kind` discriminant).

```typescript
function trailhead(name: string, ...modules: Record<string, unknown>[]): App;
```

**How auto-scanning works:**

1. Iterate each module's exports
2. Check if the export has a `kind` property matching `"trail"`, `"route"`, or `"event"`
3. Collect into the internal topo
4. Validate no duplicate IDs
5. Return the App

**`App` interface:**

```typescript
interface App {
  readonly name: string;
  readonly topo: Topo;
}
```

### 7.2 `Topo` type

The internal trail collection. The data structure that surfaces read, schema tools inspect, and `ctx.follow()` dispatches through.

```typescript
interface Topo {
  readonly trails: ReadonlyMap<string, Trail>;
  readonly routes: ReadonlyMap<string, Route>;
  readonly events: ReadonlyMap<string, Event>;

  get(id: string): Trail | Route | undefined;
  has(id: string): boolean;
  list(): Array<Trail | Route>;
  listEvents(): Event[];
}
```

### 7.3 Tests

- `trailhead()` collects trails from modules
- Auto-scans exports by `kind` discriminant
- Rejects duplicate trail IDs (throws `ValidationError`)
- Returns App with name and topo
- `topo.get()` retrieves by ID
- `topo.has()` checks existence
- `topo.list()` returns all trails and routes
- `topo.listEvents()` returns all events
- Non-trail exports are silently ignored

---

## 8. TrailContext

**File:** `src/context.ts`

### 8.1 `TrailContext` interface

The invocation environment passed to every implementation.

```typescript
interface TrailContext {
  readonly requestId: string; // Auto-generated UUID v7 (time-sortable)
  readonly signal: AbortSignal; // Required -- always present
  readonly follow?: FollowFn; // Call another trail from a hike
  readonly permit?: unknown; // Auth/principal (typed by the app)
  readonly workspaceRoot?: string; // Resolved workspace root path
  readonly logger?: LoggerPort; // Logger port (not a concrete logger)
  readonly progress?: ProgressCallback; // Progress reporting for streaming
  readonly [key: string]: unknown; // Extensible -- apps can add custom fields
}

type FollowFn = <O>(id: string, input: unknown) => Promise<Result<O, Error>>;
type ProgressCallback = (event: ProgressEvent) => void;

interface ProgressEvent {
  type: 'start' | 'progress' | 'complete' | 'error';
  current?: number;
  total?: number;
  message?: string;
  ts: string;
}

interface LoggerPort {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}
```

Key design decisions:

- `signal` is required, not optional. Cancellation is always available.
- `follow` is optional -- only provided inside routes (when the topo is available for dispatch).
- `permit` is `unknown` at the core level. Apps narrow the type.
- `logger` is a port interface (`LoggerPort`), not a concrete logger. `@ontrails/logging` provides the adapter.
- `progress` is optional -- only provided when the surface supports streaming.

### 8.2 `createTrailContext(overrides?)` factory

Convenience factory that provides defaults:

```typescript
function createTrailContext(overrides?: Partial<TrailContext>): TrailContext;
```

Defaults:

- `requestId`: `Bun.randomUUIDv7()` (or `crypto.randomUUID()` as fallback)
- `signal`: `new AbortController().signal` (a non-aborted signal)
- Everything else: from overrides

### 8.3 Tests

- `createTrailContext()` generates a requestId
- `createTrailContext()` provides a non-aborted signal
- Override values take precedence
- TrailContext is extensible (custom fields accepted)

---

## 9. Implementation Types

**File:** `src/types.ts`

### 9.1 `Implementation<I, O>`

The unified function type that handles both sync and async authoring:

```typescript
type Implementation<I, O> = (
  input: I,
  ctx: TrailContext
) => Result<O, Error> | Promise<Result<O, Error>>;
```

This is a type alias, not a runtime construct. `trail()` and `hike()` accept implementations that return either `Result` or `Promise<Result>`, then normalize to the async runtime shape before surfaces and layers see the trail.

---

## 10. Layer Interface

**File:** `src/layer.ts`

### 10.1 `Layer` interface

Cross-cutting concern that wraps trail execution. Layers run before and/or after the implementation. The standard middleware concept, renamed.

```typescript
interface Layer {
  readonly name: string;
  readonly description?: string;

  wrap<I, O>(
    trail: Trail<I, O>,
    implementation: Implementation<I, O>
  ): Implementation<I, O>;
}
```

A layer receives the trail spec (for inspecting metadata like `readOnly`, `destructive`) and the implementation, and returns a wrapped implementation.

### 10.2 `composeLayers(layers, trail, implementation)` utility

Applies layers in order (outermost first):

```typescript
function composeLayers<I, O>(
  layers: Layer[],
  trail: Trail<I, O>,
  implementation: Implementation<I, O>
): Implementation<I, O>;
```

### 10.3 Tests

- A single layer wraps the implementation
- Multiple layers compose in order (first layer is outermost)
- Layers receive the trail spec (can inspect markers, readOnly, etc.)
- A layer can short-circuit (return early without calling the implementation)
- A layer can transform input or output

---

## 11. Health Types

**File:** `src/health.ts`

### 11.1 Types

```typescript
type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface HealthResult {
  status: HealthStatus;
  checks: Record<
    string,
    {
      status: HealthStatus;
      message?: string;
      latency?: number;
    }
  >;
  version?: string;
  uptime?: number;
}
```

These are shared types. Health check implementations live in service definitions (deferred to v1.1).

---

## 12. Adapter Port Interfaces

**File:** `src/adapters.ts`

Port interfaces for infrastructure adapters. Core defines the contracts; concrete implementations live in separate packages.

### 12.1 `IndexAdapter`

```typescript
interface IndexAdapter {
  index(
    id: string,
    document: Record<string, unknown>
  ): Promise<Result<void, Error>>;
  search(
    query: string,
    options?: SearchOptions
  ): Promise<Result<SearchResult[], Error>>;
  remove(id: string): Promise<Result<void, Error>>;
}

interface SearchOptions {
  limit?: number;
  offset?: number;
  filters?: Record<string, unknown>;
}

interface SearchResult {
  id: string;
  score: number;
  document: Record<string, unknown>;
}
```

### 12.2 `StorageAdapter`

```typescript
interface StorageAdapter {
  get(key: string): Promise<Result<unknown, Error>>;
  set(
    key: string,
    value: unknown,
    options?: StorageOptions
  ): Promise<Result<void, Error>>;
  delete(key: string): Promise<Result<void, Error>>;
  has(key: string): Promise<Result<boolean, Error>>;
}

interface StorageOptions {
  ttl?: number;
}
```

### 12.3 `CacheAdapter`

```typescript
interface CacheAdapter {
  get<T>(key: string): Promise<Result<T | undefined, Error>>;
  set<T>(key: string, value: T, ttl?: number): Promise<Result<void, Error>>;
  delete(key: string): Promise<Result<void, Error>>;
  clear(): Promise<Result<void, Error>>;
}
```

All adapter methods return `Result`, consistent with the framework's error handling.

### 12.4 Tests

- Port interfaces are importable (type-level test)
- A mock implementation satisfies each interface

---

## 13. Validation

**File:** `src/validation.ts`

### 13.1 `validateInput(schema, data)`

Validates data against a Zod schema and returns a Result:

```typescript
function validateInput<T>(
  schema: z.ZodType<T>,
  data: unknown
): Result<T, ValidationError>;
```

On failure, wraps Zod issues into a `ValidationError` with formatted messages.

### 13.2 `formatZodIssues(issues)`

Formats Zod validation issues into human-readable strings:

```typescript
function formatZodIssues(issues: z.ZodIssue[]): string[];
```

Each issue becomes a string like `"name: Required"` or `"age: Expected number, received string"`.

### 13.3 `zodToJsonSchema(schema)`

Converts a Zod schema to JSON Schema (for MCP tool input schemas, OpenAPI, etc.):

```typescript
function zodToJsonSchema(schema: z.ZodType): Record<string, unknown>;
```

This handles common Zod types: `z.string()`, `z.number()`, `z.boolean()`, `z.object()`, `z.array()`, `z.enum()`, `z.optional()`, `z.default()`, `z.union()`, `z.literal()`, `z.describe()`. Not a full Zod-to-JSON-Schema converter -- covers the types needed for trail input schemas. Use `zod-to-json-schema` package if full coverage is needed later.

### 13.4 Tests

- `validateInput()` returns Ok for valid data
- `validateInput()` returns Err with ValidationError for invalid data
- `formatZodIssues()` produces readable messages
- `zodToJsonSchema()` converts common types correctly
- `zodToJsonSchema()` handles nested objects and arrays

---

## 14. Resilience

**File:** `src/resilience.ts`

### 14.1 `retry(fn, options)`

Retries an async function that returns a Result:

```typescript
function retry<T>(
  fn: () => Promise<Result<T, Error>>,
  options?: RetryOptions
): Promise<Result<T, Error>>;

interface RetryOptions {
  maxAttempts?: number; // Default: 3
  baseDelay?: number; // Default: 1000ms
  maxDelay?: number; // Default: 30000ms
  backoffFactor?: number; // Default: 2 (exponential)
  shouldRetry?: (error: Error) => boolean; // Default: checks retryableMap
  signal?: AbortSignal;
}
```

### 14.2 `withTimeout(fn, ms, signal?)`

Wraps an async operation with a timeout:

```typescript
function withTimeout<T>(
  fn: () => Promise<Result<T, Error>>,
  ms: number,
  signal?: AbortSignal
): Promise<Result<T, Error>>;
```

Returns `Result.err(new TimeoutError(...))` if the deadline is exceeded.

### 14.3 `shouldRetry(error)`

Checks if an error is retryable based on the taxonomy:

```typescript
function shouldRetry(error: Error): boolean;
```

Uses `retryableMap` if the error is a `TrailsError`, otherwise returns `false`.

### 14.4 `getBackoffDelay(attempt, options)`

Calculates exponential backoff delay with jitter:

```typescript
function getBackoffDelay(
  attempt: number,
  options?: {
    baseDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
  }
): number;
```

### 14.5 Tests

- `retry()` retries on retryable errors
- `retry()` does not retry on non-retryable errors
- `retry()` respects maxAttempts
- `retry()` uses exponential backoff
- `retry()` respects AbortSignal
- `withTimeout()` returns TimeoutError on timeout
- `withTimeout()` returns result if within deadline
- `shouldRetry()` returns correct values for each error category
- `getBackoffDelay()` produces increasing delays with jitter

---

## 15. Serialization

**File:** `src/serialization.ts`

### 15.1 `serializeError(error)`

Converts an Error (or TrailsError) to a plain object for transport:

```typescript
function serializeError(error: Error): SerializedError;

interface SerializedError {
  name: string;
  message: string;
  category?: ErrorCategory;
  retryable?: boolean;
  retryAfter?: number;
  context?: Record<string, unknown>;
  stack?: string;
}
```

### 15.2 `deserializeError(data)`

Reconstructs a TrailsError from serialized data:

```typescript
function deserializeError(data: SerializedError): TrailsError;
```

Matches `name` to the error class and reconstructs with the original context.

### 15.3 `safeParse(json)`

JSON.parse wrapped in a Result:

```typescript
function safeParse(json: string): Result<unknown, ValidationError>;
```

### 15.4 `safeStringify(value)`

JSON.stringify wrapped in a Result, handling circular references:

```typescript
function safeStringify(value: unknown): Result<string, InternalError>;
```

### 15.5 Tests

- Round-trip: `deserializeError(serializeError(error))` preserves category, message, context
- `safeParse()` returns Ok for valid JSON
- `safeParse()` returns Err for invalid JSON
- `safeStringify()` handles circular references gracefully

---

## 16. fromFetch

**File:** `src/fetch.ts`

### 16.1 `fromFetch(input, init?)`

Wraps `fetch()` to return a Result:

```typescript
function fromFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Result<Response, Error>>;
```

Error mapping:

- Network error (TypeError from fetch) -> `NetworkError`
- AbortError -> `CancelledError`
- HTTP 4xx/5xx -> mapped via `statusCodeMap` reverse lookup to appropriate `TrailsError` subclass
- HTTP 401 -> `AuthError`
- HTTP 403 -> `PermissionError`
- HTTP 404 -> `NotFoundError`
- HTTP 429 -> `RateLimitError` (with `retryAfter` from headers)
- HTTP 500 -> `InternalError`
- HTTP 502 -> `NetworkError`
- HTTP 504 -> `TimeoutError`

### 16.2 Tests

- Successful fetch returns Ok with Response
- Network error returns Err with NetworkError
- HTTP 404 returns Err with NotFoundError
- HTTP 429 returns Err with RateLimitError including retryAfter
- Aborted fetch returns Err with CancelledError

---

## 17. Branded Types

**File:** `src/branded.ts`

### 17.1 Core branding mechanism

```typescript
type Branded<T, Tag extends string> = T & { readonly __brand: Tag };

function brand<T, Tag extends string>(tag: Tag, value: T): Branded<T, Tag>;
```

### 17.2 Built-in branded types

```typescript
type UUID = Branded<string, 'UUID'>;
type Email = Branded<string, 'Email'>;
type NonEmptyString = Branded<string, 'NonEmptyString'>;
type PositiveInt = Branded<number, 'PositiveInt'>;
```

Each with a factory function that validates:

```typescript
function uuid(value: string): Result<UUID, ValidationError>;
function email(value: string): Result<Email, ValidationError>;
function nonEmptyString(value: string): Result<NonEmptyString, ValidationError>;
function positiveInt(value: number): Result<PositiveInt, ValidationError>;
```

### 17.3 Tests

- `brand()` adds the brand tag
- Factory functions validate and return Result
- Invalid values return Err with ValidationError
- Branded types are assignable to their base type but not vice versa

---

## 18. Type Guards

**File:** `src/guards.ts`

### 18.1 Guards

```typescript
function isDefined<T>(value: T | undefined | null): value is T;
function isNonEmptyString(value: unknown): value is string;
function isPlainObject(value: unknown): value is Record<string, unknown>;
function hasProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown>;
```

### 18.2 Tests

- Each guard correctly narrows types
- Edge cases: empty string, null, undefined, arrays (not plain objects)

---

## 19. Collection Utilities

**File:** `src/collections.ts`

### 19.1 Functions

```typescript
function chunk<T>(array: T[], size: number): T[][];
function dedupe<T>(array: T[], key?: (item: T) => unknown): T[];
function groupBy<T, K extends string>(
  array: T[],
  fn: (item: T) => K
): Record<K, T[]>;
function sortBy<T>(array: T[], fn: (item: T) => string | number): T[];
```

### 19.2 `NonEmptyArray<T>` type

```typescript
type NonEmptyArray<T> = [T, ...T[]];

function isNonEmptyArray<T>(array: T[]): array is NonEmptyArray<T>;
function assertNonEmpty<T>(array: T[]): NonEmptyArray<T>; // throws if empty
```

### 19.3 Tests

- `chunk()` splits correctly, handles remainders
- `dedupe()` by value and by key function
- `groupBy()` produces correct groups
- `sortBy()` sorts by string and number keys
- `isNonEmptyArray()` and `assertNonEmpty()` work correctly

---

## 20. Path Security

**File:** `src/path-security.ts`

In core so the safe path is the easy path.

### 20.1 Functions

```typescript
function securePath(
  basePath: string,
  userPath: string
): Result<string, PermissionError>;
function isPathSafe(basePath: string, userPath: string): boolean;
function resolveSafePath(
  basePath: string,
  ...segments: string[]
): Result<string, PermissionError>;
```

- `securePath()` resolves a user-provided path relative to a base path and verifies it does not escape the base directory (no `../` traversal attacks).
- `isPathSafe()` returns a boolean check without resolving.
- `resolveSafePath()` joins path segments and validates.

All return `PermissionError` on path traversal attempts.

### 20.2 Tests

- Normal relative paths resolve correctly
- `../` traversal returns PermissionError
- Absolute paths outside base return PermissionError
- Symlinks that escape are caught (if resolvable)

---

## 21. Workspace Detection

**File:** `src/workspace.ts`

### 21.1 Functions

```typescript
function findWorkspaceRoot(startDir?: string): Result<string, NotFoundError>;
function isInsideWorkspace(path: string, workspaceRoot: string): boolean;
function getRelativePath(absolutePath: string, workspaceRoot: string): string;
```

- `findWorkspaceRoot()` walks up from `startDir` (or cwd) looking for `package.json` with `workspaces` field, or `bun.lock` / `bun.lockb`.
- `isInsideWorkspace()` checks if a path is within the workspace root.
- `getRelativePath()` computes the relative path from workspace root.

### 21.2 Tests

- Finds workspace root from nested directory
- Returns NotFoundError when no workspace found
- `isInsideWorkspace()` validates correctly
- `getRelativePath()` computes correct relative paths

---

## 22. BlobRef Type

**File:** `src/blob-ref.ts`

Surface-agnostic file/binary reference. Adapters handle per-transport.

### 22.1 Type

```typescript
interface BlobRef {
  readonly name: string;
  readonly mimeType: string;
  readonly size?: number;
  readonly data: Uint8Array | ReadableStream<Uint8Array>;
}
```

### 22.2 Utilities

```typescript
function createBlobRef(
  name: string,
  data: Uint8Array,
  mimeType?: string
): BlobRef;
function blobRefFromFile(path: string): Promise<Result<BlobRef, Error>>;
```

- `createBlobRef()` constructs a BlobRef with auto-detected MIME type if not provided.
- `blobRefFromFile()` reads a file and wraps it in a BlobRef.

### 22.3 Tests

- Create BlobRef from data
- Create BlobRef from file
- MIME type detection

---

## 23. Job Pattern Proof

**File:** `src/job.ts`

Verify that `statusFields()` and `progressFields()` from `@ontrails/core/patterns` produce output that works across surfaces.

### 23.1 Schema helpers

```typescript
function statusFields(): {
  status: z.ZodEnum<['pending', 'running', 'completed', 'failed', 'cancelled']>;
  startedAt: z.ZodOptional<z.ZodString>;
  completedAt: z.ZodOptional<z.ZodString>;
  error: z.ZodOptional<z.ZodString>;
};

function progressFields(): {
  current: z.ZodNumber;
  total: z.ZodNumber;
  percentage: z.ZodNumber;
  message: z.ZodOptional<z.ZodString>;
};
```

These return Zod field objects that can be spread into a `z.object()`:

```typescript
const jobOutput = z.object({
  id: z.string(),
  ...statusFields(),
  ...progressFields(),
});
```

### 23.2 Proof test

Write a test that:

1. Defines a trail with `statusFields()` + `progressFields()` in the output schema
2. Verifies the combined schema validates sample job data
3. Verifies `zodToJsonSchema()` produces valid JSON Schema from the combined output
4. Proves the pattern works for CLI output (JSON serializable) and MCP tool responses

If the proof reveals that a `kind: "job"` discriminant is needed on the trail spec, add it now.

---

## 24. Patterns Subpath (`@ontrails/core/patterns`)

**File:** `src/patterns/index.ts` and individual pattern files

### 24.1 Pagination

```typescript
function paginationInput(): {
  limit: z.ZodDefault<z.ZodNumber>; // default 20
  offset: z.ZodDefault<z.ZodNumber>; // default 0
  cursor: z.ZodOptional<z.ZodString>;
};

function paginationOutput<T>(itemSchema: z.ZodType<T>): z.ZodObject<{
  items: z.ZodArray<typeof itemSchema>;
  total: z.ZodNumber;
  hasMore: z.ZodBoolean;
  nextCursor: z.ZodOptional<z.ZodString>;
}>;
```

### 24.2 Bulk

```typescript
function bulkInput<T>(itemSchema: z.ZodType<T>): z.ZodObject<{
  items: z.ZodArray<typeof itemSchema>;
}>;

function bulkOutput(): z.ZodObject<{
  succeeded: z.ZodNumber;
  failed: z.ZodNumber;
  errors: z.ZodOptional<
    z.ZodArray<
      z.ZodObject<{
        index: z.ZodNumber;
        error: z.ZodString;
      }>
    >
  >;
}>;
```

### 24.3 Timestamps

```typescript
function timestampFields(): {
  createdAt: z.ZodString;
  updatedAt: z.ZodString;
};
```

### 24.4 Date range

```typescript
function dateRangeInput(): {
  since: z.ZodOptional<z.ZodString>;
  until: z.ZodOptional<z.ZodString>;
};
```

### 24.5 Sorting

```typescript
function sortingInput(allowedFields: string[]): {
  sortBy: z.ZodOptional<z.ZodEnum<[string, ...string[]]>>;
  sortOrder: z.ZodDefault<z.ZodEnum<['asc', 'desc']>>;
};
```

### 24.6 Status

`statusFields()` -- see Job Pattern Proof section above.

### 24.7 Change

```typescript
function changeFields(): {
  changeType: z.ZodEnum<['created', 'updated', 'deleted']>;
  changedFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
  previousValues: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
};
```

### 24.8 Progress

`progressFields()` -- see Job Pattern Proof section above.

### 24.9 Tests

- Each pattern function returns valid Zod schema fields
- Pattern fields can be spread into `z.object()`
- Pagination input/output schemas validate correctly
- Bulk input/output schemas validate correctly
- Sorting respects allowed fields

---

## 25. Redaction Subpath (`@ontrails/core/redaction`)

**File:** `src/redaction/index.ts`

### 25.1 `createRedactor(patterns?)`

Creates a redaction function:

```typescript
function createRedactor(
  patterns?: RedactionPattern[]
): (value: string) => string;

interface RedactionPattern {
  pattern: RegExp;
  replacement?: string; // Default: "[REDACTED]"
  name: string;
}
```

### 25.2 `DEFAULT_PATTERNS`

Built-in patterns for common secrets:

```typescript
const DEFAULT_PATTERNS: RedactionPattern[] = [
  { name: 'bearer_token', pattern: /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/g },
  {
    name: 'api_key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9\-._~+\/]+/gi,
  },
  {
    name: 'password',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']+/gi,
  },
  {
    name: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  {
    name: 'private_key',
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END/g,
  },
];
```

### 25.3 Tests

- Default patterns redact bearer tokens, API keys, passwords, JWTs
- Custom patterns work
- Non-matching strings pass through unchanged

---

## 26. Package Exports Structure

### 26.1 Main barrel (`src/index.ts`)

Export everything except patterns and redaction (those are subpaths):

```typescript
// Result
export { Result, Ok, Err } from './result';

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
  type ErrorCategory,
  exitCodeMap,
  statusCodeMap,
  jsonRpcCodeMap,
  retryableMap,
} from './errors';

// Definitions
export { trail, type Trail, type TrailSpec, type TrailExample } from './trail';
export { hike, type Hike, type HikeSpec } from './hike';
export { event, type Event, type EventSpec } from './event';
export { topo, type Topo } from './topo';

// Context
export {
  type TrailContext,
  type FollowFn,
  type ProgressCallback,
  type ProgressEvent,
  type LoggerPort,
  createTrailContext,
} from './context';

// Types
export { type Implementation } from './types';
export { type Layer, composeLayers } from './layer';
export { type HealthStatus, type HealthResult } from './health';
export {
  type IndexAdapter,
  type StorageAdapter,
  type CacheAdapter,
} from './adapters';

// Validation
export { validateInput, formatZodIssues, zodToJsonSchema } from './validation';

// Resilience
export {
  retry,
  withTimeout,
  shouldRetry,
  getBackoffDelay,
  type RetryOptions,
} from './resilience';

// Serialization
export {
  serializeError,
  deserializeError,
  type SerializedError,
} from './serialization';

// Result.fromJson and Result.toJson are methods on the Result namespace
// Result.fromFetch is a method on the Result namespace

// Branded types
export {
  type Branded,
  brand,
  type UUID,
  uuid,
  type Email,
  email,
  type NonEmptyString,
  nonEmptyString,
  type PositiveInt,
  positiveInt,
} from './branded';

// Guards
export {
  isDefined,
  isNonEmptyString,
  isPlainObject,
  hasProperty,
} from './guards';

// Collections
export {
  chunk,
  dedupe,
  groupBy,
  sortBy,
  type NonEmptyArray,
  isNonEmptyArray,
  assertNonEmpty,
} from './collections';

// Path security
export { securePath, isPathSafe, resolveSafePath } from './path-security';

// Workspace
export {
  findWorkspaceRoot,
  isInsideWorkspace,
  getRelativePath,
} from './workspace';

// BlobRef
export { type BlobRef, createBlobRef, blobRefFromFile } from './blob-ref';

// Job
export { statusFields, progressFields } from './job';
```

### 26.2 Subpath exports

- `@ontrails/core/patterns` -> `src/patterns/index.ts`
- `@ontrails/core/redaction` -> `src/redaction/index.ts`

---

## Testing Requirements

Every module gets its own test file in `src/__tests__/`. TDD approach: write the failing test first, then implement.

Minimum coverage for each area:

- **Result**: constructors, type narrowing, map, flatMap, match, unwrap, combine
- **Errors**: each class, category, retryable, taxonomy maps, instanceof
- **Trail/Route/Event**: definition, type discriminant, all fields
- **Trailhead**: auto-scanning, duplicate rejection, topo methods
- **Context**: factory defaults, overrides, extensibility
- **Layer**: composition, short-circuit, input/output transformation
- **Validation**: valid/invalid input, Zod issue formatting, JSON Schema conversion
- **Resilience**: retry logic, timeout, backoff, abort signal
- **Serialization**: round-trip, safe parse/stringify
- **fromFetch**: HTTP status mapping, network errors, abort
- **Branded**: validation, type safety
- **Guards**: type narrowing, edge cases
- **Collections**: chunk, dedupe, groupBy, sortBy, NonEmptyArray
- **Path security**: traversal prevention, safe resolution
- **Workspace**: root detection, relative paths
- **BlobRef**: creation, file reading
- **Job**: status/progress fields, combined schema proof
- **Patterns**: each pattern function produces valid schemas
- **Redaction**: default patterns, custom patterns

Run all tests: `cd packages/core && bun test`

---

## Definition of Done

- [ ] `@ontrails/core` package exists with all files listed above
- [ ] Result type with Ok/Err classes, map/flatMap/match/combine (~80 LOC)
- [ ] 13 error classes extending TrailsError with correct categories
- [ ] Taxonomy maps (exitCode, statusCode, jsonRpc, retryable)
- [ ] `trail()` function returns Trail with `kind: "trail"` discriminant
- [ ] `route()` function returns Route with `follows` and `kind: "route"`
- [ ] `event()` function returns Event with `kind: "event"`
- [ ] `trailhead()` auto-scans modules, builds Topo, rejects duplicates
- [ ] TrailContext interface with required signal, optional follow/permit/logger/progress
- [ ] `createTrailContext()` factory with auto requestId and signal
- [ ] Implementation and SyncImplementation type aliases
- [ ] Layer interface and composeLayers utility
- [ ] HealthStatus and HealthResult types
- [ ] IndexAdapter, StorageAdapter, CacheAdapter port interfaces
- [ ] validateInput, formatZodIssues, zodToJsonSchema
- [ ] retry, withTimeout, shouldRetry, getBackoffDelay
- [ ] serializeError, deserializeError, safeParse, safeStringify
- [ ] fromFetch with HTTP status -> error class mapping
- [ ] Branded type mechanism with UUID, Email, NonEmptyString, PositiveInt
- [ ] Type guards: isDefined, isNonEmptyString, isPlainObject, hasProperty
- [ ] Collections: chunk, dedupe, groupBy, sortBy, NonEmptyArray
- [ ] Path security: securePath, isPathSafe, resolveSafePath
- [ ] Workspace: findWorkspaceRoot, isInsideWorkspace, getRelativePath
- [ ] BlobRef type and creation utilities
- [ ] Job pattern proof (statusFields + progressFields across surfaces)
- [ ] `@ontrails/core/patterns` subpath with all 8 pattern categories
- [ ] `@ontrails/core/redaction` subpath with createRedactor and DEFAULT_PATTERNS
- [ ] Package exports structure (main barrel + 2 subpaths)
- [ ] All tests pass (`bun test` in packages/core)
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] Changeset added
