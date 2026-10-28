import { ValidationError, matchWebhookPath } from '@ontrails/core';
import type {
  BaseSurfaceOptions,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';
import { deriveHttpRoutes } from '@ontrails/http';

import type { WorkersEnv } from '../env.js';
import { workersHostConfigSchema } from './host.js';
import type { WorkersHostConfig } from './host.js';

/** Shared env-resolved inputs; per-request auth remains inside the MCP handler. */
export interface WorkersMcpContext extends BaseSurfaceOptions {
  readonly resources: ResourceOverrideMap;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
}

/** Structural Web Fetch boundary; no MCP SDK or Worker env type is required. */
export type WorkersMcpHandler = (request: Request) => Promise<Response>;

/**
 * Materialize one handler per env identity using the shared resource bridge.
 * Keep request-specific credential and permit decisions inside the returned
 * handler; this factory can be reused for multiple requests on the same env.
 */
export type WorkersMcpFactory = (
  context: WorkersMcpContext
) => WorkersMcpHandler;

interface McpSetup extends BaseSurfaceOptions {
  readonly host?: WorkersHostConfig | undefined;
  readonly mcp?: WorkersMcpFactory | undefined;
  readonly basePath?: string | undefined;
  readonly createContext?: WorkersMcpContext['createContext'];
}

const rejectHttpCollision = (
  graph: Topo,
  path: string,
  options: McpSetup
): void => {
  const routes = deriveHttpRoutes(graph, {
    basePath: options.basePath,
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
    validate: options.validate,
  });
  if (routes.isErr()) {
    throw routes.error;
  }
  const collision = routes.value.find(
    (route) => matchWebhookPath(route.path, path) !== undefined
  );
  if (collision !== undefined) {
    throw new ValidationError(
      `MCP path "${path}" collides with HTTP trail "${collision.trailId}"`,
      {
        context: { method: collision.method, path, trailId: collision.trailId },
      }
    );
  }
};

/** Worker-only routing/materialization; protocol behavior belongs to the factory. */
export const createWorkersMcpHost = (
  graph: Topo,
  options: McpSetup,
  resolveResources: (env: WorkersEnv | undefined) => ResourceOverrideMap
):
  | {
      readonly path: string;
      readonly handlerFor: (env: WorkersEnv | undefined) => WorkersMcpHandler;
    }
  | undefined => {
  const parsed = workersHostConfigSchema.safeParse(options.host ?? {});
  if (!parsed.success) {
    throw new ValidationError('Invalid Worker host configuration', {
      cause: parsed.error,
    });
  }
  const endpoint = parsed.data.mcp;
  const factory = options.mcp;
  if (factory !== undefined && typeof factory !== 'function') {
    throw new ValidationError('MCP handler factory must be a function');
  }
  if ((endpoint === undefined) !== (factory === undefined)) {
    throw new ValidationError(
      'MCP host path and handler factory must be configured together'
    );
  }
  if (endpoint === undefined || factory === undefined) {
    return undefined;
  }
  rejectHttpCollision(graph, endpoint.path, options);
  let materialized:
    | {
        readonly env: WorkersEnv | undefined;
        readonly handle: WorkersMcpHandler;
      }
    | undefined;
  return {
    handlerFor: (env) => {
      if (materialized !== undefined && materialized.env === env) {
        return materialized.handle;
      }
      const handle = factory({
        configValues: options.configValues,
        createContext: options.createContext,
        exclude: options.exclude,
        include: options.include,
        intent: options.intent,
        resources: resolveResources(env),
        validate: options.validate,
      });
      materialized = { env, handle };
      return handle;
    },
    path: endpoint.path,
  };
};
