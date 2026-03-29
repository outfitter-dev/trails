/**
 * Centralized trail execution pipeline.
 *
 * Validates input, builds context, composes layers, and runs the
 * implementation. Surfaces (CLI, MCP, HTTP) delegate here instead
 * of reimplementing the pipeline.
 */

import type { AnyTrail } from './trail.js';
import type { Layer } from './layer.js';
import type { TrailContext } from './types.js';

import { composeLayers } from './layer.js';
import { createTrailContext } from './context.js';
import { InternalError } from './errors.js';
import { Result } from './result.js';
import { validateInput } from './validation.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for executeTrail. */
export interface ExecuteTrailOptions {
  /** Partial context overrides merged on top of the base context. */
  readonly ctx?: Partial<TrailContext> | undefined;
  /** AbortSignal override (takes final precedence over ctx and factory). */
  readonly signal?: AbortSignal | undefined;
  /** Layers to compose around the implementation. */
  readonly layers?: readonly Layer[] | undefined;
  /** Factory that produces a base TrailContext (takes precedence over defaults). */
  readonly createContext?:
    | (() => TrailContext | Promise<TrailContext>)
    | undefined;
}

// ---------------------------------------------------------------------------
// Context resolution
// ---------------------------------------------------------------------------

/**
 * Build a TrailContext from options.
 *
 * Resolution order:
 * 1. Factory (`createContext`) or `createTrailContext()` defaults.
 * 2. Partial `ctx` overrides merged on top.
 * 3. `signal` override takes final precedence.
 */
const resolveContext = async (
  options?: ExecuteTrailOptions
): Promise<TrailContext> => {
  const base = options?.createContext
    ? await options.createContext()
    : createTrailContext();
  const withOverrides = options?.ctx ? { ...base, ...options.ctx } : base;
  return options?.signal
    ? { ...withOverrides, signal: options.signal }
    : withOverrides;
};

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Execute a trail through the standard validate-context-layers-run pipeline.
 *
 * The function never throws -- unexpected exceptions are caught and
 * returned as `Result.err(InternalError)`.
 */
export const executeTrail = async (
  trail: AnyTrail,
  rawInput: unknown,
  options?: ExecuteTrailOptions
): Promise<Result<unknown, Error>> => {
  try {
    const validated = validateInput(trail.input, rawInput);
    if (validated.isErr()) {
      return validated;
    }

    const ctx = await resolveContext(options);
    const layers = options?.layers ?? [];
    const impl = composeLayers([...layers], trail, trail.run);
    return await impl(validated.value, ctx);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Result.err(new InternalError(message));
  }
};
