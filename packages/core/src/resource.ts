import { NotFoundError } from './errors.js';
import type { Result } from './result.js';
import type { AnySignal } from './signal.js';
import type { ResourceLookup, TrailContext } from './types.js';
import type { z } from 'zod';

/**
 * Stable process-scoped fields available when constructing a resource.
 *
 * Resources are app-level singletons, so they intentionally do not receive
 * the full per-request TrailContext. When a resource declares a `config` schema,
 * the validated config is passed as `svc.config`.
 */
export type ResourceContext<C = unknown> = Pick<
  TrailContext,
  'cwd' | 'env' | 'workspaceRoot'
> & {
  readonly config: C;
};

/**
 * Everything needed to describe a resource before a factory is introduced.
 *
 * When `config` is a Zod schema, the `create` callback receives
 * `ResourceContext<C>` with the validated config value.
 */
export interface ResourceSpec<T, C = unknown> {
  /** Create the resource instance from stable process-scoped context. */
  readonly create: (
    svc: ResourceContext<C>
  ) => Result<T, Error> | Promise<Result<T, Error>>;
  /** Config schema — when present, config is validated and passed to `create`. */
  readonly config?: z.ZodType<C> | undefined;
  /** Optional cleanup performed when the hosting trailhead shuts down. */
  readonly dispose?: ((resource: T) => void | Promise<void>) | undefined;
  /** Optional operational readiness probe for introspection tooling. */
  readonly health?:
    | ((
        resource: T
      ) => Result<unknown, Error> | Promise<Result<unknown, Error>>)
    | undefined;
  /** Optional test factory used by higher-level helpers. */
  readonly mock?: (() => T | Promise<T>) | undefined;
  /** Human-readable description. */
  readonly description?: string | undefined;
  /** Arbitrary meta for tooling and filtering. */
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  /** Signals projected or owned by this resource. */
  readonly signals?: readonly AnySignal[] | undefined;
}

/** A typed resource definition. */
export interface Resource<T> extends ResourceSpec<T> {
  readonly kind: 'resource';
  readonly id: string;
  /** Read the resolved resource instance from a trail context. */
  from(ctx: TrailContext): T;
}

/**
 * Existential type for heterogeneous resource collections.
 *
 * `Resource<T>` includes function parameters in `dispose`/`health`, so
 * `unknown` is too narrow for mixed resource arrays. `any` is the correct
 * existential here.
 */
// oxlint-disable-next-line no-explicit-any -- existential type for heterogeneous resource collections
export type AnyResource = Resource<any>;

/** Explicit runtime overrides keyed by resource ID. */
export type ResourceOverrideMap = Readonly<Record<string, unknown>>;

const getResourceId = <T>(
  resourceOrId: string | Pick<Resource<T>, 'id'>
): string =>
  typeof resourceOrId === 'string' ? resourceOrId : resourceOrId.id;

const getResourceInstance = <T>(
  ctx: Pick<TrailContext, 'extensions'>,
  resourceOrId: string | Pick<Resource<T>, 'id'>
): T => {
  const id = getResourceId(resourceOrId);
  return ctx.extensions?.[id] as T;
};

const hasResourceInstance = (
  ctx: Pick<TrailContext, 'extensions'>,
  resourceOrId: string | Pick<AnyResource, 'id'>
): boolean => Object.hasOwn(ctx.extensions ?? {}, getResourceId(resourceOrId));

/** Create a `ctx.resource(...)` accessor bound to a concrete context snapshot. */
export const createResourceLookup = (
  getContext: () => Pick<TrailContext, 'extensions'>
): ResourceLookup =>
  ((resourceOrId: string | Pick<AnyResource, 'id'>) => {
    const id = getResourceId(resourceOrId);
    const ctx = getContext();
    if (!hasResourceInstance(ctx, id)) {
      throw new NotFoundError(`Resource "${id}" not found in trail context`);
    }
    return getResourceInstance(ctx, id);
  }) as ResourceLookup;

/**
 * Create a typed resource definition.
 *
 * The resource object is inert until a later execution branch resolves concrete
 * instances into TrailContext extensions.
 */
export const resource = <T>(id: string, spec: ResourceSpec<T>): Resource<T> =>
  Object.freeze({
    ...spec,
    from(ctx: TrailContext): T {
      const lookup = ctx.resource ?? createResourceLookup(() => ctx);
      return lookup(this);
    },
    id,
    kind: 'resource' as const,
  });

/** Narrow unknown values to resource definitions during topo discovery. */
export const isResource = (value: unknown): value is AnyResource => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { kind?: unknown; id?: unknown };
  return v.kind === 'resource' && typeof v.id === 'string';
};

/**
 * Return the first duplicate resource ID in a collection, if any.
 *
 * This supports later topo registration without each caller duplicating the
 * same scan logic.
 */
export const findDuplicateResourceId = (
  resources: readonly Pick<AnyResource, 'id'>[]
): string | undefined => {
  const seen = new Set<string>();
  for (const candidate of resources) {
    if (seen.has(candidate.id)) {
      return candidate.id;
    }
    seen.add(candidate.id);
  }
  return undefined;
};
