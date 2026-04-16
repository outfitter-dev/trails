import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

export interface FetchSurface {
  fetch(request: Request): Response | Promise<Response>;
}

export type ViteMiddlewareNext = (error?: unknown) => void;

export type ViteMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: ViteMiddlewareNext
) => void | Promise<void>;

type CookieReadableHeaders = Headers & {
  readonly getAll?: (name: string) => string[];
  readonly getSetCookie?: () => string[];
};

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

const appendHeader = (
  headers: Headers,
  name: string,
  value: string | readonly string[]
): void => {
  if (typeof value === 'string') {
    headers.append(name, value);
    return;
  }

  for (const item of value) {
    headers.append(name, item);
  }
};

const toRequestHeaders = (req: IncomingMessage): Headers => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }

    appendHeader(headers, name, value);
  }

  return headers;
};

const toRequestInit = (
  req: IncomingMessage
): RequestInit & { duplex?: 'half' } => {
  const method = req.method ?? 'GET';
  const headers = toRequestHeaders(req);

  if (BODYLESS_METHODS.has(method)) {
    return { headers, method };
  }

  return {
    body: Readable.toWeb(req) as unknown as BodyInit,
    duplex: 'half',
    headers,
    method,
  };
};

const toRequest = (req: IncomingMessage): Request => {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  return new Request(url, toRequestInit(req));
};

const readSetCookieHeaders = (headers: Headers): readonly string[] => {
  const cookieHeaders = headers as CookieReadableHeaders;
  if (typeof cookieHeaders.getSetCookie === 'function') {
    return cookieHeaders.getSetCookie();
  }
  if (typeof cookieHeaders.getAll === 'function') {
    return cookieHeaders.getAll('set-cookie');
  }

  const value = headers.get('set-cookie');
  return value === null ? [] : [value];
};

const writeHeaders = (response: Response, res: ServerResponse): void => {
  const setCookie = readSetCookieHeaders(response.headers);
  if (setCookie.length > 0) {
    res.setHeader('set-cookie', [...setCookie]);
  }

  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === 'set-cookie') {
      continue;
    }
    res.setHeader(name, value);
  }
};

const writeResponse = async (
  req: IncomingMessage,
  res: ServerResponse,
  response: Response
): Promise<void> => {
  res.statusCode = response.status;
  if (response.statusText.length > 0) {
    res.statusMessage = response.statusText;
  }
  writeHeaders(response, res);

  if (req.method === 'HEAD' || response.body === null) {
    res.end();
    return;
  }

  const body = Readable.fromWeb(
    response.body as unknown as NodeReadableStream<Uint8Array>
  );
  body.pipe(res);
  await finished(res);
};

/**
 * Convert a fetch-based HTTP surface into Vite/Connect middleware.
 *
 * Mount it under the path segment that should resolve through Trails:
 *
 * `server.middlewares.use('/api', vite(createApp(graph)))`
 */
export const vite =
  (app: FetchSurface): ViteMiddleware =>
  async (req, res, next) => {
    try {
      const response = await app.fetch(toRequest(req));
      await writeResponse(req, res, response);
    } catch (error: unknown) {
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Connect middleware reports errors through next(error)
      next(error);
    }
  };
