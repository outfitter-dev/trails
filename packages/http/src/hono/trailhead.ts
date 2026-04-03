/**
 * Hono connector for Trails HTTP routes.
 *
 * Takes framework-agnostic HttpRouteDefinition[] and wires them into a
 * Hono application, handling request parsing, response mapping, and errors.
 *
 * ```ts
 * const app = topo("myapp", entity);
 * await trailhead(app, { port: 3000 });
 * ```
 */

import { isTrailsError, statusCodeMap, validateTopo } from '@ontrails/core';
import type {
  Gate,
  ProvisionOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';
import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

import type { HttpMethod, HttpRouteDefinition } from '../build.js';
import { buildHttpRoutes } from '../build.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface TrailheadHttpOptions {
  readonly basePath?: string | undefined;
  /** Config values for provisions that declare a `config` schema, keyed by provision ID. */
  readonly configValues?:
    | Readonly<Record<string, Record<string, unknown>>>
    | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly hostname?: string | undefined;
  readonly gates?: readonly Gate[] | undefined;
  readonly name?: string | undefined;
  readonly port?: number | undefined;
  readonly provisions?: ProvisionOverrideMap | undefined;
  /** Set false to return the Hono app without starting a server. */
  readonly serve?: boolean | undefined;
  /** Set to `false` to skip topo validation at startup. Defaults to `true`. */
  readonly validate?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

/**
 * Build a set of field names that the input schema expects as arrays.
 *
 * Inspects the Zod v4 `_zod.def` internals to find top-level array fields.
 * Returns an empty set when the schema is not an object or cannot be inspected.
 */
interface ZodDef {
  _zod: { def: Record<string, unknown> };
}

/** Unwrap optional/default wrappers to reach the underlying Zod type name. */
const unwrapZodType = (node: ZodDef): string => {
  let current = node;
  while (
    (current._zod.def['type'] as string) === 'optional' ||
    (current._zod.def['type'] as string) === 'default'
  ) {
    current = current._zod.def['innerType'] as ZodDef;
  }
  return current._zod.def['type'] as string;
};

/** Extract the object shape from a Zod schema, or undefined if not an object. */
const extractShape = (
  schema: z.ZodType
): Record<string, ZodDef> | undefined => {
  const s = schema as unknown as ZodDef;
  if ((s._zod.def['type'] as string) !== 'object') {
    return undefined;
  }
  return s._zod.def['shape'] as Record<string, ZodDef> | undefined;
};

/** Collect top-level field names whose underlying type is array. */
const collectArrayKeys = (
  inputSchema: z.ZodType | undefined
): ReadonlySet<string> => {
  const shape = inputSchema ? extractShape(inputSchema) : undefined;
  if (!shape) {
    return new Set();
  }
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(shape)) {
    if (unwrapZodType(value) === 'array') {
      keys.add(key);
    }
  }
  return keys;
};

/** Parse query params into a plain object, preserving raw strings for Zod. */
const parseQueryParams = (
  c: HonoContext,
  inputSchema?: z.ZodType | undefined
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  const url = new URL(c.req.url);
  const arrayKeys = collectArrayKeys(inputSchema);

  for (const key of url.searchParams.keys()) {
    // Already collected via getAll
    if (key in result) {
      continue;
    }
    const all = url.searchParams.getAll(key);
    result[key] = all.length > 1 || arrayKeys.has(key) ? all : all[0];
  }

  return result;
};

/** Sentinel indicating a JSON parse failure. */
const JSON_PARSE_ERROR = Symbol('JSON_PARSE_ERROR');

/** Return true when the request has no body content. */
const isEmptyBody = (c: HonoContext): boolean => {
  const contentLength = c.req.header('Content-Length');
  if (contentLength !== undefined) {
    return Number.parseInt(contentLength, 10) === 0;
  }
  // No Content-Length header — treat as empty when Content-Type is also absent.
  return c.req.header('Content-Type') === undefined;
};

/** Read input from request based on input source. */
const readInput = async (
  c: HonoContext,
  inputSource: 'query' | 'body',
  inputSchema?: z.ZodType | undefined
): Promise<unknown> => {
  if (inputSource === 'query') {
    return parseQueryParams(c, inputSchema);
  }
  if (isEmptyBody(c)) {
    return {};
  }
  try {
    return await c.req.json();
  } catch {
    return JSON_PARSE_ERROR;
  }
};

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

/** Map a TrailsError or generic Error to an HTTP error response. */
const mapErrorResponse = (
  error: Error
): { body: Record<string, unknown>; status: ContentfulStatusCode } => {
  if (isTrailsError(error)) {
    return {
      body: {
        error: {
          category: error.category,
          code: error.name,
          message: error.message,
        },
      },
      status: statusCodeMap[error.category] as ContentfulStatusCode,
    };
  }
  return {
    body: {
      error: {
        category: 'internal',
        code: 'InternalError',
        message: error.message,
      },
    },
    status: 500,
  };
};

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/** Map a Result to an HTTP response via Hono context. */
const mapResultToResponse = (
  result: { isOk(): boolean; value?: unknown; error?: Error },
  c: HonoContext
): Response => {
  if (result.isOk()) {
    return c.json({ data: result.value }, 200);
  }
  const { body, status } = mapErrorResponse(
    result.error ?? new Error('Unknown error')
  );
  return c.json(body, status);
};

/** Convert a caught unknown value to an error response. */
const handleCaughtError = (error: unknown, c: HonoContext): Response => {
  const err = error instanceof Error ? error : new Error(String(error));
  const { body, status } = mapErrorResponse(err);
  return c.json(body, status);
};

/** Create a Hono handler from a route definition. */
const createHonoHandler =
  (route: HttpRouteDefinition) =>
  async (c: HonoContext): Promise<Response> => {
    const rawInput = await readInput(c, route.inputSource, route.trail.input);

    if (rawInput === JSON_PARSE_ERROR) {
      return c.json(
        {
          error: {
            category: 'validation',
            code: 'ValidationError',
            message: 'Invalid JSON in request body',
          },
        },
        400
      );
    }

    const requestId = c.req.header('X-Request-ID') ?? undefined;
    const { signal: abortSignal } = c.req.raw;

    try {
      const result = await route.execute(rawInput, requestId, abortSignal);
      return mapResultToResponse(result, c);
    } catch (error: unknown) {
      return handleCaughtError(error, c);
    }
  };

/** Route registration keyed by HTTP method. */
const routeRegistrars: Record<
  HttpMethod,
  (
    hono: Hono,
    path: string,
    handler: (c: HonoContext) => Promise<Response>
  ) => void
> = {
  DELETE: (hono, path, handler) => {
    hono.delete(path, handler);
  },
  GET: (hono, path, handler) => {
    hono.get(path, handler);
  },
  POST: (hono, path, handler) => {
    hono.post(path, handler);
  },
};

const registerRoutes = (hono: Hono, routes: HttpRouteDefinition[]): void => {
  for (const route of routes) {
    const handler = createHonoHandler(route);
    routeRegistrars[route.method](hono, route.path, handler);
  }
};

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

const registerErrorHandler = (hono: Hono): void => {
  // oxlint-disable-next-line prefer-await-to-callbacks -- Hono's onError API requires a callback
  hono.onError((err, c) =>
    c.json(
      {
        error: {
          category: 'internal',
          code: 'InternalError',
          message: err.message,
        },
      },
      500
    )
  );
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Throw a ValidationError if the topo has structural issues.
 * Pass `skip: true` to bypass validation (e.g. when `validate: false` is set).
 */
const assertValidTopo = (app: Topo, skip = false): void => {
  if (skip) {
    return;
  }
  const validated = validateTopo(app);
  if (validated.isErr()) {
    throw validated.error;
  }
};

// ---------------------------------------------------------------------------
// trailhead
// ---------------------------------------------------------------------------

/**
 * Build HTTP routes from a topo, create a Hono app, and optionally start serving.
 *
 * Validation is handled by `buildHttpRoutes` — pass `validate: false`
 * to skip it (e.g. during hot-reload or progressive startup).
 */
// oxlint-disable-next-line require-await -- async for consistency with other trailhead() entrypoints
export const trailhead = async (
  app: Topo,
  options: TrailheadHttpOptions = {}
): Promise<Hono> => {
  const hono = new Hono();

  registerErrorHandler(hono);

  const routesResult = buildHttpRoutes(app, {
    basePath: options.basePath,
    configValues: options.configValues,
    createContext: options.createContext,
    gates: options.gates,
    provisions: options.provisions,
  });

  if (routesResult.isErr()) {
    throw routesResult.error;
  }

  registerRoutes(hono, routesResult.value);

  if (options.serve !== false) {
    Bun.serve({
      fetch: hono.fetch,
      hostname: options.hostname ?? '0.0.0.0',
      port: options.port ?? 3000,
    });
  }

  return hono;
};
