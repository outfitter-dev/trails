/**
 * Centralized trail execution pipeline.
 *
 * Validates input, builds context, composes layers, and runs the
 * implementation. Surfaces (CLI, MCP, HTTP) delegate here instead
 * of reimplementing the pipeline.
 */

import type { AnyTrail } from './trail.js';
import type { Layer } from './layer.js';
import type { ProvisionOverrideMap } from './resource.js';
import type { TraceContext, TraceRecord } from './internal/tracing.js';
import type { TraceFn, TrailContext, TrailContextInit } from './types.js';

import { composeLayers } from './layer.js';
import { createTrailContext } from './context.js';
import { CancelledError, InternalError, TrailsError } from './errors.js';
import {
  TRACE_CONTEXT_KEY,
  completeRecord,
  createRootTraceContext,
  createSpanRecord,
  createTraceRecord,
  getTraceSink,
  writeToSink,
} from './internal/tracing.js';
import { Result } from './result.js';
import { createProvisionLookup } from './resource.js';
import { resolveProvisions } from './resource-config.js';
import { TRAILHEAD_KEY } from './types.js';
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
  readonly abortSignal?: AbortSignal | undefined;
  /** Layers to compose around the implementation. */
  readonly layers?: readonly Layer[] | undefined;
  /** Factory that produces a base TrailContext (takes precedence over defaults). */
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  /** Explicit resource instance overrides keyed by resource ID. */
  readonly resources?: ProvisionOverrideMap | undefined;
  /** Config values for resources that declare a `config` schema, keyed by resource ID. */
  readonly configValues?:
    | Readonly<Record<string, Record<string, unknown>>>
    | undefined;
}

// ---------------------------------------------------------------------------
// Context resolution
// ---------------------------------------------------------------------------

const applyContextOverrides = (
  base: TrailContextInit,
  options?: ExecuteTrailOptions
): TrailContextInit => {
  const withOverrides = options?.ctx
    ? {
        ...base,
        ...options.ctx,
        extensions: { ...base.extensions, ...options.ctx.extensions },
      }
    : base;

  return options?.abortSignal
    ? { ...withOverrides, abortSignal: options.abortSignal }
    : withOverrides;
};

const bindProvisionLookup = (
  resolved: TrailContextInit,
  options?: ExecuteTrailOptions
): TrailContext => {
  if (
    options?.ctx?.extensions === undefined &&
    resolved.resource !== undefined
  ) {
    return resolved as TrailContext;
  }

  const bound = { ...resolved } as MutableTrailContext;
  const lookup = createProvisionLookup(() => bound);
  bound.resource = lookup;
  return bound;
};

/**
 * Build a TrailContext from options.
 *
 * Resolution order:
 * 1. Factory (`createContext`) or `createTrailContext()` defaults.
 * 2. Partial `ctx` overrides merged on top.
 * 3. `abortSignal` override takes final precedence.
 */
const resolveContext = async (
  options?: ExecuteTrailOptions
): Promise<TrailContext> => {
  const seed = options?.createContext
    ? await options.createContext()
    : createTrailContext();
  const base = seed.resource ? seed : createTrailContext(seed);
  const resolved = applyContextOverrides(base, options);
  return bindProvisionLookup(resolved, options);
};

const prepareContext = async (
  trail: AnyTrail,
  options?: ExecuteTrailOptions
): Promise<Result<TrailContext, Error>> => {
  const baseCtx = await resolveContext(options);
  return await resolveProvisions(
    trail,
    baseCtx,
    options?.resources,
    options?.configValues
  );
};

// ---------------------------------------------------------------------------
// Intrinsic tracing
// ---------------------------------------------------------------------------

/** Derive the status + error category fields from a trail result. */
const deriveOutcome = (
  result: Result<unknown, Error>
): {
  readonly status: TraceRecord['status'];
  readonly errorCategory: string | undefined;
} =>
  result.match<{
    readonly status: TraceRecord['status'];
    readonly errorCategory: string | undefined;
  }>({
    err: (error) => ({
      errorCategory: error instanceof TrailsError ? error.category : undefined,
      status: error instanceof CancelledError ? 'cancelled' : 'err',
    }),
    ok: () => ({ errorCategory: undefined, status: 'ok' }),
  });

/** Best-effort error category for a thrown (not Result.err) value. */
const categorizeSpanError = (error: unknown): string | undefined => {
  if (error instanceof TrailsError) {
    return error.category;
  }
  if (error instanceof Error) {
    return error.constructor.name;
  }
  return undefined;
};

/** Extract the permit identity fields for the trace record. */
const extractPermit = (
  ctx: TrailContext
): { readonly id: string; readonly tenantId?: string } | undefined => {
  if (ctx.permit === undefined) {
    return undefined;
  }
  const tenantId =
    'tenantId' in ctx.permit
      ? (ctx.permit as { tenantId?: string }).tenantId
      : undefined;
  return tenantId === undefined
    ? { id: ctx.permit.id }
    : { id: ctx.permit.id, tenantId };
};

/**
 * Build a `ctx.trace` function bound to a parent trace context.
 *
 * Each call creates a child span under the parent, times the callback,
 * records success/failure with the appropriate error category, writes the
 * completed span to the sink, and returns the callback result. Errors
 * thrown by the callback are recorded and then rethrown.
 *
 * The returned function reads the *current* trace context from its captured
 * parent. That means direct nesting (`ctx.trace('a', () => ctx.trace('b',
 * ...))`) produces siblings under `a`'s parent, not children of `a`. For
 * true child nesting, callers should cross into another trail (which gets
 * its own root record parented by this one) — full cross-trail parenting
 * is implemented in a later phase. For Phase 1, sibling spans under the
 * trail's root are the supported shape.
 */
const buildTraceFn = (parent: TraceContext): TraceFn => {
  const sink = getTraceSink();
  return async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const record = createSpanRecord(parent, label);
    try {
      const value = await fn();
      await writeToSink(sink, completeRecord(record, 'ok'));
      return value;
    } catch (error: unknown) {
      const errorCategory = categorizeSpanError(error);
      const status: TraceRecord['status'] =
        error instanceof CancelledError ? 'cancelled' : 'err';
      await writeToSink(sink, completeRecord(record, status, errorCategory));
      throw error;
    }
  };
};

/**
 * Wrap trail execution in an intrinsic root trace.
 *
 * Creates a fresh root trace context, enriches the trail context with the
 * trace context + a bound `ctx.trace` function, runs the trail through the
 * layered pipeline, and writes the completed root record to the sink
 * regardless of success or failure.
 */
const runTrail = async (
  trail: AnyTrail,
  input: unknown,
  ctx: TrailContext,
  layers: readonly Layer[]
): Promise<Result<unknown, Error>> => {
  const sink = getTraceSink();
  const traceCtx = createRootTraceContext();
  const record = createTraceRecord({
    intent: trail.intent,
    permit: extractPermit(ctx),
    trailId: trail.id,
    trailhead: ctx.extensions?.[TRAILHEAD_KEY] as TraceRecord['trailhead'],
  });

  const rootTrace: TraceContext = {
    ...traceCtx,
    rootId: record.id,
    spanId: record.id,
  };

  const tracedCtx: TrailContext = {
    ...ctx,
    extensions: {
      ...ctx.extensions,
      [TRACE_CONTEXT_KEY]: rootTrace,
    },
    trace: buildTraceFn(rootTrace),
  };

  const impl = composeLayers([...layers], trail, trail.blaze);
  const result = await impl(input, tracedCtx);

  const outcome = deriveOutcome(result);
  await writeToSink(
    sink,
    completeRecord(record, outcome.status, outcome.errorCategory)
  );
  return result;
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
