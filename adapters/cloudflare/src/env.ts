/**
 * The Cloudflare env bridge.
 *
 * Worker bindings (KV, D1, R2, queues) arrive per-request on the `env`
 * argument of the Worker `fetch` handler. Trails resources are authored as
 * ordinary `resource()` definitions, so this module provides the seam that
 * connects the two: a subpath registers an {@link EnvBindingSpec} for each
 * resource definition it authors, and the Workers materializer resolves those
 * specs against the live `env` into per-materialization resource overrides.
 *
 * Overrides are re-resolved whenever a new `env` object arrives, and core
 * resolves overrides before its singleton resource cache, so no resource
 * instance can capture a stale env. Every Cloudflare subpath (`/kv` today,
 * `/d1`, `/queues`, `/r2` later) consumes this one seam.
 */

import { InternalError, Result } from '@ontrails/core';
import type { AnyResource, ResourceOverrideMap, Topo } from '@ontrails/core';

/**
 * The ambient Worker environment: bindings keyed by their wrangler-configured
 * names. Values are runtime binding objects (KV namespaces, D1 databases,
 * queues), so they are typed as `unknown` and narrowed by each subpath.
 */
export type WorkersEnv = Readonly<Record<string, unknown>>;

/**
 * How a resource definition materializes from the Worker env.
 *
 * `fromEnv` receives the raw binding value found at `env[binding]` and either
 * narrows it into the resource instance or explains why the binding does not
 * match the resource's expectations.
 */
export interface EnvBindingSpec {
  /** The wrangler binding name to read from the Worker env. */
  readonly binding: string;
  /** Narrow the raw binding value into the resource instance. */
  readonly fromEnv: (value: unknown) => Result<unknown, Error>;
}

const envBindings = new WeakMap<AnyResource, EnvBindingSpec>();

/**
 * Register an env binding for a resource definition.
 *
 * Called by Cloudflare subpaths (and available to apps authoring their own
 * env-bound resources) so the Workers materializer knows how to build the
 * resource instance from the per-request env.
 *
 * @example
 * ```ts
 * import { resource, Result } from '@ontrails/core';
 * import { registerEnvBinding } from '@ontrails/cloudflare/workers';
 *
 * const queue = resource<{ send(body: string): Promise<void> }>('outbox', {
 *   create: () => Result.err(new Error('outbox is only available on Workers')),
 *   mock: () => ({ send: () => Promise.resolve() }),
 * });
 * registerEnvBinding(queue, {
 *   binding: 'OUTBOX',
 *   fromEnv: (value) => Result.ok(value),
 * });
 * ```
 */
export const registerEnvBinding = (
  resourceDefinition: AnyResource,
  spec: EnvBindingSpec
): void => {
  envBindings.set(resourceDefinition, spec);
};

/**
 * Read the env binding registered for a resource definition, if any.
 *
 * @example
 * ```ts
 * import { getEnvBinding } from '@ontrails/cloudflare/workers';
 * import { cloudflareKv } from '@ontrails/cloudflare/kv';
 *
 * const flags = cloudflareKv('flags', { binding: 'FLAGS' });
 * getEnvBinding(flags)?.binding; // 'FLAGS'
 * ```
 */
export const getEnvBinding = (
  resourceDefinition: AnyResource
): EnvBindingSpec | undefined => envBindings.get(resourceDefinition);

const collectEnvBoundResources = (graph: Topo): readonly AnyResource[] => {
  const collected = new Map<string, AnyResource>();
  for (const graphTrail of graph.list()) {
    for (const declared of graphTrail.resources) {
      if (!collected.has(declared.id) && envBindings.has(declared)) {
        collected.set(declared.id, declared);
      }
    }
  }
  return [...collected.values()];
};

/**
 * Resolve every env-bound resource declared by the topo's trails into a
 * resource override map for one Worker env.
 *
 * Returns `Result.err` when a required binding is missing from the env or a
 * binding value fails the resource's narrowing check.
 *
 * @example
 * ```ts
 * import { buildEnvResourceOverrides } from '@ontrails/cloudflare/workers';
 *
 * const overrides = buildEnvResourceOverrides(graph, env);
 * if (overrides.isErr()) throw overrides.error;
 * ```
 */
export const buildEnvResourceOverrides = (
  graph: Topo,
  env: WorkersEnv
): Result<ResourceOverrideMap, Error> => {
  const overrides: Record<string, unknown> = {};
  for (const declared of collectEnvBoundResources(graph)) {
    const spec = envBindings.get(declared);
    if (spec === undefined) {
      continue;
    }
    const value = env[spec.binding];
    if (value === undefined) {
      return Result.err(
        new InternalError(
          `Worker env is missing binding "${spec.binding}" required by resource "${declared.id}". Declare the binding in your wrangler configuration (for example a kv_namespaces entry) or provide an explicit resource override.`,
          { context: { binding: spec.binding, resourceId: declared.id } }
        )
      );
    }
    const instance = spec.fromEnv(value);
    if (instance.isErr()) {
      return instance;
    }
    overrides[declared.id] = instance.value;
  }
  return Result.ok(overrides);
};
