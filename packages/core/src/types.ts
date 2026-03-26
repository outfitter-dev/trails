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

<<<<<<< HEAD
/** Invoke another trail by id — used for trail composition */
export type FollowFn = <O>(
  id: string,
  input: unknown
) => Promise<Result<O, Error>>;

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

/** Runtime context threaded through every trail execution */
export interface TrailContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly follow?: FollowFn | undefined;
  readonly permit?: unknown | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly logger?: Logger | undefined;
  readonly progress?: ProgressCallback | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly [key: string]: unknown;
}

export type Surface = 'cli' | 'mcp' | 'http' | 'ws';
