/**
 * Centralized trail execution pipeline.
 *
 * Validates input, builds context, composes layers, and runs the
 * implementation. Surfaces (CLI, MCP, HTTP) delegate here instead
 * of reimplementing the pipeline.
 */

import type { AnyTrail } from './trail.js';
import type { Layer } from './layer.js';
import type { ServiceOverrideMap } from './service.js';
import type { TrailContext, TrailContextInit } from './types.js';

import { composeLayers } from './layer.js';
import { createTrailContext } from './context.js';
import { InternalError } from './errors.js';
import { Result } from './result.js';
import { createServiceLookup } from './service.js';
import { resolveServices } from './service-config.js';
import { validateInput } from './validation.js';

type MutableTrailContext = {
  -readonly [K in keyof TrailContext]: TrailContext[K];
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for executeTrail. */
export interface ExecuteTrailOptions {
  /** Partial context overrides merged on top of the base context. */
  readonly ctx?: Partial<TrailContextInit> | undefined;
  /** AbortSignal override (takes final precedence over ctx and factory). */
  readonly signal?: AbortSignal | undefined;
  /** Layers to compose around the implementation. */
  readonly layers?: readonly Layer[] | undefined;
  /** Factory that produces a base TrailContext (takes precedence over defaults). */
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  /** Explicit service instance overrides keyed by service ID. */
  readonly services?: ServiceOverrideMap | undefined;
  /** Config values for services that declare a `config` schema, keyed by service ID. */
  readonly configValues?:
    | Readonly<Record<string, Record<string, unknown>>>
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
  const seed = options?.createContext
    ? await options.createContext()
    : createTrailContext();
  const base = seed.service ? seed : createTrailContext(seed);
  const withOverrides = options?.ctx
    ? {
        ...base,
        ...options.ctx,
        extensions: { ...base.extensions, ...options.ctx.extensions },
      }
    : base;
  const resolved = options?.signal
    ? { ...withOverrides, signal: options.signal }
    : withOverrides;
  if (
    options?.ctx?.extensions !== undefined ||
    resolved.service === undefined
  ) {
    const bound = { ...resolved } as MutableTrailContext;
    bound.service = createServiceLookup(() => bound);
    return bound;
  }

  return resolved as TrailContext;
};

const prepareContext = async (
  trail: AnyTrail,
  options?: ExecuteTrailOptions
): Promise<Result<TrailContext, Error>> => {
  const baseCtx = await resolveContext(options);
  return await resolveServices(
    trail,
    baseCtx,
    options?.services,
    options?.configValues
  );
};

const runTrail = async (
  trail: AnyTrail,
  input: unknown,
  ctx: TrailContext,
  layers: readonly Layer[]
): Promise<Result<unknown, Error>> => {
  const impl = composeLayers([...layers], trail, trail.run);
  return await impl(input, ctx);
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

    const resolvedCtx = await prepareContext(trail, options);
    if (resolvedCtx.isErr()) {
      return resolvedCtx;
    }

    return await runTrail(
      trail,
      validated.value,
      resolvedCtx.value,
      options?.layers ?? []
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Result.err(new InternalError(message));
  }
};
