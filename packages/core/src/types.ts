import type { Result } from './result.js';
import type { Signal } from './signal.js';

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

/** Invoke another trail by id — used for trail composition */
export type CrossFn = <O>(
  id: string,
  input: unknown
) => Promise<Result<O, Error>>;

/**
 * Emit a signal — used for signal-driven activation.
 *
 * Fan-out to consumer trails (those with the signal in their `on:` array) is
 * the framework's responsibility. Producers get `Result.ok(undefined)` unless
 * the signal id is unknown or the payload fails schema validation. Consumer
 * errors are logged but do not propagate back to the producer.
 *
 * Two call shapes are supported:
 *
 * - **By id** (base shape): `ctx.fire('order.placed', { ... })`. Matches
 *   the shape of `ctx.cross`; payload is typed as `unknown` and validated
 *   against the signal's schema at the fire boundary.
 * - **By signal value** (progressive disclosure): `ctx.fire(orderPlaced, payload)`
 *   where `orderPlaced` is a `Signal<T>`. The compiler enforces that
 *   `payload` matches the signal's declared schema type at the call site,
 *   on top of the runtime validation.
 */
export interface FireFn {
  <T>(signal: Signal<T>, payload: T): Promise<Result<void, Error>>;
  (signalId: string, payload: unknown): Promise<Result<void, Error>>;
}

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

/** Context extension key for the invoking trailhead name. */
export const TRAILHEAD_KEY = '__trails_trailhead' as const;

/** Minimal permit shape available on TrailContext. Permits extends this. */
export interface BasePermit {
  readonly id: string;
  readonly scopes: readonly string[];
}

/** Runtime context threaded through every trail execution */
export interface TrailContext {
  readonly requestId: string;
  readonly abortSignal: AbortSignal;
  readonly cross?: CrossFn | undefined;
  /**
   * Emit a signal by id. Fans out to every trail with the signal in its
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
