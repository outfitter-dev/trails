/**
 * Resource resolution pipeline.
 *
 * Extracted from execute.ts to keep both modules under the 400 LOC ceiling.
 * Handles config validation, singleton caching, concurrent-creation dedup,
 * and the full resolve-or-create flow for declared resources.
 */

import type {
  AnyResource,
  ResourceContext,
  ResourceOverrideMap,
} from './resource.js';
import type { AnyTrail } from './trail.js';
import type { TrailContext } from './types.js';

import { InternalError, ValidationError } from './errors.js';
import { Result } from './result.js';
import { createResourceLookup } from './resource.js';

type MutableTrailContext = {
  -readonly [K in keyof TrailContext]: TrailContext[K];
};

type ConfigValues = Readonly<Record<string, Record<string, unknown>>>;

// ---------------------------------------------------------------------------
// Singleton caches
// ---------------------------------------------------------------------------

const singletonResources = new WeakMap<AnyResource, Map<string, unknown>>();

/** In-flight resource creation promises, keyed by resource x context. */
const pendingCreations = new WeakMap<
  AnyResource,
  Map<string, Promise<Result<unknown, Error>>>
>();

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

const toResourceContext = (
  ctx: TrailContext,
  config?: unknown
): ResourceContext => ({
  config,
  cwd: ctx.cwd,
  env: ctx.env,
  workspaceRoot: ctx.workspaceRoot,
});

const toResourceContextKey = (ctx: ResourceContext): string =>
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

/** Validate and resolve a resource's config from the provided configValues map. */
const resolveResourceConfig = (
  declaredResource: AnyResource,
  configValues?: ConfigValues
): Result<unknown, Error> => {
  if (declaredResource.config === undefined) {
    return Result.ok();
  }
  const raw = configValues?.[declaredResource.id];
  if (raw === undefined) {
    return Result.err(
      new ValidationError(
        `Resource "${declaredResource.id}" declares a config schema but no config was provided`
      )
    );
  }
  const parsed = declaredResource.config.safeParse(raw);
  if (!parsed.success) {
    return Result.err(
      new ValidationError(
        `Resource "${declaredResource.id}" config validation failed: ${parsed.error.message}`
      )
    );
  }
  return Result.ok(parsed.data);
};

// ---------------------------------------------------------------------------
// Override / cache lookups
// ---------------------------------------------------------------------------

const hasOwnResourceOverride = (
  overrides: ResourceOverrideMap | undefined,
  id: string
): overrides is ResourceOverrideMap =>
  overrides !== undefined && Object.hasOwn(overrides, id);

const getCachedSingletonResource = (
  declaredResource: AnyResource,
  resourceContext: ResourceContext
): { readonly found: boolean; readonly value: unknown } => {
  const scopedCache = singletonResources.get(declaredResource);
  if (scopedCache === undefined) {
    return { found: false, value: undefined };
  }

  const key = toResourceContextKey(resourceContext);
  if (!scopedCache.has(key)) {
    return { found: false, value: undefined };
  }

  return {
    found: true,
    value: scopedCache.get(key),
  };
};

const getProvidedResource = (
  ctx: TrailContext,
  overrides: ResourceOverrideMap | undefined,
  declaredResource: AnyResource,
  resourceContext: ResourceContext
): Result<unknown, Error> | undefined => {
  const { id } = declaredResource;
  if (hasOwnResourceOverride(overrides, id)) {
    return Result.ok(overrides[id]);
  }

  if (Object.hasOwn(ctx.extensions ?? {}, id)) {
    return Result.ok(ctx.extensions?.[id]);
  }

  const cached = getCachedSingletonResource(declaredResource, resourceContext);
  if (cached.found) {
    return Result.ok(cached.value);
  }

  return undefined;
};

const getOverrideOrExtension = (
  ctx: TrailContext,
  overrides: ResourceOverrideMap | undefined,
  declaredResource: AnyResource
): Result<unknown, Error> | undefined =>
  getProvidedResource(ctx, overrides, declaredResource, toResourceContext(ctx));

type ConfigAwareResolution =
  | Result<{ readonly kind: 'provided'; readonly value: unknown }, Error>
  | Result<
      { readonly kind: 'context'; readonly resourceContext: ResourceContext },
      Error
    >;

const resolveConfigAwareProvidedResource = (
  ctx: TrailContext,
  declaredResource: AnyResource,
  configValues: ConfigValues | undefined
): ConfigAwareResolution => {
  const configResult = resolveResourceConfig(declaredResource, configValues);
  if (configResult.isErr()) {
    return configResult;
  }

  const resourceContext = toResourceContext(ctx, configResult.value);
  const provided = getProvidedResource(
    ctx,
    undefined,
    declaredResource,
    resourceContext
  );

  return provided
    ? Result.ok({ kind: 'provided', value: provided.unwrap() })
    : Result.ok({ kind: 'context', resourceContext });
};

// ---------------------------------------------------------------------------
// Instance creation
// ---------------------------------------------------------------------------

const toInternalResourceError = (id: string, error: unknown): InternalError => {
  const cause = error instanceof Error ? error : undefined;
  const message = cause?.message ?? String(error);
  return new InternalError(`Resource "${id}" failed to resolve: ${message}`, {
    ...(cause ? { cause } : {}),
    context: { resourceId: id },
  });
};

const getSingletonResourceCache = (
  declaredResource: AnyResource
): Map<string, unknown> => {
  const existing = singletonResources.get(declaredResource);
  if (existing !== undefined) {
    return existing;
  }

  const created = new Map<string, unknown>();
  singletonResources.set(declaredResource, created);
  return created;
};

const doCreateResourceInstance = async (
  declaredResource: AnyResource,
  resourceContext: ResourceContext
): Promise<Result<unknown, Error>> => {
  try {
    const created = await declaredResource.create(resourceContext);
    if (created.isErr()) {
      return Result.err(created.error);
    }

    const instance = created.unwrap();
    getSingletonResourceCache(declaredResource).set(
      toResourceContextKey(resourceContext),
      instance
    );
    return Result.ok(instance);
  } catch (error: unknown) {
    return Result.err(toInternalResourceError(declaredResource.id, error));
  }
};

const trackPendingCreation = (
  declaredResource: AnyResource,
  key: string,
  promise: Promise<Result<unknown, Error>>
): void => {
  const pending = pendingCreations.get(declaredResource);
  if (pending) {
    pending.set(key, promise);
  } else {
    pendingCreations.set(declaredResource, new Map([[key, promise]]));
  }
};

/**
 * Deduplicates concurrent creation of the same resource singleton.
 * If a creation is already in flight for this resource x context key,
 * returns the existing promise instead of spawning a second factory call.
 */
const createResourceInstance = async (
  declaredResource: AnyResource,
  resourceContext: ResourceContext
): Promise<Result<unknown, Error>> => {
  const key = toResourceContextKey(resourceContext);
  const inflight = pendingCreations.get(declaredResource)?.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = doCreateResourceInstance(declaredResource, resourceContext);
  trackPendingCreation(declaredResource, key, promise);

  try {
    return await promise;
  } finally {
    pendingCreations.get(declaredResource)?.delete(key);
  }
};

/** Validate config and resolve a single declared resource. */
const resolveDeclaredResource = async (
  declaredResource: AnyResource,
  ctx: TrailContext,
  overrides: ResourceOverrideMap | undefined,
  configValues: ConfigValues | undefined
): Promise<Result<unknown, Error>> => {
  // Check overrides/extensions first — skip config validation entirely when
  // a resource instance is already provided.
  const overrideOrExtension = getOverrideOrExtension(
    ctx,
    overrides,
    declaredResource
  );
  if (overrideOrExtension !== undefined) {
    return overrideOrExtension;
  }

  // Resolve config before consulting the singleton cache so config-aware
  // resources use the same canonical context for cache reads and writes.
  const configAwareResource = resolveConfigAwareProvidedResource(
    ctx,
    declaredResource,
    configValues
  );
  if (configAwareResource.isErr()) {
    return configAwareResource;
  }

  // No provided instance — create via factory.
  const resolved = configAwareResource.unwrap();
  if (resolved.kind === 'provided') {
    return Result.ok(resolved.value);
  }

  return await createResourceInstance(
    declaredResource,
    resolved.resourceContext
  );
};

// ---------------------------------------------------------------------------
// Full trail resource resolution
// ---------------------------------------------------------------------------

const withResolvedResources = (
  ctx: TrailContext,
  resolvedResources: Record<string, unknown>
): TrailContext => {
  const extensions = { ...ctx.extensions, ...resolvedResources };
  const resolvedCtx = { ...ctx, extensions } as MutableTrailContext;
  const lookup = createResourceLookup(() => resolvedCtx);
  resolvedCtx.resource = lookup;
  return resolvedCtx;
};

/**
 * Resolve all declared resources for a trail.
 *
 * Validates per-resource config, checks overrides and caches, and creates
 * new instances as needed. Returns an enriched context with all resource
 * instances injected into extensions.
 */
export const resolveResources = async (
  trail: AnyTrail,
  ctx: TrailContext,
  overrides?: ResourceOverrideMap,
  configValues?: ConfigValues
): Promise<Result<TrailContext, Error>> => {
  const { resources } = trail;
  if (resources.length === 0) {
    return Result.ok(ctx);
  }

  const resolvedResources: Record<string, unknown> = {};

  for (const declaredResource of resources) {
    const resolved = await resolveDeclaredResource(
      declaredResource,
      ctx,
      overrides,
      configValues
    );
    if (resolved.isErr()) {
      return resolved;
    }
    resolvedResources[declaredResource.id] = resolved.unwrap();
  }

  return Result.ok(withResolvedResources(ctx, resolvedResources));
};
