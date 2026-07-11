import type { TrailsError } from './errors.js';
import type { BasePermit } from './permits.js';
import type { Result } from './result.js';
import type { Signal } from './signal.js';
import type { AnyTrail } from './trail.js';
import type { ComposeInput, TrailOutput } from './type-utils.js';
import type { ActivationProvenance } from './activation-provenance.js';
import type { TrailVersionReference } from './version-resolution.js';

// ---------------------------------------------------------------------------
// Detour
// ---------------------------------------------------------------------------

/** A recovery path that activates when a trail's implementation fails with a matching error. */
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

type ComposeBatchCall<TTarget extends AnyTrail | string = AnyTrail | string> =
  TTarget extends AnyTrail
    ? readonly [trail: TTarget, input: ComposeInput<TTarget>]
    : readonly [id: string, input: unknown];

type ComposeBatchResult<TTarget extends AnyTrail | string> =
  TTarget extends AnyTrail
    ? Result<TrailOutput<TTarget>, Error>
    : Result<unknown, Error>;

type ComposeBatchResults<TCalls extends readonly ComposeBatchCall[]> = {
  readonly [K in keyof TCalls]: TCalls[K] extends readonly [
    infer TTarget,
    unknown,
  ]
    ? TTarget extends AnyTrail | string
      ? ComposeBatchResult<TTarget>
      : never
    : never;
};

/** Runtime options for batch `ctx.compose([...])` calls. */
export interface ComposeBatchOptions {
  /**
   * Maximum number of branches to execute concurrently.
   *
   * Omit for unbounded concurrency. `1` is equivalent to sequential execution.
   */
  readonly concurrency?: number | undefined;
}

/** Runtime options for a single `ctx.compose(trail, input, options)` call. */
export interface ComposeOptions {
  /**
   * Execute a specific live version of the composed trail.
   *
   * Omit to keep composition current by default. Historical revision entries
   * transpose through the current trail; fork entries run their own implementation.
   */
  readonly version?: TrailVersionReference | undefined;
}

/**
 * Trail implementation — sync or async.
 *
 * Authors can return `Result` directly or wrap it in a `Promise`. The framework
 * normalizes with `await` at every call site, so both forms work transparently.
 */
export type Implementation<I, O, Ctx extends TrailContext = TrailContext> = (
  input: I,
  ctx: Ctx
) => Result<O, Error> | Promise<Result<O, Error>>;

/**
 * Invoke another trail — used for trail composition.
 *
 * Two call shapes:
 *
 * - **By trail object** (typed): `ctx.compose(showGist, { id })` — the compiler
 *   infers `I` and `O` from the trail's schemas, so the result is fully typed.
 * - **By string id** (untyped escape hatch): `ctx.compose('gist.show', { id })`
 *   — returns `Result<O, Error>` where `O` defaults to `unknown`.
 * - **By batch**: `ctx.compose([[showGist, { id }], ['audit.log', payload]])`
 *   — executes every composing concurrently and resolves once all results are
 *   available. Result ordering always matches the input tuple ordering. Pass
 *   `{ concurrency: N }` as the second argument to limit how many branches
 *   run at once.
 */
export interface ComposeFn {
  <const TCalls extends readonly ComposeBatchCall[]>(
    calls: TCalls,
    options?: ComposeBatchOptions
  ): Promise<ComposeBatchResults<TCalls>>;
  <T extends AnyTrail>(
    trail: T,
    input: ComposeInput<T>,
    options?: ComposeOptions
  ): Promise<Result<TrailOutput<T>, Error>>;
  <O = unknown>(
    id: string,
    input: unknown,
    options?: ComposeOptions
  ): Promise<Result<O, Error>>;
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

export interface LogFormatter {
  format(record: LogRecord): string;
}

/**
 * Context extension key for the invoking surface name.
 */
export const SURFACE_KEY = '__trails_surface' as const;

/**
 * Context extension key for the layer names attached by the invoking surface.
 */
export const SURFACE_LAYER_NAMES_KEY = '__trails_surface_layer_names' as const;

/**
 * Context extension key carrying per-layer runtime input.
 *
 * Surfaces (CLI, MCP, HTTP) project each typed layer's `input` schema onto
 * their native idioms (flags, tool params, query strings). At execute time
 * the parsed values are partitioned per layer and stored under this key as
 * `Record<layerName, unknown>`. Layers that need runtime input read their
 * own slot via `ctx.extensions?.[LAYER_INPUTS_KEY]?.[layer.name]`.
 *
 * @see TRL-473 for the CLI projection contract.
 */
export const LAYER_INPUTS_KEY = '__trails_layer_inputs' as const;

/** Runtime context threaded through every trail execution */
export interface TrailContext {
  readonly activation?: ActivationProvenance | undefined;
  readonly requestId: string;
  readonly abortSignal: AbortSignal;
  readonly compose?: ComposeFn | undefined;
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
   * Whether the current invocation is a dry run.
   *
   * Defaults to `false`. Trails that don't read this field are unaffected.
   * Trails that do read it decide what dry-run means for their domain — for
   * example: preview the change without committing, validate inputs without
   * performing side effects, or return what would happen without actually
   * doing it.
   *
   * The framework only carries the flag from the surface (e.g. CLI
   * `--dry-run`) into the context. It never short-circuits trail execution
   * on its own based on this field.
   *
   * Pair this runtime signal with `TrailSpec.dryRun`, which declares whether a
   * trail supports dry-run semantics for governance, derivation, and surface
   * tooling.
   *
   * @remarks Always defined on contexts produced by `executeTrail` or
   * `createTrailContext` (normalized to `false` when not provided).
   */
  readonly dryRun?: boolean | undefined;
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

/** Trail context for implementations that declare trail composition. */
export interface ComposeTrailContext extends TrailContext {
  readonly compose: ComposeFn;
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
