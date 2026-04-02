import { NotFoundError } from './errors.js';
import type { Result } from './result.js';
import type { ProvisionLookup, TrailContext } from './types.js';
import type { z } from 'zod';

/**
 * Stable process-scoped fields available when constructing a provision.
 *
 * Provisions are app-level singletons, so they intentionally do not receive
 * the full per-request TrailContext. When a provision declares a `config` schema,
 * the validated config is passed as `svc.config`.
 */
export type ProvisionContext<C = unknown> = Pick<
  TrailContext,
  'cwd' | 'env' | 'workspaceRoot'
> & {
  readonly config: C;
};

/**
 * Everything needed to describe a provision before a factory is introduced.
 *
 * When `config` is a Zod schema, the `create` callback receives
 * `ProvisionContext<C>` with the validated config value.
 */
export interface ProvisionSpec<T, C = unknown> {
  /** Create the provision instance from stable process-scoped context. */
  readonly create: (
    svc: ProvisionContext<C>
  ) => Result<T, Error> | Promise<Result<T, Error>>;
  /** Config schema — when present, config is validated and passed to `create`. */
  readonly config?: z.ZodType<C> | undefined;
  /** Optional cleanup performed when the hosting trailhead shuts down. */
  readonly dispose?: ((provision: T) => void | Promise<void>) | undefined;
  /** Optional operational readiness probe for introspection tooling. */
  readonly health?:
    | ((
        provision: T
      ) => Result<unknown, Error> | Promise<Result<unknown, Error>>)
    | undefined;
  /** Optional test factory used by higher-level helpers. */
  readonly mock?: (() => T | Promise<T>) | undefined;
  /** Human-readable description. */
  readonly description?: string | undefined;
  /** Arbitrary metadata for tooling and filtering. */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

/** A typed provision definition. */
export interface Provision<T> extends ProvisionSpec<T> {
  readonly kind: 'provision';
  readonly id: string;
  /** Read the resolved provision instance from a trail context. */
  from(ctx: TrailContext): T;
}

/**
 * Existential type for heterogeneous provision collections.
 *
 * `Provision<T>` includes function parameters in `dispose`/`health`, so
 * `unknown` is too narrow for mixed provision arrays. `any` is the correct
 * existential here.
 */
// oxlint-disable-next-line no-explicit-any -- existential type for heterogeneous provision collections
export type AnyProvision = Provision<any>;

/** Explicit runtime overrides keyed by provision ID. */
export type ProvisionOverrideMap = Readonly<Record<string, unknown>>;

const getProvisionId = <T>(
  provisionOrId: string | Pick<Provision<T>, 'id'>
): string =>
  typeof provisionOrId === 'string' ? provisionOrId : provisionOrId.id;

const getProvisionInstance = <T>(
  ctx: Pick<TrailContext, 'extensions'>,
  provisionOrId: string | Pick<Provision<T>, 'id'>
): T => {
  const id = getProvisionId(provisionOrId);
  return ctx.extensions?.[id] as T;
};

const hasProvisionInstance = (
  ctx: Pick<TrailContext, 'extensions'>,
  provisionOrId: string | Pick<AnyProvision, 'id'>
): boolean =>
  Object.hasOwn(ctx.extensions ?? {}, getProvisionId(provisionOrId));

/** Create a `ctx.provision(...)` accessor bound to a concrete context snapshot. */
export const createProvisionLookup = (
  getContext: () => Pick<TrailContext, 'extensions'>
): ProvisionLookup =>
  ((provisionOrId: string | Pick<AnyProvision, 'id'>) => {
    const id = getProvisionId(provisionOrId);
    const ctx = getContext();
    if (!hasProvisionInstance(ctx, id)) {
      throw new NotFoundError(`Provision "${id}" not found in trail context`);
    }
    return getProvisionInstance(ctx, id);
  }) as ProvisionLookup;

/**
 * Create a typed provision definition.
 *
 * The provision object is inert until a later execution branch resolves concrete
 * instances into TrailContext extensions.
 */
export const provision = <T>(
  id: string,
  spec: ProvisionSpec<T>
): Provision<T> =>
  Object.freeze({
    ...spec,
    from(ctx: TrailContext): T {
      const lookup = ctx.provision ?? createProvisionLookup(() => ctx);
      return lookup(this);
    },
    id,
    kind: 'provision' as const,
  });

/** Narrow unknown values to provision definitions during topo discovery. */
export const isProvision = (value: unknown): value is AnyProvision => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { kind?: unknown; id?: unknown };
  return v.kind === 'provision' && typeof v.id === 'string';
};

/**
 * Return the first duplicate provision ID in a collection, if any.
 *
 * This supports later topo registration without each caller duplicating the
 * same scan logic.
 */
export const findDuplicateProvisionId = (
  provisions: readonly Pick<AnyProvision, 'id'>[]
): string | undefined => {
  const seen = new Set<string>();
  for (const candidate of provisions) {
    if (seen.has(candidate.id)) {
      return candidate.id;
    }
    seen.add(candidate.id);
  }
  return undefined;
};
