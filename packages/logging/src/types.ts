// ---------------------------------------------------------------------------
// Log Level
// ---------------------------------------------------------------------------

export type LogLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'silent';

// ---------------------------------------------------------------------------
// Log Metadata & Record
// ---------------------------------------------------------------------------

export type LogMetadata = Record<string, unknown>;

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly category: string;
  readonly timestamp: Date;
  readonly metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sink
// ---------------------------------------------------------------------------

export interface LogSink {
  readonly name: string;
  write(record: LogRecord): void;
  flush?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export interface LogFormatter {
  format(record: LogRecord): string;
}

// ---------------------------------------------------------------------------
// Sink Options
// ---------------------------------------------------------------------------

export interface ConsoleSinkOptions {
  /** Formatter to use. Defaults to createPrettyFormatter() in dev, createJsonFormatter() in production. */
  readonly formatter?: LogFormatter | undefined;
  /** Send all output to stderr. Defaults to false (stderr only for warn/error/fatal). */
  readonly stderr?: boolean | undefined;
}

export interface FileSinkOptions {
  /** Path to the log file. */
  readonly path: string;
  /** Formatter. Defaults to createJsonFormatter(). */
  readonly formatter?: LogFormatter | undefined;
}

// ---------------------------------------------------------------------------
// Pretty Formatter Options
// ---------------------------------------------------------------------------

export interface PrettyFormatterOptions {
  /** Show timestamps. Defaults to true. */
  readonly timestamps?: boolean | undefined;
  /** Use colors (ANSI). Defaults to true when stdout is a TTY. */
  readonly colors?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Logger Config
// ---------------------------------------------------------------------------

export interface LoggerConfig {
  /** Logger category name. Dot-separated for hierarchy: "app.db.queries" */
  readonly name: string;

  /** Base log level. Overridden by category-specific levels and env vars. */
  readonly level?: LogLevel | undefined;

  /** Category prefix -> level mapping for hierarchical filtering. */
  readonly levels?: Record<string, LogLevel> | undefined;

  /** Sinks to write log records to. Defaults to [createConsoleSink()]. */
  readonly sinks?: readonly LogSink[] | undefined;

  /** Redaction config. Defaults to core's DEFAULT_PATTERNS + DEFAULT_SENSITIVE_KEYS. */
  readonly redaction?:
    | {
        readonly patterns?: RegExp[] | undefined;
        readonly sensitiveKeys?: string[] | undefined;
      }
    | undefined;
}
