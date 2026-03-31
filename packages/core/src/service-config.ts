/**
 * Service resolution pipeline.
 *
 * Extracted from execute.ts to keep both modules under the 400 LOC ceiling.
 * Handles config validation, singleton caching, concurrent-creation dedup,
 * and the full resolve-or-create flow for declared services.
 */

import type {
  AnyService,
  ServiceContext,
  ServiceOverrideMap,
} from './service.js';
import type { AnyTrail } from './trail.js';
import type { TrailContext } from './types.js';

import { InternalError, ValidationError } from './errors.js';
import { Result } from './result.js';
import { createServiceLookup } from './service.js';

type MutableTrailContext = {
  -readonly [K in keyof TrailContext]: TrailContext[K];
};

type ConfigValues = Readonly<Record<string, Record<string, unknown>>>;

// ---------------------------------------------------------------------------
// Singleton caches
// ---------------------------------------------------------------------------

const singletonServices = new WeakMap<AnyService, Map<string, unknown>>();

/** In-flight service creation promises, keyed by service x context. */
const pendingCreations = new WeakMap<
  AnyService,
  Map<string, Promise<Result<unknown, Error>>>
>();

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

const toServiceContext = (
  ctx: TrailContext,
  config?: unknown
): ServiceContext => ({
  config,
  cwd: ctx.cwd,
  env: ctx.env,
  workspaceRoot: ctx.workspaceRoot,
});

const toServiceContextKey = (ctx: ServiceContext): string =>
  JSON.stringify({
    config: ctx.config,
    cwd: ctx.cwd,
    env: Object.entries(ctx.env ?? {}).toSorted(([left], [right]) =>
      left.localeCompare(right)
    ),
    workspaceRoot: ctx.workspaceRoot,
  });

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/** Validate and resolve a service's config from the provided configValues map. */
const resolveServiceConfig = (
  declaredService: AnyService,
  configValues?: ConfigValues
): Result<unknown, Error> => {
  if (declaredService.config === undefined) {
    return Result.ok();
  }
  const raw = configValues?.[declaredService.id];
  if (raw === undefined) {
    return Result.err(
      new ValidationError(
        `Service "${declaredService.id}" declares a config schema but no config was provided`
      )
    );
  }
  const parsed = declaredService.config.safeParse(raw);
  if (!parsed.success) {
    return Result.err(
      new ValidationError(
        `Service "${declaredService.id}" config validation failed: ${parsed.error.message}`
      )
    );
  }
  return Result.ok(parsed.data);
};

// ---------------------------------------------------------------------------
// Override / cache lookups
// ---------------------------------------------------------------------------

const hasOwnServiceOverride = (
  overrides: ServiceOverrideMap | undefined,
  id: string
): overrides is ServiceOverrideMap =>
  overrides !== undefined && Object.hasOwn(overrides, id);

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

// ---------------------------------------------------------------------------
// Instance creation
// ---------------------------------------------------------------------------

const toInternalServiceError = (id: string, error: unknown): InternalError => {
  const cause = error instanceof Error ? error : undefined;
  const message = cause?.message ?? String(error);
  return new InternalError(`Service "${id}" failed to resolve: ${message}`, {
    ...(cause ? { cause } : {}),
    context: { serviceId: id },
  });
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
 * If a creation is already in flight for this service x context key,
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

/** Validate config and resolve a single declared service. */
const resolveDeclaredService = async (
  declaredService: AnyService,
  ctx: TrailContext,
  overrides: ServiceOverrideMap | undefined,
  configValues: ConfigValues | undefined
): Promise<Result<unknown, Error>> => {
  // Check overrides/extensions/cache first — skip config validation
  // entirely when a service instance is already provided.
  const serviceContextForLookup = toServiceContext(ctx);
  const provided = getProvidedService(
    ctx,
    overrides,
    declaredService,
    serviceContextForLookup
  );
  if (provided !== undefined) {
    return provided;
  }

  // No provided instance — validate config and create via factory.
  const configResult = resolveServiceConfig(declaredService, configValues);
  if (configResult.isErr()) {
    return configResult;
  }

  const serviceContext = toServiceContext(ctx, configResult.value);
  return await createServiceInstance(declaredService, serviceContext);
};

// ---------------------------------------------------------------------------
// Full trail service resolution
// ---------------------------------------------------------------------------

const withResolvedServices = (
  ctx: TrailContext,
  resolvedServices: Record<string, unknown>
): TrailContext => {
  const extensions = { ...ctx.extensions, ...resolvedServices };
  const resolvedCtx = { ...ctx, extensions } as MutableTrailContext;
  resolvedCtx.service = createServiceLookup(() => resolvedCtx);
  return resolvedCtx;
};

/**
 * Resolve all declared services for a trail.
 *
 * Validates per-service config, checks overrides and caches, and creates
 * new instances as needed. Returns an enriched context with all service
 * instances injected into extensions.
 */
export const resolveServices = async (
  trail: AnyTrail,
  ctx: TrailContext,
  overrides?: ServiceOverrideMap,
  configValues?: ConfigValues
): Promise<Result<TrailContext, Error>> => {
  if (trail.services.length === 0) {
    return Result.ok(ctx);
  }

  const resolvedServices: Record<string, unknown> = {};

  for (const declaredService of trail.services) {
    const resolved = await resolveDeclaredService(
      declaredService,
      ctx,
      overrides,
      configValues
    );
    if (resolved.isErr()) {
      return resolved;
    }
    resolvedServices[declaredService.id] = resolved.unwrap();
  }

  return Result.ok(withResolvedServices(ctx, resolvedServices));
};
