/**
 * Centralized trail execution pipeline.
 *
 * Validates input, builds context, composes layers, and runs the
 * implementation. Surfaces (CLI, MCP, HTTP) delegate here instead
 * of reimplementing the pipeline.
 */

import type { AnyTrail } from './trail.js';
import type { Layer } from './layer.js';
import type {
  AnyService,
  ServiceContext,
  ServiceOverrideMap,
} from './service.js';
import type { TrailContext, TrailContextInit } from './types.js';

import { composeLayers } from './layer.js';
import { createTrailContext } from './context.js';
import { InternalError } from './errors.js';
import { Result } from './result.js';
import { createServiceLookup } from './service.js';
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

const singletonServices = new WeakMap<AnyService, Map<string, unknown>>();

/** In-flight service creation promises, keyed by service × context. */
const pendingCreations = new WeakMap<
  AnyService,
  Map<string, Promise<Result<unknown, Error>>>
>();

const hasOwnServiceOverride = (
  overrides: ServiceOverrideMap | undefined,
  id: string
): overrides is ServiceOverrideMap =>
  overrides !== undefined && Object.hasOwn(overrides, id);

const toServiceContext = (ctx: TrailContext): ServiceContext => ({
  cwd: ctx.cwd,
  env: ctx.env,
  workspaceRoot: ctx.workspaceRoot,
});

const toServiceContextKey = (ctx: ServiceContext): string =>
  JSON.stringify({
    cwd: ctx.cwd,
    env: Object.entries(ctx.env ?? {}).toSorted(([left], [right]) =>
      left.localeCompare(right)
    ),
    workspaceRoot: ctx.workspaceRoot,
  });

const toInternalServiceError = (id: string, error: unknown): InternalError => {
  const cause = error instanceof Error ? error : undefined;
  const message = cause?.message ?? String(error);
  return new InternalError(`Service "${id}" failed to resolve: ${message}`, {
    ...(cause ? { cause } : {}),
    context: { serviceId: id },
  });
};

const getCachedSingletonService = (
  declaredService: AnyService,
  serviceContext: ServiceContext
): { readonly found: boolean; readonly value: unknown } => {
  const scopedCache = singletonServices.get(declaredService);
  if (scopedCache === undefined) {
    return { found: false, value: undefined };
  }

  const key = toServiceContextKey(serviceContext);
  if (!scopedCache.has(key)) {
    return { found: false, value: undefined };
  }

  return {
    found: true,
    value: scopedCache.get(key),
  };
};

const getProvidedService = (
  ctx: TrailContext,
  overrides: ServiceOverrideMap | undefined,
  declaredService: AnyService,
  serviceContext: ServiceContext
): Result<unknown, Error> | undefined => {
  const { id } = declaredService;
  if (hasOwnServiceOverride(overrides, id)) {
    return Result.ok(overrides[id]);
  }

  if (Object.hasOwn(ctx.extensions ?? {}, id)) {
    return Result.ok(ctx.extensions?.[id]);
  }

  const cached = getCachedSingletonService(declaredService, serviceContext);
  if (cached.found) {
    return Result.ok(cached.value);
  }

  return undefined;
};

const getSingletonServiceCache = (
  declaredService: AnyService
): Map<string, unknown> => {
  const existing = singletonServices.get(declaredService);
  if (existing !== undefined) {
    return existing;
  }

  const created = new Map<string, unknown>();
  singletonServices.set(declaredService, created);
  return created;
};

const doCreateServiceInstance = async (
  declaredService: AnyService,
  serviceContext: ServiceContext
): Promise<Result<unknown, Error>> => {
  try {
    const created = await declaredService.create(serviceContext);
    if (created.isErr()) {
      return Result.err(created.error);
    }

    const instance = created.unwrap();
    getSingletonServiceCache(declaredService).set(
      toServiceContextKey(serviceContext),
      instance
    );
    return Result.ok(instance);
  } catch (error: unknown) {
    return Result.err(toInternalServiceError(declaredService.id, error));
  }
};

const trackPendingCreation = (
  declaredService: AnyService,
  key: string,
  promise: Promise<Result<unknown, Error>>
): void => {
  const pending = pendingCreations.get(declaredService);
  if (pending) {
    pending.set(key, promise);
  } else {
    pendingCreations.set(declaredService, new Map([[key, promise]]));
  }
};

/**
 * Deduplicates concurrent creation of the same service singleton.
 * If a creation is already in flight for this service × context key,
 * returns the existing promise instead of spawning a second factory call.
 */
const createServiceInstance = async (
  declaredService: AnyService,
  serviceContext: ServiceContext
): Promise<Result<unknown, Error>> => {
  const key = toServiceContextKey(serviceContext);
  const inflight = pendingCreations.get(declaredService)?.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = doCreateServiceInstance(declaredService, serviceContext);
  trackPendingCreation(declaredService, key, promise);

  try {
    return await promise;
  } finally {
    pendingCreations.get(declaredService)?.delete(key);
  }
};

const resolveServiceInstance = async (
  declaredService: AnyService,
  ctx: TrailContext,
  serviceContext: ServiceContext,
  overrides?: ServiceOverrideMap
): Promise<Result<unknown, Error>> =>
  getProvidedService(ctx, overrides, declaredService, serviceContext) ??
  (await createServiceInstance(declaredService, serviceContext));

const withResolvedServices = (
  ctx: TrailContext,
  resolvedServices: Record<string, unknown>
): TrailContext => {
  const extensions = { ...ctx.extensions, ...resolvedServices };
  const resolvedCtx = { ...ctx, extensions } as MutableTrailContext;
  resolvedCtx.service = createServiceLookup(() => resolvedCtx);
  return resolvedCtx;
};

const resolveServices = async (
  trail: AnyTrail,
  ctx: TrailContext,
  overrides?: ServiceOverrideMap
): Promise<Result<TrailContext, Error>> => {
  if (trail.services.length === 0) {
    return Result.ok(ctx);
  }

  const resolvedServices: Record<string, unknown> = {};
  const serviceContext = toServiceContext(ctx);

  for (const declaredService of trail.services) {
    const resolved = await resolveServiceInstance(
      declaredService,
      ctx,
      serviceContext,
      overrides
    );
    if (resolved.isErr()) {
      return resolved;
    }

    resolvedServices[declaredService.id] = resolved.unwrap();
  }

  return Result.ok(withResolvedServices(ctx, resolvedServices));
};

const prepareContext = async (
  trail: AnyTrail,
  options?: ExecuteTrailOptions
): Promise<Result<TrailContext, Error>> => {
  const baseCtx = await resolveContext(options);
  return await resolveServices(trail, baseCtx, options?.services);
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
