/**
 * Hono connector for Trails HTTP routes.
 *
 * Takes framework-agnostic HttpRouteDefinition[] and wires them into a
 * Hono application, handling request parsing, response mapping, and errors.
 *
 * ```ts
 * const graph = topo("myapp", entity);
 * await surface(graph, { port: 3000 });
 * ```
 */

import {
  isTrailsError,
  mapTransportError,
  ValidationError,
} from '@ontrails/core';
import type {
  Intent,
  Layer,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';
import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { deriveHttpRoutes } from '@ontrails/http';
import type { HttpMethod, HttpRouteDefinition } from '@ontrails/http';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateAppOptions {
  readonly basePath?: string | undefined;
  /** Config values for resources that declare a `config` schema, keyed by resource ID. */
  readonly configValues?:
    | Readonly<Record<string, Record<string, unknown>>>
    | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly exclude?: readonly string[] | undefined;
  readonly hostname?: string | undefined;
  readonly include?: readonly string[] | undefined;
  readonly intent?: readonly Intent[] | undefined;
  readonly layers?: readonly Layer[] | undefined;
  /** Maximum JSON request body size in bytes. Defaults to 1 MiB. */
  readonly maxJsonBodyBytes?: number | undefined;
  readonly name?: string | undefined;
  readonly port?: number | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  /** Set to `false` to skip topo validation at startup. Defaults to `true`. */
  readonly validate?: boolean | undefined;
}

interface RuntimeOptions {
  readonly maxJsonBodyBytes: number;
}

const DEFAULT_MAX_JSON_BODY_BYTES = 1024 * 1024;

export interface SurfaceHttpResult {
  readonly close: () => Promise<void>;
  readonly url: string;
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

/**
 * Parse query params into a plain object, preserving scalar-vs-array shape.
 *
 * A single `?tag=one` stays a scalar string, while repeated keys like
 * `?tag=one&tag=two` become arrays. Schema validation owns whether that shape
 * is accepted; the connector does not coerce singleton values into arrays.
 */
const parseQueryParams = (c: HonoContext): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  const url = new URL(c.req.url);
  const seenKeys = new Set<string>();

  for (const key of url.searchParams.keys()) {
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    const all = url.searchParams.getAll(key);
    result[key] = all.length > 1 ? all : all[0];
  }

  return result;
};

/** Sentinel indicating a JSON parse failure. */
const JSON_PARSE_ERROR = Symbol('JSON_PARSE_ERROR');

/** Sentinel indicating a JSON body rejected before parsing. */
const JSON_BODY_TOO_LARGE = Symbol('JSON_BODY_TOO_LARGE');

/** Sentinel indicating malformed body metadata. */
const JSON_BODY_INVALID_CONTENT_LENGTH = Symbol(
  'JSON_BODY_INVALID_CONTENT_LENGTH'
);

interface JsonObject {
  readonly [key: string]: JsonValue;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | JsonObject;
type JsonBodyReadResult =
  | JsonValue
  | typeof JSON_BODY_INVALID_CONTENT_LENGTH
  | typeof JSON_PARSE_ERROR
  | typeof JSON_BODY_TOO_LARGE;
type JsonBodyTextReadResult = string | typeof JSON_BODY_TOO_LARGE;
type InputReadResult = Record<string, unknown> | JsonBodyReadResult;

const CONTENT_LENGTH_DECIMAL_PATTERN = /^\d+$/;

/** Return true when the request has no body content. */
type ParsedContentLength =
  | number
  | typeof JSON_BODY_INVALID_CONTENT_LENGTH
  | undefined;

const parseContentLength = (
  contentLength: string | undefined
): ParsedContentLength => {
  if (contentLength === undefined) {
    return undefined;
  }
  if (!CONTENT_LENGTH_DECIMAL_PATTERN.test(contentLength)) {
    return JSON_BODY_INVALID_CONTENT_LENGTH;
  }
  const size = Number(contentLength);
  return Number.isSafeInteger(size) ? size : Number.MAX_SAFE_INTEGER;
};

const isEmptyBody = (c: HonoContext): boolean => {
  const contentLength = parseContentLength(c.req.header('Content-Length'));
  if (contentLength === JSON_BODY_INVALID_CONTENT_LENGTH) {
    return false;
  }
  if (contentLength !== undefined) {
    return contentLength === 0;
  }
  // No Content-Length header — treat as empty when Content-Type is also absent.
  return c.req.header('Content-Type') === undefined;
};

const resolveMaxJsonBodyBytes = (value: number | undefined): number => {
  const maxJsonBodyBytes = value ?? DEFAULT_MAX_JSON_BODY_BYTES;

  if (!Number.isFinite(maxJsonBodyBytes) || maxJsonBodyBytes < 1) {
    throw new ValidationError(
      'maxJsonBodyBytes must be a positive finite number'
    );
  }

  return maxJsonBodyBytes;
};

const hasOversizedContentLength = (
  c: HonoContext,
  maxJsonBodyBytes: number
): boolean => {
  const contentLength = c.req.header('Content-Length');
  if (contentLength === undefined) {
    return false;
  }
  const size = parseContentLength(contentLength);
  if (size === JSON_BODY_INVALID_CONTENT_LENGTH) {
    return false;
  }
  return size !== undefined && size > maxJsonBodyBytes;
};

const measureBodyTextBytes = (text: string): number => new Blob([text]).size;

const validateCachedBodyText = (
  text: string,
  maxJsonBodyBytes: number
): JsonBodyTextReadResult =>
  measureBodyTextBytes(text) > maxJsonBodyBytes ? JSON_BODY_TOO_LARGE : text;

const readCachedBodyText = async (
  c: HonoContext,
  maxJsonBodyBytes: number
): Promise<JsonBodyTextReadResult> =>
  validateCachedBodyText(await c.req.text(), maxJsonBodyBytes);

const readBodyText = async (
  c: HonoContext,
  maxJsonBodyBytes: number
): Promise<string | typeof JSON_BODY_TOO_LARGE> => {
  if (c.req.raw.bodyUsed) {
    return await readCachedBodyText(c, maxJsonBodyBytes);
  }

  const { body } = c.req.raw;
  if (body === null) {
    return '';
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxJsonBodyBytes) {
        await reader.cancel();
        return JSON_BODY_TOO_LARGE;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
};

const readJsonBody = async (
  c: HonoContext,
  maxJsonBodyBytes: number
): Promise<JsonBodyReadResult> => {
  if (
    parseContentLength(c.req.header('Content-Length')) ===
    JSON_BODY_INVALID_CONTENT_LENGTH
  ) {
    return JSON_BODY_INVALID_CONTENT_LENGTH;
  }

  if (hasOversizedContentLength(c, maxJsonBodyBytes)) {
    return JSON_BODY_TOO_LARGE;
  }

  const text = await readBodyText(c, maxJsonBodyBytes);
  if (text === JSON_BODY_TOO_LARGE) {
    return JSON_BODY_TOO_LARGE;
  }

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return JSON_PARSE_ERROR;
  }
};

/** Read input from request based on input source. */
const readInput = async (
  c: HonoContext,
  inputSource: 'query' | 'body',
  options: RuntimeOptions
): Promise<InputReadResult> => {
  if (inputSource === 'query') {
    return parseQueryParams(c);
  }
  if (isEmptyBody(c)) {
    return {};
  }
  return await readJsonBody(c, options.maxJsonBodyBytes);
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
      status: mapTransportError('http', error) as ContentfulStatusCode,
    };
  }
  return {
    body: {
      error: {
        category: 'internal',
        code: 'InternalError',
        message: 'Internal server error',
      },
    },
    status: 500,
  };
};

const LOG_UNSAFE_LABEL_CHARACTERS = /[^\w:.-]/g;
const MAX_DIAGNOSTIC_LABEL_VALUE_LENGTH = 128;

const sanitizeDiagnosticLabelValue = (value: string): string =>
  value
    .replace(LOG_UNSAFE_LABEL_CHARACTERS, '_')
    .slice(0, MAX_DIAGNOSTIC_LABEL_VALUE_LENGTH);

const reportInternalDiagnostics = (error: Error, c: HonoContext): void => {
  if (isTrailsError(error)) {
    return;
  }

  const requestId = c.req.header('X-Request-ID');
  const safeRequestId =
    requestId === undefined
      ? undefined
      : sanitizeDiagnosticLabelValue(requestId);
  const label =
    safeRequestId === undefined
      ? '[ontrails:hono] Internal error'
      : `[ontrails:hono] Internal error (${safeRequestId})`;
  console.error(label, error);
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
  const error = result.error ?? new Error('Unknown error');
  reportInternalDiagnostics(error, c);
  const { body, status } = mapErrorResponse(error);
  return c.json(body, status);
};

/** Convert a caught unknown value to an error response. */
const handleCaughtError = (error: unknown, c: HonoContext): Response => {
  const err = error instanceof Error ? error : new Error(String(error));
  reportInternalDiagnostics(err, c);
  const { body, status } = mapErrorResponse(err);
  return c.json(body, status);
};

/** Create a Hono handler from a route definition. */
const createHonoHandler =
  (route: HttpRouteDefinition, options: RuntimeOptions) =>
  async (c: HonoContext): Promise<Response> => {
    const rawInput = await readInput(c, route.inputSource, options);

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

    if (rawInput === JSON_BODY_INVALID_CONTENT_LENGTH) {
      return c.json(
        {
          error: {
            category: 'validation',
            code: 'ValidationError',
            message: 'Invalid Content-Length header',
          },
        },
        400
      );
    }

    if (rawInput === JSON_BODY_TOO_LARGE) {
      return c.json(
        {
          error: {
            category: 'validation',
            code: 'ValidationError',
            message: `JSON request body exceeds ${options.maxJsonBodyBytes} bytes`,
          },
        },
        413
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

const registerRoutes = (
  hono: Hono,
  routes: HttpRouteDefinition[],
  options: RuntimeOptions
): void => {
  for (const route of routes) {
    const handler = createHonoHandler(route, options);
    routeRegistrars[route.method](hono, route.path, handler);
  }
};

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

const registerErrorHandler = (hono: Hono): void => {
  // oxlint-disable-next-line prefer-await-to-callbacks -- Hono's onError API requires a callback
  hono.onError((err, c) => handleCaughtError(err, c));
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// createApp
// ---------------------------------------------------------------------------

/**
 * Build HTTP routes from a topo and register them on a Hono app.
 */
export const createApp = (
  graph: Topo,
  options: CreateAppOptions = {}
): Hono => {
  const hono = new Hono();
  const runtimeOptions = {
    maxJsonBodyBytes: resolveMaxJsonBodyBytes(options.maxJsonBodyBytes),
  };

  registerErrorHandler(hono);

  const routesResult = deriveHttpRoutes(graph, {
    basePath: options.basePath,
    configValues: options.configValues,
    createContext: options.createContext,
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
    layers: options.layers,
    resources: options.resources,
    validate: options.validate,
  });

  if (routesResult.isErr()) {
    throw routesResult.error;
  }

  registerRoutes(hono, routesResult.value, runtimeOptions);
  return hono;
};

const startServer = (
  hono: Hono,
  options: CreateAppOptions
): SurfaceHttpResult => {
  const server = Bun.serve({
    fetch: hono.fetch,
    hostname: options.hostname ?? '0.0.0.0',
    port: options.port ?? 3000,
  });

  return {
    close: async () => {
      await server.stop(true);
    },
    url: String(server.url),
  };
};

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------

/**
 * Build a Hono app from a topo and start serving it with Bun.
 *
 * @remarks Always starts a Bun server. Use `createApp(graph)` for an
 * unserved Hono app that you can wire into your own server.
 */
export const surface = async (
  graph: Topo,
  options: CreateAppOptions = {}
): Promise<SurfaceHttpResult> => {
  // oxlint-disable-next-line require-await -- async ensures createApp() throws become rejected promises, not uncaught exceptions
  const hono = createApp(graph, options);
  return startServer(hono, options);
};
