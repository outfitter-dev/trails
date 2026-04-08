/**
 * Resource resolution pipeline.
 *
 * Extracted from execute.ts to keep both modules under the 400 LOC ceiling.
 * Handles config validation, singleton caching, concurrent-creation dedup,
 * and the full resolve-or-create flow for declared resources.
 */

import type {
  AnyProvision,
  ProvisionContext,
  ProvisionOverrideMap,
} from './resource.js';
import type { AnyTrail } from './trail.js';
import type { TrailContext } from './types.js';

import { InternalError, ValidationError } from './errors.js';
import { Result } from './result.js';
import { createProvisionLookup } from './resource.js';

type MutableTrailContext = {
  -readonly [K in keyof TrailContext]: TrailContext[K];
};

type ConfigValues = Readonly<Record<string, Record<string, unknown>>>;

// ---------------------------------------------------------------------------
// Singleton caches
// ---------------------------------------------------------------------------

const singletonProvisions = new WeakMap<AnyProvision, Map<string, unknown>>();

/** In-flight resource creation promises, keyed by resource x context. */
const pendingCreations = new WeakMap<
  AnyProvision,
  Map<string, Promise<Result<unknown, Error>>>
>();

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

const toProvisionContext = (
  ctx: TrailContext,
  config?: unknown
): ProvisionContext => ({
  config,
  cwd: ctx.cwd,
  env: ctx.env,
  workspaceRoot: ctx.workspaceRoot,
});

const toProvisionContextKey = (ctx: ProvisionContext): string =>
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
const resolveProvisionConfig = (
  declaredProvision: AnyProvision,
  configValues?: ConfigValues
): Result<unknown, Error> => {
  if (declaredProvision.config === undefined) {
    return Result.ok();
  }
  const raw = configValues?.[declaredProvision.id];
  if (raw === undefined) {
    return Result.err(
      new ValidationError(
        `Resource "${declaredProvision.id}" declares a config schema but no config was provided`
      )
    );
  }
  const parsed = declaredProvision.config.safeParse(raw);
  if (!parsed.success) {
    return Result.err(
      new ValidationError(
        `Resource "${declaredProvision.id}" config validation failed: ${parsed.error.message}`
      )
    );
  }
  return Result.ok(parsed.data);
};

// ---------------------------------------------------------------------------
// Override / cache lookups
// ---------------------------------------------------------------------------

const hasOwnProvisionOverride = (
  overrides: ProvisionOverrideMap | undefined,
  id: string
): overrides is ProvisionOverrideMap =>
  overrides !== undefined && Object.hasOwn(overrides, id);

const getCachedSingletonProvision = (
  declaredProvision: AnyProvision,
  provisionContext: ProvisionContext
): { readonly found: boolean; readonly value: unknown } => {
  const scopedCache = singletonProvisions.get(declaredProvision);
  if (scopedCache === undefined) {
    return { found: false, value: undefined };
  }

  const key = toProvisionContextKey(provisionContext);
  if (!scopedCache.has(key)) {
    return { found: false, value: undefined };
  }

  return {
    found: true,
    value: scopedCache.get(key),
  };
};

const getProvidedProvision = (
  ctx: TrailContext,
  overrides: ProvisionOverrideMap | undefined,
  declaredProvision: AnyProvision,
  provisionContext: ProvisionContext
): Result<unknown, Error> | undefined => {
  const { id } = declaredProvision;
  if (hasOwnProvisionOverride(overrides, id)) {
    return Result.ok(overrides[id]);
  }

  if (Object.hasOwn(ctx.extensions ?? {}, id)) {
    return Result.ok(ctx.extensions?.[id]);
  }

  const cached = getCachedSingletonProvision(
    declaredProvision,
    provisionContext
  );
  if (cached.found) {
    return Result.ok(cached.value);
  }

  return undefined;
};

const getOverrideOrExtension = (
  ctx: TrailContext,
  overrides: ProvisionOverrideMap | undefined,
  declaredProvision: AnyProvision
): Result<unknown, Error> | undefined =>
  getProvidedProvision(
    ctx,
    overrides,
    declaredProvision,
    toProvisionContext(ctx)
  );

type ConfigAwareResolution =
  | Result<{ readonly kind: 'provided'; readonly value: unknown }, Error>
  | Result<
      { readonly kind: 'context'; readonly provisionContext: ProvisionContext },
      Error
    >;

const resolveConfigAwareProvidedProvision = (
  ctx: TrailContext,
  declaredProvision: AnyProvision,
  configValues: ConfigValues | undefined
): ConfigAwareResolution => {
  const configResult = resolveProvisionConfig(declaredProvision, configValues);
  if (configResult.isErr()) {
    return configResult;
  }

  const provisionContext = toProvisionContext(ctx, configResult.value);
  const provided = getProvidedProvision(
    ctx,
    undefined,
    declaredProvision,
    provisionContext
  );

  return provided
    ? Result.ok({ kind: 'provided', value: provided.unwrap() })
    : Result.ok({ kind: 'context', provisionContext });
};

// ---------------------------------------------------------------------------
// Instance creation
// ---------------------------------------------------------------------------

const toInternalProvisionError = (
  id: string,
  error: unknown
): InternalError => {
  const cause = error instanceof Error ? error : undefined;
  const message = cause?.message ?? String(error);
  return new InternalError(`Resource "${id}" failed to resolve: ${message}`, {
    ...(cause ? { cause } : {}),
    context: { provisionId: id },
  });
};

const getSingletonProvisionCache = (
  declaredProvision: AnyProvision
): Map<string, unknown> => {
  const existing = singletonProvisions.get(declaredProvision);
  if (existing !== undefined) {
    return existing;
  }

  const created = new Map<string, unknown>();
  singletonProvisions.set(declaredProvision, created);
  return created;
};

const doCreateProvisionInstance = async (
  declaredProvision: AnyProvision,
  provisionContext: ProvisionContext
): Promise<Result<unknown, Error>> => {
  try {
    const created = await declaredProvision.create(provisionContext);
    if (created.isErr()) {
      return Result.err(created.error);
    }

    const instance = created.unwrap();
    getSingletonProvisionCache(declaredProvision).set(
      toProvisionContextKey(provisionContext),
      instance
    );
    return Result.ok(instance);
  } catch (error: unknown) {
    return Result.err(toInternalProvisionError(declaredProvision.id, error));
  }
};

const trackPendingCreation = (
  declaredProvision: AnyProvision,
  key: string,
  promise: Promise<Result<unknown, Error>>
): void => {
  const pending = pendingCreations.get(declaredProvision);
  if (pending) {
    pending.set(key, promise);
  } else {
    pendingCreations.set(declaredProvision, new Map([[key, promise]]));
  }
};

/**
 * Deduplicates concurrent creation of the same resource singleton.
 * If a creation is already in flight for this resource x context key,
 * returns the existing promise instead of spawning a second factory call.
 */
const createProvisionInstance = async (
  declaredProvision: AnyProvision,
  provisionContext: ProvisionContext
): Promise<Result<unknown, Error>> => {
  const key = toProvisionContextKey(provisionContext);
  const inflight = pendingCreations.get(declaredProvision)?.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = doCreateProvisionInstance(
    declaredProvision,
    provisionContext
  );
  trackPendingCreation(declaredProvision, key, promise);

  try {
    return await promise;
  } finally {
    pendingCreations.get(declaredProvision)?.delete(key);
  }
};

/** Validate config and resolve a single declared resource. */
const resolveDeclaredProvision = async (
  declaredProvision: AnyProvision,
  ctx: TrailContext,
  overrides: ProvisionOverrideMap | undefined,
  configValues: ConfigValues | undefined
): Promise<Result<unknown, Error>> => {
  // Check overrides/extensions first — skip config validation entirely when
  // a resource instance is already provided.
  const overrideOrExtension = getOverrideOrExtension(
    ctx,
    overrides,
    declaredProvision
  );
  if (overrideOrExtension !== undefined) {
    return overrideOrExtension;
  }

  // Resolve config before consulting the singleton cache so config-aware
  // resources use the same canonical context for cache reads and writes.
  const configAwareProvision = resolveConfigAwareProvidedProvision(
    ctx,
    declaredProvision,
    configValues
  );
  if (configAwareProvision.isErr()) {
    return configAwareProvision;
  }

  // No provided instance — create via factory.
  const resolved = configAwareProvision.unwrap();
  if (resolved.kind === 'provided') {
    return Result.ok(resolved.value);
  }

  return await createProvisionInstance(
    declaredProvision,
    resolved.provisionContext
  );
};

// ---------------------------------------------------------------------------
// Full trail resource resolution
// ---------------------------------------------------------------------------

const withResolvedProvisions = (
  ctx: TrailContext,
  resolvedProvisions: Record<string, unknown>
): TrailContext => {
  const extensions = { ...ctx.extensions, ...resolvedProvisions };
  const resolvedCtx = { ...ctx, extensions } as MutableTrailContext;
  const lookup = createProvisionLookup(() => resolvedCtx);
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
export const resolveProvisions = async (
  trail: AnyTrail,
  ctx: TrailContext,
  overrides?: ProvisionOverrideMap,
  configValues?: ConfigValues
): Promise<Result<TrailContext, Error>> => {
  const { resources } = trail;
  if (resources.length === 0) {
    return Result.ok(ctx);
  }

  const resolvedProvisions: Record<string, unknown> = {};

  for (const declaredProvision of resources) {
    const resolved = await resolveDeclaredProvision(
      declaredProvision,
      ctx,
      overrides,
      configValues
    );
    if (resolved.isErr()) {
      return resolved;
    }
    resolvedProvisions[declaredProvision.id] = resolved.unwrap();
  }

  return Result.ok(withResolvedProvisions(ctx, resolvedProvisions));
};
