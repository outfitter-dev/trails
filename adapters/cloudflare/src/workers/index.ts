/**
 * Cloudflare Workers materializer for Trails HTTP routes.
 *
 * Produces the `{ fetch(request, env, ctx) }` Worker export by delegating to
 * the shared HTTP fetch kernel (`createFetchHandler` from `@ontrails/http`),
 * making Workers the kernel's third consumer after Bun and Hono.
 *
 * The env bridge: bindings arrive per-request on `env`, so the kernel handler
 * is materialized per env identity — a request carrying a new `env` object
 * re-resolves every env-bound resource before it executes. Resource overrides
 * are checked before core's singleton resource cache, so no resource instance
 * can serve a request with a stale env.
 */

import {
  projectErrorDiagnostics,
  projectPublicSurfaceError,
} from '@ontrails/core';
import type {
  BaseSurfaceOptions,
  Layer,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';
import { createFetchHandler } from '@ontrails/http';
import type { ResolveHttpPermit } from '@ontrails/http';

import { buildEnvResourceOverrides } from '../env.js';
import type { WorkersEnv } from '../env.js';
import { createQueueHandler } from '../queues/index.js';
import type { CloudflareQueueBatch } from '../queues/index.js';

export {
  buildEnvResourceOverrides,
  getEnvBinding,
  registerEnvBinding,
} from '../env.js';
export type {
  BuildEnvResourceOverridesOptions,
  EnvBindingSpec,
  WorkersEnv,
} from '../env.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Resource overrides for the Workers surface.
 *
 * A static map is applied as-is. A function receives the per-request Worker
 * env and is re-invoked whenever a new env object arrives, so overrides that
 * read bindings stay as fresh as the env bridge itself.
 */
export type WorkersResourceOverrides =
  | ResourceOverrideMap
  | ((env: WorkersEnv) => ResourceOverrideMap);

/**
 * Options for building a Trails Worker handler.
 */
export interface CreateWorkersHandlerOptions extends BaseSurfaceOptions {
  readonly basePath?: string | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly layers?: readonly Layer[] | undefined;
  /** Maximum JSON request body size in bytes. Defaults to 1 MiB. */
  readonly maxJsonBodyBytes?: number | undefined;
  readonly resolvePermit?: ResolveHttpPermit | undefined;
  readonly resources?: WorkersResourceOverrides | undefined;
}

/**
 * The `ExecutionContext` shape the Workers runtime passes as the third
 * `fetch` argument. Declared structurally so the adapter does not require
 * `@cloudflare/workers-types` at runtime.
 */
export interface WorkersExecutionContext {
  passThroughOnException(): void;
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * The Worker module export produced by {@link createWorkersHandler}.
 */
export interface CloudflareWorker {
  fetch(
    request: Request,
    env?: WorkersEnv | undefined,
    executionCtx?: WorkersExecutionContext | undefined
  ): Promise<Response>;
  queue(
    batch: CloudflareQueueBatch,
    env?: WorkersEnv | undefined,
    executionCtx?: WorkersExecutionContext | undefined
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * Map a materialization failure (route derivation, env bridge resolution) to
 * a projected HTTP error response. Route execution errors never reach this
 * path — the fetch kernel maps those itself.
 */
const mapCaughtError = (error: unknown): Response => {
  const err = error instanceof Error ? error : new Error(String(error));
  // Materialization failures are host bootstrap problems; surface their
  // diagnostics to the Worker log while the response stays redacted.
  console.error(
    '[ontrails:cloudflare/workers] Failed to materialize request handler',
    projectErrorDiagnostics(err)
  );
  const projection = projectPublicSurfaceError('http', err);
  return Response.json(
    {
      error: {
        category: projection.category,
        code: projection.name,
        message: projection.message,
      },
    },
    { status: projection.code }
  );
};

const mapCaughtQueueError = (
  error: unknown,
  batch: CloudflareQueueBatch
): void => {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(
    '[ontrails:cloudflare/workers] Failed to materialize queue handler',
    projectErrorDiagnostics(err)
  );
  batch.retryAll();
};

// ---------------------------------------------------------------------------
// createWorkersHandler
// ---------------------------------------------------------------------------

const resolveResourceOverrides = (
  graph: Topo,
  env: WorkersEnv,
  options: CreateWorkersHandlerOptions,
  entrypoint: 'fetch' | 'queue',
  queueName?: string
): ResourceOverrideMap => {
  // Explicit overrides are the documented escape hatch, so they resolve
  // first: an overridden resource never requires its env binding. Surface
  // filters are forwarded so trails the handler does not expose never
  // require theirs either.
  const userOverrides =
    typeof options.resources === 'function'
      ? options.resources(env)
      : (options.resources ?? {});
  const envOverrides = buildEnvResourceOverrides(graph, env, {
    entrypoint,
    except: Object.keys(userOverrides),
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
    queue: queueName,
  });
  if (envOverrides.isErr()) {
    throw envOverrides.error;
  }
  return { ...envOverrides.value, ...userOverrides };
};

interface MaterializedHandler {
  readonly env: WorkersEnv | undefined;
  readonly handle: (request: Request) => Promise<Response>;
}

interface MaterializedQueueHandler {
  readonly env: WorkersEnv | undefined;
  readonly handle: (batch: CloudflareQueueBatch) => Promise<void>;
  readonly queue: string;
}

/**
 * Build the `{ fetch }` Worker export for a topo.
 *
 * @remarks The kernel fetch handler is materialized lazily per env identity.
 * The Workers runtime keeps `env` stable within an isolate, so steady-state
 * requests reuse one materialization; any request carrying a different env
 * object triggers a fresh resolution of every env-bound resource.
 *
 * @example
 * ```ts
 * import { createWorkersHandler } from '@ontrails/cloudflare/workers';
 * import { graph } from './app.js';
 *
 * export default createWorkersHandler(graph, { basePath: '/api' });
 * ```
 */
export const createWorkersHandler = (
  graph: Topo,
  options: CreateWorkersHandlerOptions = {}
): CloudflareWorker => {
  let materialized: MaterializedHandler | undefined;
  let materializedQueue: MaterializedQueueHandler | undefined;

  const handlerFor = (
    env: WorkersEnv | undefined
  ): ((request: Request) => Promise<Response>) => {
    if (materialized !== undefined && materialized.env === env) {
      return materialized.handle;
    }
    const handle = createFetchHandler(graph, {
      basePath: options.basePath,
      configValues: options.configValues,
      createContext: options.createContext,
      exclude: options.exclude,
      include: options.include,
      intent: options.intent,
      layers: options.layers,
      maxJsonBodyBytes: options.maxJsonBodyBytes,
      resolvePermit: options.resolvePermit,
      resources: resolveResourceOverrides(graph, env ?? {}, options, 'fetch'),
      validate: options.validate,
    });
    materialized = { env, handle };
    return handle;
  };

  const queueHandlerFor = (
    env: WorkersEnv | undefined,
    queueName: string
  ): ((batch: CloudflareQueueBatch) => Promise<void>) => {
    if (
      materializedQueue !== undefined &&
      materializedQueue.env === env &&
      materializedQueue.queue === queueName
    ) {
      return materializedQueue.handle;
    }
    const handle = createQueueHandler(graph, {
      configValues: options.configValues,
      createContext: options.createContext,
      exclude: options.exclude,
      include: options.include,
      intent: options.intent,
      layers: options.layers,
      resources: resolveResourceOverrides(
        graph,
        env ?? {},
        options,
        'queue',
        queueName
      ),
      validate: options.validate,
    });
    materializedQueue = { env, handle, queue: queueName };
    return handle;
  };

  return {
    fetch: async (request, env, _executionCtx) => {
      try {
        return await handlerFor(env)(request);
      } catch (error: unknown) {
        return mapCaughtError(error);
      }
    },
    queue: async (batch, env, _executionCtx) => {
      try {
        await queueHandlerFor(env, batch.queue)(batch);
      } catch (error: unknown) {
        mapCaughtQueueError(error, batch);
      }
    },
  };
};
