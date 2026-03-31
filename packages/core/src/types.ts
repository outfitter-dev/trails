import type { Result } from './result.js';

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
export type FollowFn = <O>(
  id: string,
  input: unknown
) => Promise<Result<O, Error>>;

/** Resolve a service instance from the current trail context. */
export type ServiceLookup = <T = unknown>(
  serviceOrId: { readonly id: string } | string
) => T;

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

/** Context extension key for the invoking surface name. */
export const SURFACE_KEY = '__trails_surface' as const;

/** Minimal permit shape available on TrailContext. Permits extends this. */
export interface BasePermit {
  readonly id: string;
  readonly scopes: readonly string[];
}

/** Context extension key for the invoking surface name. */
export const SURFACE_KEY = '__trails_surface' as const;

/** Runtime context threaded through every trail execution */
export interface TrailContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly follow?: FollowFn | undefined;
  readonly permit?: BasePermit;
  readonly workspaceRoot?: string | undefined;
  readonly logger?: Logger | undefined;
  readonly progress?: ProgressCallback | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
  readonly service?: ServiceLookup | undefined;
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
export type TrailContextInit = Omit<TrailContext, 'service'> & {
  readonly service?: ServiceLookup | undefined;
};
