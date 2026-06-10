import { InternalError } from './errors.js';
import type { Result } from './result.js';
import type { AnySignal } from './signal.js';
import type { ResourceLookup, TrailContext } from './types.js';
import type { z } from 'zod';

/**
 * Stable process-scoped fields available when constructing a resource.
 *
 * Resources are app-level singletons, so they intentionally do not receive
 * the full per-request TrailContext. When a resource declares a `config` schema,
 * the validated config is passed as `resourceCtx.config`.
 */
export type ResourceContext<C = unknown> = Pick<
  TrailContext,
  'cwd' | 'env' | 'workspaceRoot'
> & {
  readonly config: C;
};

/** Explicit marker for resources that intentionally cannot provide a mock. */
export interface ResourceUnmockable {
  readonly reason: string;
}

/**
 * Everything needed to describe a resource before a factory is introduced.
 *
 * When `config` is a Zod schema, the `create` callback receives
 * `ResourceContext<C>` with the validated config value.
 */
export interface ResourceSpec<T, C = unknown> {
  /** Create the resource instance from stable process-scoped context. */
  readonly create: (
    resourceCtx: ResourceContext<C>
  ) => Result<T, Error> | Promise<Result<T, Error>>;
  /** Config schema — when present, config is validated and passed to `create`. */
  readonly config?: z.ZodType<C> | undefined;
  /** Optional cleanup performed when the host application shuts down. */
  readonly dispose?: ((resource: T) => void | Promise<void>) | undefined;
  /** Optional operational readiness probe for introspection tooling. */
  readonly health?:
    | ((
        resource: T
      ) => Result<unknown, Error> | Promise<Result<unknown, Error>>)
    | undefined;
  /** Optional test factory used by higher-level helpers. */
  readonly mock?: (() => T | Promise<T>) | undefined;
  /** Document why this resource intentionally cannot provide a test mock. */
  readonly unmockable?: ResourceUnmockable | undefined;
  /** Human-readable description. */
  readonly description?: string | undefined;
  /** Arbitrary meta for tooling and filtering. */
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  /** Signals projected or owned by this resource. */
  readonly signals?: readonly AnySignal[] | undefined;
  /** Reserved for future resource-specific design; trail versioning is trail-only. */
  readonly version?: never;
}

type ResourceSpecWithConfig<T, S extends z.ZodTypeAny> = Omit<
  ResourceSpec<T, z.infer<S>>,
  'config'
> & {
  readonly config: S;
};

/** A typed resource definition. */
export interface Resource<T, C = unknown> extends ResourceSpec<T, C> {
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
export type AnyResource = Resource<any, any>;

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
      throw new InternalError(`Resource "${id}" not provisioned in context`);
    }
    return getResourceInstance(ctx, id);
  }) as ResourceLookup;

/**
 * Create a typed resource definition.
 *
 * The resource object is inert until a later execution branch resolves concrete
 * instances into TrailContext extensions.
 */
export function resource<T, S extends z.ZodTypeAny>(
  id: string,
  spec: ResourceSpecWithConfig<T, S>
): Resource<T, z.infer<S>>;
export function resource<T, C = unknown>(
  id: string,
  spec: ResourceSpec<T, C>
): Resource<T, C>;
export function resource<T, C = unknown>(
  id: string,
  spec: ResourceSpec<T, C>
): Resource<T, C> {
  if (id.includes(':')) {
    throw new InternalError(
      `Resource "${id}" is invalid because resource ids may not contain ":"`
    );
  }
  if (spec.mock !== undefined && spec.unmockable !== undefined) {
    throw new InternalError(
      `Resource "${id}" cannot define both mock and unmockable`
    );
  }
  if (
    spec.unmockable !== undefined &&
    spec.unmockable.reason.trim().length === 0
  ) {
    throw new InternalError(
      `Resource "${id}" is invalid because unmockable.reason must not be empty`
    );
  }

  return Object.freeze({
    ...spec,
    from(ctx: TrailContext): T {
      const lookup = ctx.resource ?? createResourceLookup(() => ctx);
      return lookup(this);
    },
    id,
    kind: 'resource' as const,
  });
}

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
