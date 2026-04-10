/**
 * Centralized trail execution pipeline.
 *
 * Validates input, builds context, composes layers, and runs the
 * implementation. Surfaces (CLI, MCP, HTTP) delegate here instead
 * of reimplementing the pipeline.
 */

import type { z } from 'zod';

import type { AnyTrail } from './trail.js';
import type { Layer } from './layer.js';
import type { ResourceOverrideMap } from './resource.js';
import type { TraceContext, TraceRecord } from './internal/tracing.js';
import type { Topo } from './topo.js';

import { createFireFn } from './fire.js';
import type {
  Implementation,
  TraceFn,
  TrailContext,
  TrailContextInit,
} from './types.js';

import { createTrailContext } from './context.js';
import { CancelledError, InternalError, TrailsError } from './errors.js';
import {
  TRACE_CONTEXT_KEY,
  completeRecord,
  createSpanRecord,
  createTraceRecord,
  getTraceSink,
  writeToSink,
} from './internal/tracing.js';
import { Result } from './result.js';
import { createResourceLookup } from './resource.js';
import { resolveResources } from './resource-config.js';
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
  readonly resources?: ResourceOverrideMap | undefined;
  /** Config values for resources that declare a `config` schema, keyed by resource ID. */
  readonly configValues?:
    | Readonly<Record<string, Record<string, unknown>>>
    | undefined;
  /** Topo used for signal-driven activation; required for `ctx.fire()` to work. */
  readonly topo?: Topo | undefined;
  /**
   * Override the validation schema used for input validation.
   *
   * When a trail is invoked via `ctx.cross()` and the target declares
   * `crossInput`, the cross function merges `trail.input` with
   * `trail.crossInput` and passes the merged schema here so validation
   * accepts both public and composition-only fields.
   *
   * Used by the cross execution path; not part of the public API.
   *
   * @internal
   */
  readonly validationSchema?: z.ZodType | undefined;
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

const bindResourceLookup = (
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
  const lookup = createResourceLookup(() => bound);
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
    : undefined;
  const base = createTrailContext(seed);
  const resolved = applyContextOverrides(base, options);
  return bindResourceLookup(resolved, options);
};

const prepareContext = async (
  trail: AnyTrail,
  options?: ExecuteTrailOptions
): Promise<Result<TrailContext, Error>> => {
  const baseCtx = await resolveContext(options);
  return await resolveResources(
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
const deriveResultErrorCategory = (error: Error): string => {
  if (error instanceof TrailsError) {
    return error.category;
  }
  return 'internal';
};

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
      errorCategory: deriveResultErrorCategory(error),
      status: error instanceof CancelledError ? 'cancelled' : 'err',
    }),
    ok: () => ({ errorCategory: undefined, status: 'ok' }),
  });

/**
 * Best-effort error category for a thrown (not Result.err) value.
 *
 * Unknown/non-Error throws normalize to `'internal'` so the trace record
 * always carries a category when the trail unexpectedly throws.
 */
const categorizeSpanError = (error: unknown): string => {
  if (error instanceof TrailsError) {
    return error.category;
  }
  return 'internal';
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
const buildTraceFn =
  (parent: TraceContext, sink: ReturnType<typeof getTraceSink>): TraceFn =>
  async <T>(label: string, fn: () => T | Promise<T>): Promise<T> => {
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

/** Build the root trace record + trace-enriched context for a trail run. */
const buildTracedContext = (
  trail: AnyTrail,
  ctx: TrailContext,
  sink: ReturnType<typeof getTraceSink>
): { readonly record: TraceRecord; readonly tracedCtx: TrailContext } => {
  // If a parent trace context is present (set by an outer executeTrail when
  // the current trail was invoked via ctx.cross or ctx.fire), inherit its
  // traceId/rootId so the trace tree spans trail boundaries. Otherwise this
  // execution becomes a fresh root.
  const parent = ctx.extensions?.[TRACE_CONTEXT_KEY] as
    | TraceContext
    | undefined;

  const record = createTraceRecord({
    intent: trail.intent,
    parentId: parent?.spanId,
    permit: extractPermit(ctx),
    rootId: parent?.rootId,
    traceId: parent?.traceId,
    trailId: trail.id,
    trailhead: ctx.extensions?.[TRAILHEAD_KEY] as TraceRecord['trailhead'],
  });

  // Root trace context for this trail's span. When inheriting a parent, the
  // traceId/rootId carry forward and only spanId advances to the new record.
  const rootTrace: TraceContext = {
    rootId: parent?.rootId ?? record.id,
    sampled: true,
    spanId: record.id,
    traceId: record.traceId,
  };

  const tracedCtx: TrailContext = {
    ...ctx,
    extensions: {
      ...ctx.extensions,
      [TRACE_CONTEXT_KEY]: rootTrace,
    },
    trace: buildTraceFn(rootTrace, sink),
  };

  return { record, tracedCtx };
};

/** Run the composed implementation and write the root record on any outcome. */
const runImplWithRootRecord = async (
  impl: Implementation<unknown, unknown>,
  input: unknown,
  tracedCtx: TrailContext,
  record: TraceRecord,
  sink: ReturnType<typeof getTraceSink>
): Promise<Result<unknown, Error>> => {
  try {
    const result = await impl(input, tracedCtx);
    const outcome = deriveOutcome(result);
    await writeToSink(
      sink,
      completeRecord(record, outcome.status, outcome.errorCategory)
    );
    return result;
  } catch (error: unknown) {
    // Normalize unexpected throws so the root record still reflects the error
    // outcome. The outer executeTrail try/catch converts the thrown value into
    // a Result.err(InternalError) for the caller.
    const status: TraceRecord['status'] =
      error instanceof CancelledError ? 'cancelled' : 'err';
    const errorCategory = categorizeSpanError(error);
    await writeToSink(sink, completeRecord(record, status, errorCategory));
    throw error;
  }
};

const bindFireToCtx = (
  ctx: TrailContext,
  topo: Topo | undefined,
  options: ExecuteTrailOptions | undefined
): TrailContext => {
  if (topo === undefined) {
    return ctx;
  }
  // Forward the producer's execution options to consumers so resources,
  // layers, configValues, and abortSignal propagate through signal fan-out.
  // `createContext` is intentionally stripped — consumers inherit the
  // already-resolved ctx via `consumerCtx`, and re-running the factory would
  // clobber that.
  const { createContext: _omit, ...forwarded } = options ?? {};
  const fire = createFireFn(topo, ctx, (consumer, input, consumerCtx) =>
    // eslint-disable-next-line no-use-before-define -- executor closure runs only after executeTrail is defined
    executeTrail(consumer, input, {
      ...forwarded,
      ctx: consumerCtx,
      topo,
    })
  );
  return { ...ctx, fire };
};

const bindFireAtLayerBoundary = <I, O>(
  implementation: Implementation<I, O>,
  topo: Topo | undefined,
  options: ExecuteTrailOptions | undefined
): Implementation<I, O> => {
  if (topo === undefined) {
    return implementation;
  }

  return (input, ctx) =>
    implementation(input, bindFireToCtx(ctx, topo, options));
};
const prepareRunImpl = (
  trail: AnyTrail,
  ctx: TrailContext,
  layers: readonly Layer[],
  topo: Topo | undefined,
  options: ExecuteTrailOptions | undefined
): {
  readonly ctxWithFire: TrailContext;
  readonly impl: Implementation<unknown, unknown>;
} => {
  const ctxWithFire = bindFireToCtx(ctx, topo, options);
  let impl = bindFireAtLayerBoundary(
    trail.blaze as Implementation<unknown, unknown>,
    topo,
    options
  );

  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer) {
      impl = bindFireAtLayerBoundary(
        layer.wrap(trail, impl as never) as Implementation<unknown, unknown>,
        topo,
        options
      );
    }
  }

  return {
    ctxWithFire,
    impl,
  };
};

const runTrail = async (
  trail: AnyTrail,
  input: unknown,
  ctx: TrailContext,
  layers: readonly Layer[],
  topo: Topo | undefined,
  options: ExecuteTrailOptions | undefined
): Promise<Result<unknown, Error>> => {
  const sink = getTraceSink();
  const { record, tracedCtx } = buildTracedContext(trail, ctx, sink);
  let prepared: ReturnType<typeof prepareRunImpl>;

  try {
    prepared = prepareRunImpl(trail, tracedCtx, layers, topo, options);
  } catch (error: unknown) {
    const status: TraceRecord['status'] =
      error instanceof CancelledError ? 'cancelled' : 'err';
    await writeToSink(
      sink,
      completeRecord(record, status, categorizeSpanError(error))
    );
    throw error;
  }

  return await runImplWithRootRecord(
    prepared.impl,
    input,
    prepared.ctxWithFire,
    record,
    sink
  );
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
    const validated = validateInput(
      options?.validationSchema ?? trail.input,
      rawInput
    );
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
      options?.layers ?? [],
      options?.topo,
      options
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Result.err(new InternalError(message));
  }
};
