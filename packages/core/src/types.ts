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

/** Minimal TrailContext stub — full version comes in TRL-9 */
export interface TrailContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly [key: string]: unknown;
}

export type Surface = 'cli' | 'mcp' | 'http' | 'ws';
