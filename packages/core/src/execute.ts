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
  CrossBatchOptions,
  CrossFn,
  Detour,
  Implementation,
  TraceFn,
  TrailContext,
  TrailContextInit,
} from './types.js';

import { createTrailContext, passthroughTrace } from './context.js';
import { buildCrossValidationSchema } from './cross-schema.js';
import {
  CancelledError,
  InternalError,
  NotFoundError,
  PermitError,
  RetryExhaustedError,
  TrailsError,
} from './errors.js';
import {
  claimNextCrossBatchIndex,
  createCrossBatchValidationResults,
  normalizeCrossBatchConcurrency,
} from './internal/cross-batch.js';
import { forkCtx } from './internal/fork-ctx.js';
import {
  TRACE_CONTEXT_KEY,
  completeRecord,
  createSpanRecord,
  createTraceRecord,
  getTraceSink,
  isTracingDisabled,
  writeToSink,
} from './internal/tracing.js';
import { Result } from './result.js';
import { DETOUR_MAX_ATTEMPTS_CAP } from './detours.js';
import { createResourceLookup } from './resource.js';
import { createResources } from './resource-config.js';
import { TRAILHEAD_KEY } from './types.js';
import { validateInput, validateOutput } from './validation.js';

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

const findMissingScopes = (
  required: readonly string[],
  held: readonly string[]
): readonly string[] => required.filter((scope) => !held.includes(scope));

const enforcePermitRequirement = (
  trail: AnyTrail,
  ctx: TrailContext
): Result<TrailContext, Error> => {
  const requirement = trail.permit;
  if (requirement === undefined || requirement === 'public') {
    return Result.ok(ctx);
  }

  if (ctx.permit === undefined) {
    return Result.err(
      new PermitError('No permit provided', {
        context: { required: requirement.scopes, trailId: trail.id },
      })
    );
  }

  const missing = findMissingScopes(requirement.scopes, ctx.permit.scopes);
  return missing.length === 0
    ? Result.ok(ctx)
    : Result.err(
        new PermitError(`Missing scopes: ${missing.join(', ')}`, {
          context: { missing, required: requirement.scopes, trailId: trail.id },
        })
      );
};

const prepareContext = async (
  trail: AnyTrail,
  options?: ExecuteTrailOptions
): Promise<
  Result<
    { readonly ctx: TrailContext; readonly releaseResources: () => void },
    Error
  >
> => {
  const baseCtx = await resolveContext(options);
  const permitted = enforcePermitRequirement(trail, baseCtx);
  if (permitted.isErr()) {
    return Result.err(permitted.error);
  }

  const resources = await createResources(
    trail,
    permitted.value,
    options?.resources,
    options?.configValues
  );
  return resources.isErr()
    ? Result.err(resources.error)
    : Result.ok({
        ctx: resources.value.ctx,
        releaseResources: resources.value.release,
      });
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

const buildUntracedContext = (ctx: TrailContext): TrailContext => {
  const { [TRACE_CONTEXT_KEY]: _traceContext, ...extensions } =
    ctx.extensions ?? {};
  const hasExtensions = Object.keys(extensions).length > 0;

  return {
    ...ctx,
    extensions: hasExtensions ? extensions : undefined,
    trace: passthroughTrace,
  };
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

const resolveCrossTarget = (
  trailOrId: AnyTrail | string,
  topo: Topo | undefined
): Result<AnyTrail, Error> => {
  if (typeof trailOrId !== 'string') {
    return Result.ok(trailOrId);
  }

  if (topo === undefined) {
    return Result.err(
      new NotFoundError(
        `Trail "${trailOrId}" cannot be crossed without topo access`
      )
    );
  }

  const target = topo.get(trailOrId);
  return target
    ? Result.ok(target)
    : Result.err(
        new NotFoundError(
          `Trail "${trailOrId}" not found in topo "${topo.name}"`
        )
      );
};

const collectConcurrentBranchResourceIds = (
  target: AnyTrail,
  topo: Topo | undefined
): Set<string> =>
  new Set(
    topo?.resourceIds() ?? target.resources.map((resource) => resource.id)
  );

const stripInheritedResourceExtensions = (
  ctx: TrailContext,
  target: AnyTrail,
  topo: Topo | undefined
): Record<string, unknown> => {
  const resourceIds = collectConcurrentBranchResourceIds(target, topo);
  const entries = Object.entries(ctx.extensions ?? {}).filter(
    ([key]) => !resourceIds.has(key)
  );
  return Object.fromEntries(entries);
};

const deriveConcurrentBranchLogger = (
  ctx: TrailContext,
  target: AnyTrail,
  branchIndex: number
) =>
  ctx.logger?.child?.({
    branchIndex,
    crossedTrailId: target.id,
  }) ?? ctx.logger;

/**
 * Build a child context for one concurrent crossing branch.
 *
 * Concurrent crossings should not inherit already-resolved resource instances
 * from the parent execution scope. Stripping resource IDs from extensions
 * forces each branch to resolve its own scope while still carrying forward
 * request-scoped values like tracing, trailhead identity, permits, and the
 * shared AbortSignal.
 *
 * `cross`, `fire`, and `resource` are cleared so the child execution can
 * rebind them to the branch-local context instead of reusing closures that
 * capture the parent scope.
 */
const buildConcurrentBranchContext = (
  ctx: TrailContext,
  target: AnyTrail,
  topo: Topo | undefined,
  branchIndex: number
): TrailContext =>
  forkCtx(ctx, {
    extensions: stripInheritedResourceExtensions(ctx, target, topo),
    logger: deriveConcurrentBranchLogger(ctx, target, branchIndex),
  });

const executeResolvedCrossTarget = async (
  target: AnyTrail,
  input: unknown,
  ctx: TrailContext,
  topo: Topo | undefined,
  forwarded: Omit<ExecuteTrailOptions, 'createContext' | 'validationSchema'>
): Promise<Result<unknown, Error>> =>
  await // eslint-disable-next-line no-use-before-define -- executor closure runs only after executeTrail is defined
  executeTrail(target, input, {
    ...forwarded,
    ctx,
    topo,
    validationSchema: buildCrossValidationSchema(target),
  });

const executeCrossTarget = async (
  trailOrId: AnyTrail | string,
  input: unknown,
  ctx: TrailContext,
  topo: Topo | undefined,
  forwarded: Omit<ExecuteTrailOptions, 'createContext' | 'validationSchema'>
): Promise<Result<unknown, Error>> => {
  const target = resolveCrossTarget(trailOrId, topo);
  if (target.isErr()) {
    return target;
  }

  return await executeResolvedCrossTarget(
    target.value,
    input,
    ctx,
    topo,
    forwarded
  );
};

type CrossBatchCall = readonly [AnyTrail | string, unknown];

const executeConcurrentCrossBatchCall = async (
  call: CrossBatchCall,
  branchIndex: number,
  ctx: TrailContext,
  topo: Topo | undefined,
  forwarded: Omit<ExecuteTrailOptions, 'createContext' | 'validationSchema'>
): Promise<Result<unknown, Error>> => {
  const [trailOrId, batchInput] = call;
  const target = resolveCrossTarget(trailOrId, topo);
  if (target.isErr()) {
    return target;
  }

  return await executeResolvedCrossTarget(
    target.value,
    batchInput,
    buildConcurrentBranchContext(ctx, target.value, topo, branchIndex),
    topo,
    forwarded
  );
};

const executeUnlimitedCrossBatch = async (
  calls: readonly CrossBatchCall[],
  ctx: TrailContext,
  topo: Topo | undefined,
  forwarded: Omit<ExecuteTrailOptions, 'createContext' | 'validationSchema'>
): Promise<Result<unknown, Error>[]> =>
  await Promise.all(
    calls.map((call, branchIndex) =>
      executeConcurrentCrossBatchCall(call, branchIndex, ctx, topo, forwarded)
    )
  );

const createCrossBatchResults = (
  calls: readonly CrossBatchCall[]
): Result<unknown, Error>[] =>
  Array.from<Result<unknown, Error>>({ length: calls.length });

const executeLimitedCrossBatch = async (
  calls: readonly CrossBatchCall[],
  ctx: TrailContext,
  topo: Topo | undefined,
  forwarded: Omit<ExecuteTrailOptions, 'createContext' | 'validationSchema'>,
  limit: number
): Promise<Result<unknown, Error>[]> => {
  const results = createCrossBatchResults(calls);
  const nextIndex = { value: 0 };

  const runWorker = async () => {
    while (true) {
      const branchIndex = claimNextCrossBatchIndex(nextIndex, calls);
      if (branchIndex === undefined) {
        return;
      }

      const call = calls[branchIndex];
      if (call === undefined) {
        // Defensive: `claimNextCrossBatchIndex` only returns indices within
        // bounds, so this slot should always be populated. If it ever isn't,
        // surface a clear InternalError in place of the missing slot and keep
        // the worker loop running so sibling branches still get processed.
        results[branchIndex] = Result.err(
          new InternalError(
            `unreachable: concurrent cross batch call missing at index ${branchIndex}`
          )
        );
        continue;
      }

      results[branchIndex] = await executeConcurrentCrossBatchCall(
        call,
        branchIndex,
        ctx,
        topo,
        forwarded
      );
    }
  };

  await Promise.all(Array.from({ length: limit }, runWorker));
  return results;
};

const executeCrossBatch = async (
  calls: readonly CrossBatchCall[],
  ctx: TrailContext,
  topo: Topo | undefined,
  forwarded: Omit<ExecuteTrailOptions, 'createContext' | 'validationSchema'>,
  batchOptions?: CrossBatchOptions
): Promise<Result<unknown, Error>[]> => {
  if (calls.length === 0) {
    return [];
  }

  const concurrency = normalizeCrossBatchConcurrency(batchOptions);
  if (concurrency.isErr()) {
    return createCrossBatchValidationResults(calls, concurrency.error);
  }

  const limit = concurrency.value ?? calls.length;
  return limit >= calls.length
    ? await executeUnlimitedCrossBatch(calls, ctx, topo, forwarded)
    : await executeLimitedCrossBatch(calls, ctx, topo, forwarded, limit);
};

const bindCrossToCtx = (
  ctx: TrailContext,
  topo: Topo | undefined,
  options: ExecuteTrailOptions | undefined
): TrailContext => {
  if (ctx.cross !== undefined) {
    return ctx;
  }

  const {
    createContext: _omit,
    validationSchema: _omitSchema,
    ...forwarded
  } = options ?? {};
  const cross = (async (
    trailOrCalls:
      | AnyTrail
      | string
      | readonly (readonly [AnyTrail | string, unknown])[],
    inputOrOptions?: CrossBatchOptions | unknown
  ) => {
    if (Array.isArray(trailOrCalls)) {
      return await executeCrossBatch(
        trailOrCalls,
        ctx,
        topo,
        forwarded,
        inputOrOptions as CrossBatchOptions | undefined
      );
    }

    return await executeCrossTarget(
      trailOrCalls as AnyTrail | string,
      inputOrOptions,
      ctx,
      topo,
      forwarded
    );
  }) as CrossFn;

  return {
    ...ctx,
    cross,
  };
};

const bindFireToCtx = (
  ctx: TrailContext,
  topo: Topo | undefined,
  options: ExecuteTrailOptions | undefined
): TrailContext => {
  // Symmetric with bindCrossToCtx: a caller-supplied ctx.fire (e.g. test
  // helper, scenario harness, or runtime intercepting signal fan-out) is
  // preserved as-is. Without this guard, passing both `topo: app` and a
  // custom `ctx.fire` would silently clobber the injected mock with the
  // topo-backed dispatcher.
  if (ctx.fire !== undefined) {
    return ctx;
  }
  if (topo === undefined) {
    return ctx;
  }
  // Forward the producer's execution options to consumers so resources,
  // layers, configValues, and abortSignal propagate through signal fan-out.
  // `createContext` is intentionally stripped — consumers inherit the
  // already-resolved ctx via `consumerCtx`, and re-running the factory would
  // clobber that.
  // Strip createContext (consumers inherit resolved ctx) and validationSchema
  // (consumers validate against their own schema, not the producer's cross schema).
  const {
    createContext: _omit,
    validationSchema: _omitSchema,
    ...forwarded
  } = options ?? {};
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

const bindCrossAtLayerBoundary =
  <I, O>(
    implementation: Implementation<I, O>,
    topo: Topo | undefined,
    options: ExecuteTrailOptions | undefined
  ): Implementation<I, O> =>
  (input, ctx) =>
    implementation(input, bindCrossToCtx(ctx, topo, options));

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

// ---------------------------------------------------------------------------
// Detour loop
// ---------------------------------------------------------------------------

/**
 * Find the first detour whose `on` class matches the error via `instanceof`.
 *
 * Declaration order wins — no most-specific-first hierarchy walking.
 */
const findMatchingDetour = (
  /* oxlint-disable-next-line no-explicit-any -- existential detour array from AnyTrail */
  detours: readonly Detour<any, any, TrailsError>[],
  error: TrailsError
  /* oxlint-disable-next-line no-explicit-any -- matched detour carries runtime generics */
): Detour<any, any, TrailsError> | undefined =>
  detours.find((d) => error instanceof d.on);

/** Execute a single detour recovery attempt, routing through ctx.trace when available. */
const executeDetourAttempt = async (
  /* oxlint-disable-next-line no-explicit-any -- existential detour from AnyTrail */
  detour: Detour<any, any, TrailsError>,
  attempt: number,
  lastError: TrailsError,
  input: unknown,
  ctx: TrailContext
): Promise<Result<unknown, Error>> => {
  const run = async () =>
    await detour.recover({ attempt, error: lastError, input }, ctx);

  return ctx.trace
    ? await ctx.trace(`detour:${detour.on.name}:${attempt}`, run)
    : await run();
};

/** Classify a detour attempt result: continue the loop, or return early. */
const classifyDetourResult = (
  result: Result<unknown, Error>,
  /* oxlint-disable-next-line no-explicit-any -- existential detour from AnyTrail */
  detour: Detour<any, any, TrailsError>
):
  | { readonly done: true; readonly result: Result<unknown, Error> }
  | { readonly done: false; readonly nextError: TrailsError } => {
  if (result.isOk()) {
    return { done: true, result };
  }
  const recoverError = result.error;
  if (
    !(recoverError instanceof TrailsError) ||
    !(recoverError instanceof detour.on)
  ) {
    return { done: true, result };
  }
  return { done: false, nextError: recoverError };
};

/** Resolve effective maxAttempts, warning if the declared value exceeds the hard cap. */
const resolveMaxAttempts = (
  /* oxlint-disable-next-line no-explicit-any -- existential detour from AnyTrail */
  detour: Detour<any, any, TrailsError>,
  ctx: TrailContext
): number => {
  const declared = detour.maxAttempts ?? 1;
  const clamped = Math.max(1, Math.min(declared, DETOUR_MAX_ATTEMPTS_CAP));
  if (clamped === declared) {
    return clamped;
  }
  ctx.logger?.warn('detour maxAttempts clamped', {
    declared,
    detour: detour.on.name,
    effective: clamped,
  });
  return clamped;
};

/** Run the detour recovery loop for a single matched detour. */
const runDetourRecovery = async (
  /* oxlint-disable-next-line no-explicit-any -- existential detour from AnyTrail */
  detour: Detour<any, any, TrailsError>,
  error: TrailsError,
  input: unknown,
  ctx: TrailContext
): Promise<Result<unknown, Error>> => {
  const maxAttempts = resolveMaxAttempts(detour, ctx);
  let lastError: TrailsError = error;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    ctx.logger?.debug('detour recovery attempt', {
      attempt,
      errorClass: lastError.name,
      matchedDetour: detour.on.name,
      maxAttempts,
    });
    const result = await executeDetourAttempt(
      detour,
      attempt,
      lastError,
      input,
      ctx
    );
    const classification = classifyDetourResult(result, detour);
    if (classification.done) {
      return classification.result;
    }
    lastError = classification.nextError;
  }

  return Result.err(
    new RetryExhaustedError(lastError, {
      attempts: maxAttempts,
      detour: detour.on.name,
    })
  );
};

/**
 * Wrap a blaze with the detour recovery loop.
 *
 * If the trail has no detours, returns the blaze unchanged (no wrapper overhead).
 * The detour loop runs inside the layer stack, closest to the blaze.
 */
const wrapWithDetours = (
  blaze: Implementation<unknown, unknown>,
  /* oxlint-disable-next-line no-explicit-any -- existential detour array from AnyTrail */
  detours: readonly Detour<any, any, TrailsError>[]
): Implementation<unknown, unknown> => {
  if (detours.length === 0) {
    return blaze;
  }

  return async (input, ctx) => {
    const result = await blaze(input, ctx);
    if (result.isOk()) {
      return result;
    }

    const { error } = result;
    if (!(error instanceof TrailsError)) {
      return result;
    }

    const matched = findMatchingDetour(detours, error);
    if (matched === undefined) {
      return result;
    }

    return await runDetourRecovery(matched, error, input, ctx);
  };
};

const wrapWithOutputValidation = (
  trail: AnyTrail,
  implementation: Implementation<unknown, unknown>
): Implementation<unknown, unknown> => {
  const { output } = trail;
  if (output === undefined) {
    return implementation;
  }

  return async (input, ctx) => {
    const result = await implementation(input, ctx);
    if (result.isErr()) {
      return result;
    }

    const validated = validateOutput(output, result.value);
    return validated.isErr()
      ? Result.err(validated.error)
      : Result.ok(validated.value);
  };
};

const prepareRunImpl = (
  trail: AnyTrail,
  ctx: TrailContext,
  layers: readonly Layer[],
  topo: Topo | undefined,
  options: ExecuteTrailOptions | undefined
): {
  readonly ctxWithIntrinsics: TrailContext;
  readonly impl: Implementation<unknown, unknown>;
} => {
  const ctxWithIntrinsics = bindFireToCtx(
    bindCrossToCtx(ctx, topo, options),
    topo,
    options
  );
  // Detour loop wraps the blaze (inside layer stack, closest to blaze)
  let impl = wrapWithDetours(
    bindFireAtLayerBoundary(
      bindCrossAtLayerBoundary(
        trail.blaze as Implementation<unknown, unknown>,
        topo,
        options
      ),
      topo,
      options
    ),
    trail.detours
  );

  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer) {
      impl = bindFireAtLayerBoundary(
        bindCrossAtLayerBoundary(
          layer.wrap(trail, impl as never) as Implementation<unknown, unknown>,
          topo,
          options
        ),
        topo,
        options
      );
    }
  }

  return {
    ctxWithIntrinsics,
    impl: wrapWithOutputValidation(trail, impl),
  };
};

const runImplWithoutTracing = async (
  trail: AnyTrail,
  input: unknown,
  ctx: TrailContext,
  layers: readonly Layer[],
  topo: Topo | undefined,
  options: ExecuteTrailOptions | undefined
): Promise<Result<unknown, Error>> => {
  const prepared = prepareRunImpl(
    trail,
    buildUntracedContext(ctx),
    layers,
    topo,
    options
  );
  return await prepared.impl(input, prepared.ctxWithIntrinsics);
};

const runTrailWithTracing = async (
  trail: AnyTrail,
  input: unknown,
  ctx: TrailContext,
  layers: readonly Layer[],
  topo: Topo | undefined,
  options: ExecuteTrailOptions | undefined,
  sink: ReturnType<typeof getTraceSink>
): Promise<Result<unknown, Error>> => {
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
    prepared.ctxWithIntrinsics,
    record,
    sink
  );
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
  return isTracingDisabled(sink)
    ? await runImplWithoutTracing(trail, input, ctx, layers, topo, options)
    : await runTrailWithTracing(trail, input, ctx, layers, topo, options, sink);
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
      return Result.err(resolvedCtx.error);
    }

    try {
      return await runTrail(
        trail,
        validated.value,
        resolvedCtx.value.ctx,
        options?.layers ?? [],
        options?.topo,
        options
      );
    } finally {
      resolvedCtx.value.releaseResources();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Result.err(new InternalError(message));
  }
};
