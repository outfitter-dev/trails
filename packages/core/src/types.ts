import type { TrailsError } from './errors.js';
import type { Result } from './result.js';
import type { Signal } from './signal.js';
import type { AnyTrail } from './trail.js';
import type { CrossInput, TrailOutput } from './type-utils.js';
import type { ActivationProvenance } from './activation-provenance.js';

// ---------------------------------------------------------------------------
// Detour
// ---------------------------------------------------------------------------

/** A recovery path that activates when a trail's blaze fails with a matching error. */
export interface Detour<Input, Output, TErr extends TrailsError = TrailsError> {
  /* oxlint-disable-next-line no-explicit-any -- standard pattern for matching abstract+concrete class constructors */
  readonly on: abstract new (...args: any[]) => TErr;
  readonly maxAttempts?: number | undefined;
  readonly recover: (
    attempt: DetourAttempt<Input, TErr>,
    ctx: TrailContext
  ) => Promise<Result<Output, TrailsError>>;
}

/** Context passed to a detour's recover function on each attempt. */
export interface DetourAttempt<Input, TErr extends TrailsError = TrailsError> {
  /** 1-indexed attempt number */
  readonly attempt: number;
  /** The matched error */
  readonly error: TErr;
  /** Original trail input */
  readonly input: Input;
}

type CrossBatchCall<TTarget extends AnyTrail | string = AnyTrail | string> =
  TTarget extends AnyTrail
    ? readonly [trail: TTarget, input: CrossInput<TTarget>]
    : readonly [id: string, input: unknown];

type CrossBatchResult<TTarget extends AnyTrail | string> =
  TTarget extends AnyTrail
    ? Result<TrailOutput<TTarget>, Error>
    : Result<unknown, Error>;

type CrossBatchResults<TCalls extends readonly CrossBatchCall[]> = {
  readonly [K in keyof TCalls]: TCalls[K] extends readonly [
    infer TTarget,
    unknown,
  ]
    ? TTarget extends AnyTrail | string
      ? CrossBatchResult<TTarget>
      : never
    : never;
};

/** Runtime options for batch `ctx.cross([...])` calls. */
export interface CrossBatchOptions {
  /**
   * Maximum number of branches to execute concurrently.
   *
   * Omit for unbounded concurrency. `1` is equivalent to sequential execution.
   */
  readonly concurrency?: number | undefined;
}

/**
 * Trail implementation — sync or async.
 *
 * Authors can return `Result` directly or wrap it in a `Promise`. The framework
 * normalizes with `await` at every call site, so both forms work transparently.
 */
export type Implementation<I, O> = (
  input: I,
  ctx: TrailContext
) => Result<O, Error> | Promise<Result<O, Error>>;

/**
 * Invoke another trail — used for trail composition.
 *
 * Two call shapes:
 *
 * - **By trail object** (typed): `ctx.cross(showGist, { id })` — the compiler
 *   infers `I` and `O` from the trail's schemas, so the result is fully typed.
 * - **By string id** (untyped escape hatch): `ctx.cross('gist.show', { id })`
 *   — returns `Result<O, Error>` where `O` defaults to `unknown`.
 * - **By batch**: `ctx.cross([[showGist, { id }], ['audit.log', payload]])`
 *   — executes every crossing concurrently and resolves once all results are
 *   available. Result ordering always matches the input tuple ordering. Pass
 *   `{ concurrency: N }` as the second argument to limit how many branches
 *   run at once.
 */
export interface CrossFn {
  <const TCalls extends readonly CrossBatchCall[]>(
    calls: TCalls,
    options?: CrossBatchOptions
  ): Promise<CrossBatchResults<TCalls>>;
  <T extends AnyTrail>(
    trail: T,
    input: CrossInput<T>
  ): Promise<Result<TrailOutput<T>, Error>>;
  <O = unknown>(id: string, input: unknown): Promise<Result<O, Error>>;
}

/**
 * Emit a signal — used for signal-driven activation.
 *
 * Fan-out to consumer trails (those with the signal in their `on:` array) is
 * the framework's responsibility. Producers call with a `Signal<T>` value and
 * get best-effort `Promise<void>` semantics: payload validation, missing topo
 * entries, guard suppression, and consumer failures are observable through
 * diagnostics/logging but do not become producer-facing `Result` plumbing.
 * Consumers fan out in parallel, each with its own derived context. Runtime
 * cycle suppression is still signal-id-based against the current fire stack:
 * it prevents re-entrant loops but can over-suppress legitimate diamond
 * re-fires, with a debug breadcrumb and a warn emitted when suppression
 * happens.
 */
export type FireFn = <T>(signal: Signal<T>, payload: T) => Promise<void>;

/** Resolve a resource instance from the current trail context. */
export type ResourceLookup = <T = unknown>(
  resourceOrId: { readonly id: string } | string
) => T;

/**
 * Wrap the execution of `fn` in a child trace span.
 *
 * Creates a nested span under the current trail's root trace record, times
 * the callback, records success or failure (including error category), and
 * writes the completed span to the registered sink. Errors thrown by `fn`
 * are recorded on the span and then rethrown — tracing never swallows them.
 */
export type TraceFn = <T>(
  label: string,
  fn: () => T | Promise<T>
) => Promise<T>;

/** Callback for reporting progress from long-running trails */
export type ProgressCallback = (event: ProgressEvent) => void;

/** Structured progress event emitted during trail execution */
export interface ProgressEvent {
  readonly type: 'start' | 'progress' | 'complete' | 'error';
  readonly current?: number | undefined;
  readonly total?: number | undefined;
  readonly message?: string | undefined;
  readonly ts: string;
}

/** Minimal logger interface — implementations can bridge to any logging library */
export interface Logger {
  readonly name?: string | undefined;
  trace(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  fatal(message: string, data?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

export type LogLevel =
  | 'debug'
  | 'error'
  | 'fatal'
  | 'info'
  | 'silent'
  | 'trace'
  | 'warn';

export interface LogRecord {
  readonly category: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
}

export interface LogSink {
  readonly name: string;
  readonly write: (record: LogRecord) => void;
  readonly flush?: (() => Promise<void>) | undefined;
}

/**
 * Context extension key for the invoking surface name.
 *
 * @remarks The string value is retained for beta compatibility with existing
 * trace and permit metadata while public API vocabulary moves to surfaces.
 */
export const SURFACE_KEY = '__trails_trailhead' as const;

/** @deprecated Prefer `SURFACE_KEY`. */
export const TRAILHEAD_KEY = SURFACE_KEY;

/** Minimal permit shape available on TrailContext. Permits extends this. */
export interface BasePermit {
  readonly id: string;
  readonly scopes: readonly string[];
}

/** Runtime context threaded through every trail execution */
export interface TrailContext {
  readonly activation?: ActivationProvenance | undefined;
  readonly requestId: string;
  readonly abortSignal: AbortSignal;
  readonly cross?: CrossFn | undefined;
  /**
   * Emit a typed signal. Fans out to every trail with the signal in its
   * `on:` declaration. Bound by the runner that holds the topo (typically
   * `run()`); undefined when a context is constructed without topo access.
   */
  readonly fire?: FireFn | undefined;
  readonly permit?: BasePermit;
  readonly workspaceRoot?: string | undefined;
  readonly logger?: Logger | undefined;
  readonly progress?: ProgressCallback | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
  readonly resource?: ResourceLookup | undefined;
  /**
   * Wrap a callback in a child trace span.
   *
   * Always present on contexts produced by `executeTrail` or
   * `createTrailContext`. Optional on the interface so manually constructed
   * contexts (tests, ad-hoc compositions) don't have to supply one — call
   * sites tolerate `undefined` by falling back to a no-op passthrough.
   */
  readonly trace?: TraceFn | undefined;
}

/**
 * Permit requirement declared on a trail spec.
 *
 * A scopes object means the trail requires a permit with those scopes.
 * `'public'` means the trail has explicitly opted out of auth.
 * Omitting the field entirely means the trail hasn't declared an auth posture.
 */
export type PermitRequirement =
  | { readonly scopes: readonly string[] }
  | 'public';

/** Input shape used to seed a runtime TrailContext before resolution. */
export type TrailContextInit = Omit<TrailContext, 'resource' | 'trace'> & {
  readonly resource?: ResourceLookup | undefined;
  readonly trace?: TraceFn | undefined;
};
