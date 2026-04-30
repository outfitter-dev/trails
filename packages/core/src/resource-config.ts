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

interface SingletonResourceEntry {
  readonly value: unknown;
  activeLeases: number;
}

interface ResourceLease {
  readonly key: string;
  readonly resource: AnyResource;
  readonly value: unknown;
}

const singletonResources = new WeakMap<
  AnyResource,
  Map<string, SingletonResourceEntry>
>();

interface PendingCreation {
  readonly promise: Promise<Result<unknown, Error>>;
  waiters: number;
}

/** In-flight resource creation promises, keyed by resource x context. */
const pendingCreations = new WeakMap<
  AnyResource,
  Map<string, PendingCreation>
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
):
  | { readonly found: false }
  | { readonly found: true; readonly lease: ResourceLease } => {
  const scopedCache = singletonResources.get(declaredResource);
  if (scopedCache === undefined) {
    return { found: false };
  }

  const key = toResourceContextKey(resourceContext);
  const entry = scopedCache.get(key);
  if (entry === undefined) {
    return { found: false };
  }

  entry.activeLeases += 1;
  return {
    found: true,
    lease: { key, resource: declaredResource, value: entry.value },
  };
};

const getProvidedResource = (
  ctx: TrailContext,
  overrides: ResourceOverrideMap | undefined,
  declaredResource: AnyResource,
  resourceContext: ResourceContext
):
  | Result<
      { readonly lease?: ResourceLease | undefined; readonly value: unknown },
      Error
    >
  | undefined => {
  const { id } = declaredResource;
  if (hasOwnResourceOverride(overrides, id)) {
    return Result.ok({ value: overrides[id] });
  }

  if (Object.hasOwn(ctx.extensions ?? {}, id)) {
    return Result.ok({ value: ctx.extensions?.[id] });
  }

  const cached = getCachedSingletonResource(declaredResource, resourceContext);
  if (cached.found) {
    return Result.ok({ lease: cached.lease, value: cached.lease?.value });
  }

  return undefined;
};

const getOverrideOrExtension = (
  ctx: TrailContext,
  overrides: ResourceOverrideMap | undefined,
  declaredResource: AnyResource
):
  | Result<
      { readonly lease?: ResourceLease | undefined; readonly value: unknown },
      Error
    >
  | undefined =>
  getProvidedResource(ctx, overrides, declaredResource, toResourceContext(ctx));

type ConfigAwareResolution =
  | Result<
      {
        readonly kind: 'provided';
        readonly lease?: ResourceLease | undefined;
        readonly value: unknown;
      },
      Error
    >
  | Result<
      { readonly kind: 'context'; readonly resourceContext: ResourceContext },
      Error
    >;

interface CreatedResourceInstance {
  readonly key: string;
  readonly lease: ResourceLease;
  readonly resource: AnyResource;
  readonly sharedDuringCreation: boolean;
  readonly value: unknown;
}

interface ResourceResolution {
  readonly created?: CreatedResourceInstance | undefined;
  readonly lease?: ResourceLease | undefined;
  readonly value: unknown;
}

/** Outcome from draining cached resource singletons. */
export interface ResourceDrainReport {
  /** Resource IDs whose cached singleton entries were disposed successfully. */
  readonly disposed: readonly string[];
  /** Resource IDs removed from the singleton cache before disposal. */
  readonly evicted: readonly string[];
  /**
   * Resource IDs that had cached or pending singleton entries, but not for the
   * stable context/config key supplied to `drainResources`.
   */
  readonly missed?: readonly string[] | undefined;
}

interface MutableResourceDrainReport {
  readonly disposed: string[];
  readonly evicted: string[];
  missed?: string[] | undefined;
}

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

  if (provided === undefined) {
    return Result.ok({ kind: 'context', resourceContext });
  }
  if (provided.isErr()) {
    return provided;
  }

  return Result.ok({
    kind: 'provided',
    lease: provided.value.lease,
    value: provided.value.value,
  });
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
): Map<string, SingletonResourceEntry> => {
  const existing = singletonResources.get(declaredResource);
  if (existing !== undefined) {
    return existing;
  }

  const created = new Map<string, SingletonResourceEntry>();
  singletonResources.set(declaredResource, created);
  return created;
};

const acquireCachedSingletonResourceByKey = (
  declaredResource: AnyResource,
  key: string
): ResourceLease | undefined => {
  const entry = singletonResources.get(declaredResource)?.get(key);
  if (entry === undefined) {
    return undefined;
  }

  entry.activeLeases += 1;
  return { key, resource: declaredResource, value: entry.value };
};

const releaseResourceLease = (lease: ResourceLease): number => {
  const entry = singletonResources.get(lease.resource)?.get(lease.key);
  if (entry === undefined || entry.value !== lease.value) {
    return 0;
  }

  entry.activeLeases = Math.max(0, entry.activeLeases - 1);
  return entry.activeLeases;
};

const countActiveResourceLeases = (lease: ResourceLease): number => {
  const entry = singletonResources.get(lease.resource)?.get(lease.key);
  return entry === undefined || entry.value !== lease.value
    ? 0
    : entry.activeLeases;
};

const releaseResourceLeases = (leases: readonly ResourceLease[]): void => {
  for (const lease of leases.toReversed()) {
    releaseResourceLease(lease);
  }
};

const deleteCachedSingletonResource = (
  declaredResource: AnyResource,
  key: string,
  value: unknown
): boolean => {
  const cache = singletonResources.get(declaredResource);
  const entry = cache?.get(key);
  if (entry === undefined || entry.value !== value) {
    return false;
  }

  cache?.delete(key);
  return true;
};

const disposeResourceInstance = async (
  resource: AnyResource,
  value: unknown
): Promise<Result<void, Error>> => {
  if (resource.dispose === undefined) {
    return Result.ok();
  }

  try {
    await resource.dispose(value);
    return Result.ok();
  } catch (error: unknown) {
    const cause = error instanceof Error ? error : undefined;
    const message = cause?.message ?? String(error);
    return Result.err(
      new InternalError(
        `Resource "${resource.id}" failed to dispose: ${message}`,
        {
          ...(cause ? { cause } : {}),
          context: { resourceId: resource.id },
        }
      )
    );
  }
};

const toResourceLifecycleError = (
  message: string,
  errors: readonly Error[],
  cause?: Error,
  context?: Record<string, unknown>
): InternalError =>
  new InternalError(message, {
    ...(cause ? { cause } : {}),
    context: {
      ...context,
      failures: errors.map((error) => ({
        message: error.message,
        name: error.name,
        ...(error instanceof InternalError && error.context !== undefined
          ? { context: error.context }
          : {}),
      })),
    },
  });

const doCreateResourceInstance = async (
  declaredResource: AnyResource,
  resourceContext: ResourceContext,
  key: string
): Promise<Result<unknown, Error>> => {
  try {
    const created = await declaredResource.create(resourceContext);
    if (created.isErr()) {
      return Result.err(created.error);
    }

    const instance = created.unwrap();
    getSingletonResourceCache(declaredResource).set(key, {
      activeLeases: 1,
      value: instance,
    });
    return Result.ok(instance);
  } catch (error: unknown) {
    return Result.err(toInternalResourceError(declaredResource.id, error));
  }
};

const trackPendingCreation = (
  declaredResource: AnyResource,
  key: string,
  promise: Promise<Result<unknown, Error>>
): PendingCreation => {
  const entry: PendingCreation = { promise, waiters: 0 };
  const pending = pendingCreations.get(declaredResource);
  if (pending) {
    pending.set(key, entry);
  } else {
    pendingCreations.set(declaredResource, new Map([[key, entry]]));
  }
  return entry;
};

/**
 * Deduplicates concurrent creation of the same resource singleton.
 * If a creation is already in flight for this resource x context key,
 * returns the existing promise instead of spawning a second factory call.
 */
const createResourceInstance = async (
  declaredResource: AnyResource,
  resourceContext: ResourceContext
): Promise<Result<ResourceResolution, Error>> => {
  const key = toResourceContextKey(resourceContext);
  const inflight = pendingCreations.get(declaredResource)?.get(key);
  if (inflight) {
    inflight.waiters += 1;
    const resolved = await inflight.promise;
    if (resolved.isErr()) {
      return resolved;
    }
    const lease = acquireCachedSingletonResourceByKey(declaredResource, key);
    return lease === undefined
      ? Result.err(
          new InternalError(
            `Resource "${declaredResource.id}" was created but is no longer cached`,
            { context: { resourceId: declaredResource.id } }
          )
        )
      : Result.ok({ lease, value: lease.value });
  }

  const promise = doCreateResourceInstance(
    declaredResource,
    resourceContext,
    key
  );
  const pending = trackPendingCreation(declaredResource, key, promise);

  try {
    const resolved = await promise;
    if (resolved.isErr()) {
      return resolved;
    }
    const { value } = resolved;
    const lease = { key, resource: declaredResource, value };
    return Result.ok({
      created: {
        key,
        lease,
        resource: declaredResource,
        sharedDuringCreation: pending.waiters > 0,
        value,
      },
      lease,
      value,
    });
  } finally {
    pendingCreations.get(declaredResource)?.delete(key);
  }
};

const rollbackCreatedResources = async (
  created: readonly CreatedResourceInstance[]
): Promise<Result<void, Error>> => {
  const failures: Error[] = [];

  for (const entry of created.toReversed()) {
    const activeLeases = countActiveResourceLeases(entry.lease);
    if (activeLeases > 0 || entry.sharedDuringCreation) {
      continue;
    }
    const deleted = deleteCachedSingletonResource(
      entry.resource,
      entry.key,
      entry.value
    );
    if (!deleted) {
      continue;
    }
    const disposed = await disposeResourceInstance(entry.resource, entry.value);
    if (disposed.isErr()) {
      failures.push(disposed.error);
    }
  }

  return failures.length === 0
    ? Result.ok()
    : Result.err(
        toResourceLifecycleError(
          'Resource rollback failed during resource resolution',
          failures
        )
      );
};

const resolveDeclaredResourceForCreation = async (
  declaredResource: AnyResource,
  ctx: TrailContext,
  overrides: ResourceOverrideMap | undefined,
  configValues: ConfigValues | undefined
): Promise<Result<ResourceResolution, Error>> => {
  // Check overrides/extensions first — skip config validation entirely when
  // a resource instance is already provided.
  const overrideOrExtension = getOverrideOrExtension(
    ctx,
    overrides,
    declaredResource
  );
  if (overrideOrExtension !== undefined) {
    return overrideOrExtension.isErr()
      ? overrideOrExtension
      : Result.ok({
          lease: overrideOrExtension.value.lease,
          value: overrideOrExtension.value.value,
        });
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
    return Result.ok({ lease: resolved.lease, value: resolved.value });
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
 * Resolved trail context plus lease release for resources used by the run.
 */
interface ResolvedResourceScope {
  readonly ctx: TrailContext;
  release(): void;
}

const releaseNoResources = (): undefined => undefined;

/**
 * Resolve all declared resources for a trail.
 *
 * Validates per-resource config, checks overrides and caches, and creates
 * new instances as needed. Returns an enriched context with all resource
 * instances injected into extensions.
 */
export const createResources = async (
  trail: AnyTrail,
  ctx: TrailContext,
  overrides?: ResourceOverrideMap,
  configValues?: ConfigValues
): Promise<Result<ResolvedResourceScope, Error>> => {
  const resources = [...new Set(trail.resources)];
  if (resources.length === 0) {
    return Result.ok({ ctx, release: releaseNoResources });
  }

  const resolvedResources: Record<string, unknown> = {};
  const acquiredLeases: ResourceLease[] = [];
  const createdResources: CreatedResourceInstance[] = [];

  for (const declaredResource of resources) {
    const resolved = await resolveDeclaredResourceForCreation(
      declaredResource,
      ctx,
      overrides,
      configValues
    );
    if (resolved.isErr()) {
      releaseResourceLeases(acquiredLeases);
      const rolledBack = await rollbackCreatedResources(createdResources);
      if (rolledBack.isErr()) {
        return Result.err(
          toResourceLifecycleError(
            `Resource resolution failed for "${declaredResource.id}" and rollback also failed`,
            [rolledBack.error],
            resolved.error
          )
        );
      }
      return resolved;
    }
    const resolution = resolved.unwrap();
    if (resolution.lease !== undefined) {
      acquiredLeases.push(resolution.lease);
    }
    if (resolution.created !== undefined) {
      createdResources.push(resolution.created);
    }
    resolvedResources[declaredResource.id] = resolution.value;
  }

  return Result.ok({
    ctx: withResolvedResources(ctx, resolvedResources),
    release: () => releaseResourceLeases(acquiredLeases),
  });
};

const toResourceInUseError = (
  resource: AnyResource,
  activeLeases: number
): InternalError =>
  new InternalError(`Resource "${resource.id}" is still in use`, {
    context: { activeLeases, resourceId: resource.id },
  });

const drainCachedEntry = async (
  resource: AnyResource,
  key: string,
  entry: SingletonResourceEntry,
  report: MutableResourceDrainReport,
  failures: Error[]
): Promise<void> => {
  if (entry.activeLeases > 0) {
    failures.push(toResourceInUseError(resource, entry.activeLeases));
    return;
  }

  const deleted = deleteCachedSingletonResource(resource, key, entry.value);
  if (!deleted) {
    return;
  }
  report.evicted.push(resource.id);

  const result = await disposeResourceInstance(resource, entry.value);
  if (result.isErr()) {
    failures.push(result.error);
  } else if (resource.dispose !== undefined) {
    report.disposed.push(resource.id);
  }
};

const recordDrainMiss = (
  resource: AnyResource,
  report: MutableResourceDrainReport
): void => {
  report.missed ??= [];
  if (report.missed.includes(resource.id)) {
    return;
  }
  report.missed.push(resource.id);
};

const hasKeyOtherThan = <T>(
  entries: ReadonlyMap<string, T> | undefined,
  key: string
): boolean => {
  if (entries === undefined) {
    return false;
  }
  for (const existingKey of entries.keys()) {
    if (existingKey !== key) {
      return true;
    }
  }
  return false;
};

const hasOtherSingletonKeys = (
  key: string,
  cache: ReadonlyMap<string, SingletonResourceEntry> | undefined,
  pending: ReadonlyMap<string, PendingCreation> | undefined
): boolean => hasKeyOtherThan(cache, key) || hasKeyOtherThan(pending, key);

/**
 * Evict and dispose cached resource singletons for a stable resource context.
 *
 * Call this from surface or test shutdown paths with the same `ctx` and
 * `configValues` used for execution. The returned report lists resources
 * removed from the singleton cache and resources whose `dispose` hook ran
 * successfully. On partial failure, the `InternalError` context still includes
 * the report arrays so callers can tell what cleanup already happened.
 */
export const drainResources = async (
  resources: readonly AnyResource[],
  ctx: TrailContext,
  configValues?: ConfigValues
): Promise<Result<ResourceDrainReport, Error>> => {
  const report: MutableResourceDrainReport = { disposed: [], evicted: [] };
  const failures: Error[] = [];

  for (const resource of resources.toReversed()) {
    const cache = singletonResources.get(resource);
    const pending = pendingCreations.get(resource);
    if (
      (cache === undefined || cache.size === 0) &&
      (pending === undefined || pending.size === 0)
    ) {
      continue;
    }

    const configResult = resolveResourceConfig(resource, configValues);
    if (configResult.isErr()) {
      failures.push(configResult.error);
      if (cache !== undefined) {
        for (const [key, entry] of [...cache.entries()].toReversed()) {
          await drainCachedEntry(resource, key, entry, report, failures);
        }
      }
      continue;
    }

    const key = toResourceContextKey(
      toResourceContext(ctx, configResult.value)
    );
    const hasAdditionalKeys = hasOtherSingletonKeys(key, cache, pending);
    const pendingForKey = pending?.get(key);
    if (pendingForKey !== undefined) {
      if (hasAdditionalKeys) {
        recordDrainMiss(resource, report);
      }
      failures.push(toResourceInUseError(resource, pendingForKey.waiters + 1));
      continue;
    }

    const entry = cache?.get(key);
    if (entry === undefined) {
      recordDrainMiss(resource, report);
      continue;
    }

    if (hasAdditionalKeys) {
      recordDrainMiss(resource, report);
    }
    await drainCachedEntry(resource, key, entry, report, failures);
  }

  return failures.length === 0
    ? Result.ok(report)
    : Result.err(
        toResourceLifecycleError('Resource drain failed', failures, undefined, {
          disposed: report.disposed,
          evicted: report.evicted,
          ...(report.missed === undefined ? {} : { missed: report.missed }),
        })
      );
};
