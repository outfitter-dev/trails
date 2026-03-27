# Stage 04 — @ontrails/logging

> Structured logging with no logtape dependency, hierarchical category filtering, and a clean single-function API.

---

## Overview

`@ontrails/logging` owns the logging pipeline end-to-end. One API: `createLogger(config)`. No factory ceremony, no bridge, no dual code paths. The package provides built-in sinks and formatters, consumes redaction from `@ontrails/core/redaction`, and offers a logtape sink adapter as an optional subpath export (`@ontrails/logging/logtape`) for teams with existing logtape infrastructure.

The key feature beyond basic structured logging is **hierarchical category filtering**: a logger named `"app.db.queries"` inherits the level from `"app.db"` if not explicitly set, falling back to `"app"`, then the global default. This gives fine-grained control without per-logger configuration.

---

## Prerequisites

- **Stage 01 complete** -- `@ontrails/core` ships `Result`, error taxonomy, `TrailContext`, and the `@ontrails/core/redaction` subpath (`createRedactor()`, `DEFAULT_PATTERNS`, `DEFAULT_SENSITIVE_KEYS`, `RedactorConfig`, `Redactor` interface).
- `LogLevel` type defined in `@ontrails/core` and re-exported by this package.
- `Logger` interface defined in `@ontrails/core` (the port that `TrailContext.logger` uses).

---

## Implementation Guide

### Package Setup

```
packages/logging/
  package.json
  tsconfig.json
  src/
    index.ts              # Public API
    logger.ts             # createLogger, LoggerInstance
    levels.ts             # LEVEL_PRIORITY, shouldLog, resolveCategory
    sinks.ts              # createConsoleSink, createFileSink
    formatters.ts         # createJsonFormatter, createPrettyFormatter
    env.ts                # resolveLogLevel
    types.ts              # LoggerConfig, Sink, Formatter, etc.
    logtape/
      index.ts            # logtapeSink adapter
    __tests__/
      logger.test.ts
      levels.test.ts
      sinks.test.ts
      formatters.test.ts
      env.test.ts
      logtape.test.ts
```

**package.json exports:**

```json
{
  "name": "@ontrails/logging",
  "exports": {
    ".": "./src/index.ts",
    "./logtape": "./src/logtape/index.ts"
  },
  "peerDependencies": {
    "@ontrails/core": "workspace:*"
  },
  "peerDependenciesMeta": {
    "@logtape/logtape": { "optional": true }
  }
}
```

No `@logtape/logtape` in `dependencies`. It only appears as an optional peer for the `/logtape` subpath.

### `createLogger(config)` -- The Single API

```typescript
export interface LoggerConfig {
  /** Logger category name. Dot-separated for hierarchy: "app.db.queries" */
  readonly name: string;

  /** Base log level. Overridden by category-specific levels and env vars. */
  readonly level?: LogLevel;

  /** Category prefix -> level mapping for hierarchical filtering. */
  readonly levels?: Record<string, LogLevel>;

  /** Sinks to write log records to. Defaults to [createConsoleSink()]. */
  readonly sinks?: readonly Sink[];

  /** Redaction config. Defaults to core's DEFAULT_PATTERNS + DEFAULT_SENSITIVE_KEYS. */
  readonly redaction?: RedactorConfig;
}

export function createLogger(config: LoggerConfig): LoggerInstance;
```

`createLogger` is the only way to create a logger. No factory, no adapter, no intermediate wrapper. It:

1. Resolves the effective log level from `config.level`, `config.levels` hierarchy, and environment (`TRAILS_LOG_LEVEL`).
2. Creates a `Redactor` from `@ontrails/core/redaction` using the provided config (or defaults).
3. Wraps the sinks (default: `[createConsoleSink()]`) behind a level check and redaction pass.
4. Returns a `LoggerInstance`.

### `LoggerInstance`

```typescript
export interface LoggerInstance {
  trace(message: string, metadata?: LogMetadata): void;
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  fatal(message: string, metadata?: LogMetadata): void;

  /** Create a child logger with inherited config and additional metadata. */
  child(metadata: LogMetadata): LoggerInstance;

  /** The resolved category name. */
  readonly name: string;
}
```

`LoggerInstance` satisfies the `Logger` interface from `@ontrails/core`, so it can be used as `TrailContext.logger`.

**`child(metadata)`** creates a new `LoggerInstance` that:

- Inherits the parent's sinks, level config, and redaction.
- Merges the provided metadata into every log record (useful for `{ requestId, trail, surface }` enrichment).
- Does not create a new sink pipeline -- child loggers share the parent's sinks.

### Hierarchical Category Filtering

The `levels` config maps category prefixes to log levels:

```typescript
const logger = createLogger({
  name: 'app.db.queries',
  level: 'info', // global fallback
  levels: {
    app: 'info',
    'app.db': 'debug',
    'app.http': 'warn',
  },
});
```

**Resolution algorithm** (`resolveCategory`):

1. Look up the exact category name in `levels` (e.g., `"app.db.queries"`).
2. If not found, strip the last segment and try again (e.g., `"app.db"`).
3. Continue until a match is found or segments are exhausted.
4. Fall back to `config.level`, then `resolveLogLevel()` from env, then `"info"`.

Implementation:

```typescript
export function resolveCategory(
  name: string,
  levels: Record<string, LogLevel> | undefined,
  fallback: LogLevel
): LogLevel {
  if (!levels) return fallback;

  let prefix = name;
  while (prefix.length > 0) {
    const level = levels[prefix];
    if (level !== undefined) return level;
    const lastDot = prefix.lastIndexOf('.');
    if (lastDot === -1) break;
    prefix = prefix.slice(0, lastDot);
  }
  return fallback;
}
```

### Level Priority and `shouldLog`

```typescript
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
  silent: 6,
};

export function shouldLog(
  messageLevel: LogLevel,
  configuredLevel: LogLevel
): boolean {
  return LEVEL_PRIORITY[messageLevel] >= LEVEL_PRIORITY[configuredLevel];
}
```

The level check runs before redaction and before any sink dispatch. If the message level is below the configured level, the call is a no-op.

### Built-in Sinks

A `Sink` receives a formatted log record:

```typescript
export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly category: string;
  readonly timestamp: Date;
  readonly metadata: Record<string, unknown>;
}

export interface Sink {
  readonly name: string;
  write(record: LogRecord): void;
  flush?(): Promise<void>;
}
```

#### `createConsoleSink(options?)`

```typescript
export interface ConsoleSinkOptions {
  /** Formatter to use. Defaults to createPrettyFormatter() in dev, createJsonFormatter() in production. */
  readonly formatter?: Formatter;
  /** Output stream. Defaults to stderr for warn/error/fatal, stdout for others. */
  readonly stderr?: boolean;
}

export function createConsoleSink(options?: ConsoleSinkOptions): Sink;
```

Maps log levels to `console.debug`, `console.info`, `console.warn`, `console.error`. Uses the configured formatter to produce the string.

#### `createFileSink(options)`

```typescript
export interface FileSinkOptions {
  /** Path to the log file. */
  readonly path: string;
  /** Formatter. Defaults to createJsonFormatter(). */
  readonly formatter?: Formatter;
}

export function createFileSink(options: FileSinkOptions): Sink;
```

Appends formatted log records to a file. Uses `Bun.file()` for writes. The `flush()` method ensures all buffered writes are complete.

### Built-in Formatters

```typescript
export interface Formatter {
  format(record: LogRecord): string;
}
```

#### `createJsonFormatter()`

Produces one JSON object per log record, newline-delimited:

```json
{
  "level": "info",
  "message": "Entity created",
  "category": "app.entity",
  "timestamp": "2026-03-25T10:00:00.000Z",
  "requestId": "abc-123",
  "entityId": "e1"
}
```

Metadata fields are flattened into the top-level object. Timestamp is ISO 8601.

#### `createPrettyFormatter(options?)`

```typescript
export interface PrettyFormatterOptions {
  /** Show timestamps. Defaults to true. */
  readonly timestamps?: boolean;
  /** Use colors (ANSI). Defaults to true when stdout is a TTY. */
  readonly colors?: boolean;
}

export function createPrettyFormatter(
  options?: PrettyFormatterOptions
): LogFormatter;
```

Produces human-readable output:

```
10:00:00 INFO  [app.entity] Entity created  requestId=abc-123 entityId=e1
```

Uses `Bun.color()` for ANSI colors when available.

### Redaction Integration

`createLogger` creates a `Redactor` from `@ontrails/core/redaction`:

```typescript
import {
  createRedactor,
  DEFAULT_PATTERNS,
  DEFAULT_SENSITIVE_KEYS,
} from '@ontrails/core/redaction';

// Inside createLogger:
const redactor = createRedactor({
  patterns: [...DEFAULT_PATTERNS, ...(config.redaction?.patterns ?? [])],
  sensitiveKeys: [
    ...DEFAULT_SENSITIVE_KEYS,
    ...(config.redaction?.sensitiveKeys ?? []),
  ],
});
```

Before dispatching to sinks, the logger runs metadata through the redactor:

```typescript
function log(level: LogLevel, message: string, metadata?: LogMetadata): void {
  if (!shouldLog(level, effectiveLevel)) return;

  const record: LogRecord = {
    level,
    message: redactor.redact(message),
    category: config.name,
    timestamp: new Date(),
    metadata: metadata ? redactor.redactObject(metadata) : {},
  };

  for (const sink of sinks) {
    sink.write(record);
  }
}
```

No global mutable redaction config. Rules are declarative, set at logger creation time.

### `resolveLogLevel()` from Environment

```typescript
export function resolveLogLevel(
  env?: Record<string, string | undefined>
): LogLevel | undefined;
```

Resolution order:

1. `TRAILS_LOG_LEVEL` env var (if valid log level string).
2. `TRAILS_ENV` profile defaults:
   - `development` -> `"debug"`
   - `test` -> `undefined` (no logging by default)
   - `production` -> `undefined` (falls through to `"info"`)
3. Returns `undefined` if no env-based level is configured (caller uses its own default).

### The `/logtape` Subpath

`@ontrails/logging/logtape` exports a single function that bridges Trails logging to an existing logtape logger:

```typescript
// @ontrails/logging/logtape
import type { Logger as LogtapeLogger } from '@logtape/logtape';

export interface LogtapeSinkOptions {
  /** An existing logtape logger to forward records to. */
  readonly logger: LogtapeLogger;
}

export function logtapeSink(options: LogtapeSinkOptions): Sink;
```

The sink forwards `LogRecord` to the logtape logger, mapping Trails levels to logtape levels. Redaction runs before the sink -- sensitive data is scrubbed regardless of the backend.

**This subpath has `@logtape/logtape` as an optional peer dependency.** The main `@ontrails/logging` package does not depend on logtape at all.

### Package Exports Summary

```typescript
// @ontrails/logging (main)
export { createLogger } from './logger.js';
export type { Logger, LoggerConfig } from './types.js';

// Re-exports from core
export type { Logger, LogLevel, LogMetadata, LogMethod } from '@ontrails/core';

// Sinks and formatters
export { createConsoleSink, createFileSink } from './sinks.js';
export { createJsonFormatter, createPrettyFormatter } from './formatters.js';
export type {
  LogSink,
  LogFormatter,
  ConsoleSinkOptions,
  FileSinkOptions,
  PrettyFormatterOptions,
} from './types.js';

// Level resolution
export { resolveLogLevel } from './env.js';

// @ontrails/logging/logtape
export { logtapeSink } from './logtape/index.js';
export type { LogtapeSinkOptions } from './logtape/index.js';
```

---

## Testing Requirements

### `logger.test.ts`

- `createLogger` with default config produces a working logger.
- All six log methods (trace through fatal) dispatch to sinks at appropriate levels.
- `child()` inherits parent config and merges metadata.
- Child logger metadata appears on every log record.
- Multiple `child()` calls compose metadata correctly.
- Redaction is applied to messages and metadata before sink dispatch.
- Default redaction scrubs patterns matching `DEFAULT_PATTERNS` and keys matching `DEFAULT_SENSITIVE_KEYS`.
- Custom redaction patterns are applied when provided.
- Logger with no sinks does not throw.

### `levels.test.ts`

- `resolveCategory` returns exact match for a full category name.
- `resolveCategory` walks up the hierarchy: `"app.db.queries"` -> `"app.db"` -> `"app"`.
- `resolveCategory` returns fallback when no prefix matches.
- `shouldLog` returns true when message level >= configured level.
- `shouldLog` returns false when message level < configured level.
- `"silent"` level suppresses all messages.

### `sinks.test.ts`

- `createConsoleSink` writes to console methods at correct levels.
- `createConsoleSink` uses the provided formatter.
- `createFileSink` appends records to the specified file.
- `createFileSink` `flush()` completes pending writes.
- Sink `write` receives a well-formed `LogRecord`.

### `formatters.test.ts`

- `createJsonFormatter` produces valid JSON with all record fields.
- `createJsonFormatter` flattens metadata into top-level object.
- `createPrettyFormatter` produces human-readable output with level, category, and message.
- `createPrettyFormatter` respects `timestamps` and `colors` options.

### `env.test.ts`

- `resolveLogLevel` reads from `TRAILS_LOG_LEVEL`.
- `resolveLogLevel` falls back to `TRAILS_ENV` profile defaults.
- `resolveLogLevel` returns `undefined` when no env is set.
- Invalid `TRAILS_LOG_LEVEL` values are ignored.

### `logtape.test.ts`

- `logtapeSink` forwards records to the logtape logger.
- Level mapping is correct (trace->trace, debug->debug, etc.).
- Redaction runs before the logtape sink receives records.

---

## Definition of Done

- [ ] `createLogger({ name: "app" })` is the only API. No factory, no adapter, no `Outfitter`-prefixed types.
- [ ] `LoggerInstance` implements the `Logger` interface from `@ontrails/core` and works as `TrailContext.logger`.
- [ ] Hierarchical category filtering resolves `"app.db.queries"` through `"app.db"` to `"app"` to fallback.
- [ ] `createConsoleSink()` and `createFileSink()` work out of the box.
- [ ] `createJsonFormatter()` and `createPrettyFormatter()` produce correct output.
- [ ] Redaction uses `@ontrails/core/redaction` -- no local redaction system.
- [ ] `resolveLogLevel()` reads `TRAILS_LOG_LEVEL` and `TRAILS_ENV` with correct precedence.
- [ ] `@ontrails/logging/logtape` provides a sink adapter with no logtape dependency in the main package.
- [ ] No `@logtape/logtape` in `dependencies` -- only an optional peer for the `/logtape` subpath.
- [ ] All tests pass.
- [ ] Package exports are clean -- no internal types leak.
