/**
 * Cloudflare KV resource for Trails.
 *
 * `cloudflareKv` authors an ordinary `resource()` definition wrapping a KV
 * namespace binding. On Workers, the env bridge (see `../env.ts`) resolves
 * the binding per env so trails read live KV through `flags.from(ctx)`. In
 * tests, the in-memory mock keeps `testAll(app)` configuration-free.
 */

import { InternalError, Result, resource } from '@ontrails/core';
import type { Resource } from '@ontrails/core';

import { registerEnvBinding } from '../env.js';

// ---------------------------------------------------------------------------
// Client shape
// ---------------------------------------------------------------------------

/** Options accepted by {@link CloudflareKv.put}. */
export interface CloudflareKvPutOptions {
  /** Absolute expiration as a Unix timestamp in seconds. */
  readonly expiration?: number | undefined;
  /** Relative expiration in seconds from now. Wins over `expiration`. */
  readonly expirationTtl?: number | undefined;
}

/** Options accepted by {@link CloudflareKv.list}. */
export interface CloudflareKvListOptions {
  /** Opaque cursor from a previous page's result. */
  readonly cursor?: string | undefined;
  /** Maximum keys per page. Defaults to 1000, matching the KV binding. */
  readonly limit?: number | undefined;
  /** Restrict results to keys starting with this prefix. */
  readonly prefix?: string | undefined;
}

/** One key entry in a {@link CloudflareKvListResult}. */
export interface CloudflareKvListKey {
  /** Absolute expiration as a Unix timestamp in seconds, when set. */
  readonly expiration?: number | undefined;
  readonly name: string;
}

/** Result shape of {@link CloudflareKv.list}, matching the KV binding. */
export interface CloudflareKvListResult {
  readonly cursor?: string | undefined;
  readonly keys: readonly CloudflareKvListKey[];
  readonly list_complete: boolean;
}

/**
 * The KV surface trails consume. A real `KVNamespace` binding satisfies this
 * shape structurally, so the env bridge passes bindings through unchanged.
 */
export interface CloudflareKv {
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  list(options?: CloudflareKvListOptions): Promise<CloudflareKvListResult>;
  put(
    key: string,
    value: string,
    options?: CloudflareKvPutOptions
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory mock
// ---------------------------------------------------------------------------

/** Options for {@link createMemoryKv}. */
export interface CreateMemoryKvOptions {
  /** Clock override for TTL tests. Defaults to `Date.now`. */
  readonly now?: (() => number) | undefined;
}

interface MemoryKvEntry {
  readonly expiresAtMs: number | undefined;
  readonly value: string;
}

const DEFAULT_LIST_LIMIT = 1000;
const MS_PER_SECOND = 1000;

const isExpired = (entry: MemoryKvEntry, nowMs: number): boolean =>
  entry.expiresAtMs !== undefined && entry.expiresAtMs <= nowMs;

const resolveExpiresAtMs = (
  nowMs: number,
  options: CloudflareKvPutOptions | undefined
): number | undefined => {
  if (options?.expirationTtl !== undefined) {
    return nowMs + options.expirationTtl * MS_PER_SECOND;
  }
  if (options?.expiration !== undefined) {
    return options.expiration * MS_PER_SECOND;
  }
  return undefined;
};

/**
 * Create an in-memory {@link CloudflareKv} backed by a `Map`.
 *
 * This is the mock factory behind every `cloudflareKv` resource, exported for
 * direct use in tests. TTL semantics mirror the KV binding (lazy expiry,
 * seconds granularity) but the 60-second minimum TTL is intentionally not
 * enforced so tests can use short expirations.
 *
 * @example
 * ```ts
 * import { createMemoryKv } from '@ontrails/cloudflare/kv';
 *
 * const kv = createMemoryKv();
 * await kv.put('color', 'red', { expirationTtl: 60 });
 * await kv.get('color'); // 'red'
 * ```
 */
export const createMemoryKv = (
  options: CreateMemoryKvOptions = {}
): CloudflareKv => {
  const now = options.now ?? Date.now;
  const entries = new Map<string, MemoryKvEntry>();

  const liveEntry = (key: string): MemoryKvEntry | undefined => {
    const entry = entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (isExpired(entry, now())) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    delete: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(liveEntry(key)?.value ?? null),
    list: (listOptions) => {
      const limit = listOptions?.limit ?? DEFAULT_LIST_LIMIT;
      const prefix = listOptions?.prefix ?? '';
      const nowMs = now();
      const names = [...entries.keys()]
        .filter((name) => {
          const entry = entries.get(name);
          return (
            entry !== undefined &&
            !isExpired(entry, nowMs) &&
            name.startsWith(prefix)
          );
        })
        .toSorted();
      const startIndex =
        listOptions?.cursor === undefined
          ? 0
          : names.findIndex((name) => name > (listOptions.cursor ?? ''));
      const pageStart = startIndex === -1 ? names.length : startIndex;
      const page = names.slice(pageStart, pageStart + limit);
      const listComplete = pageStart + page.length >= names.length;
      const lastName = page.at(-1);
      return Promise.resolve({
        ...(listComplete || lastName === undefined ? {} : { cursor: lastName }),
        keys: page.map((name) => {
          const entry = entries.get(name);
          const expiresAtMs = entry?.expiresAtMs;
          return {
            ...(expiresAtMs === undefined
              ? {}
              : { expiration: Math.floor(expiresAtMs / MS_PER_SECOND) }),
            name,
          };
        }),
        list_complete: listComplete,
      });
    },
    put: (key, value, putOptions) => {
      entries.set(key, {
        expiresAtMs: resolveExpiresAtMs(now(), putOptions),
        value,
      });
      return Promise.resolve();
    },
  };
};

// ---------------------------------------------------------------------------
// Resource factory
// ---------------------------------------------------------------------------

/** Options for {@link cloudflareKv}. */
export interface CloudflareKvOptions {
  /** The wrangler binding name (a `kv_namespaces` entry's `binding`). */
  readonly binding: string;
  readonly description?: string | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

const isKvBinding = (value: unknown): value is CloudflareKv => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof CloudflareKv, unknown>>;
  return (
    typeof candidate.get === 'function' &&
    typeof candidate.put === 'function' &&
    typeof candidate.delete === 'function' &&
    typeof candidate.list === 'function'
  );
};

/**
 * Author a Trails resource wrapping a Cloudflare KV namespace binding.
 *
 * The instance arrives through the Workers env bridge — `create` refuses to
 * run outside a Worker because KV bindings only exist there. The in-memory
 * mock keeps `testAll(app)` configuration-free.
 *
 * @example
 * ```ts
 * import { cloudflareKv } from '@ontrails/cloudflare/kv';
 * import { trail, Result } from '@ontrails/core';
 * import { z } from 'zod';
 *
 * const flags = cloudflareKv('flags', { binding: 'FLAGS' });
 *
 * const showFlag = trail('flag.show', {
 *   implementation: async (input, ctx) => {
 *     const value = await flags.from(ctx).get(input.key);
 *     return Result.ok({ value });
 *   },
 *   input: z.object({ key: z.string() }),
 *   intent: 'read',
 *   output: z.object({ value: z.string().nullable() }),
 *   resources: [flags],
 * });
 * ```
 */
export const cloudflareKv = (
  id: string,
  options: CloudflareKvOptions
): Resource<CloudflareKv> => {
  const definition = resource<CloudflareKv>(id, {
    create: () =>
      Result.err(
        new InternalError(
          `Resource "${id}" wraps Cloudflare KV binding "${options.binding}", which only exists on a Workers env. Serve the topo with createWorkersHandler from @ontrails/cloudflare/workers, or rely on the in-memory mock in tests.`,
          { context: { binding: options.binding, resourceId: id } }
        )
      ),
    description:
      options.description ??
      `Cloudflare KV namespace bound to "${options.binding}"`,
    meta: {
      ...options.meta,
      'cloudflare.binding': options.binding,
      'cloudflare.service': 'kv',
    },
    mock: () => createMemoryKv(),
  });
  registerEnvBinding(definition, {
    binding: options.binding,
    fromEnv: (value) =>
      isKvBinding(value)
        ? Result.ok(value)
        : Result.err(
            new InternalError(
              `Worker env binding "${options.binding}" for resource "${id}" is not a KV namespace. Check the kv_namespaces entry in your wrangler configuration.`,
              { context: { binding: options.binding, resourceId: id } }
            )
          ),
  });
  return definition;
};
