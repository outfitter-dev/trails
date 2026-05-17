import { InternalError, Result, trail } from '@ontrails/core';
import type { Trail } from '@ontrails/core';
import { createRouteHandler } from '@ontrails/http';
import type { HttpRouteDefinition } from '@ontrails/http';
import { z } from 'zod';

const caughtErrors = new Map<string, Error>();
const caughtErrorInput = z.object({ errorId: z.string() });
const caughtErrorTrail = trail('__ontrails.hono.error', {
  blaze: () =>
    Result.err(new InternalError('Hono error fallback executed directly')),
  input: caughtErrorInput,
  intent: 'read',
  output: z.object({}),
}) as Trail<unknown, unknown, unknown>;

const caughtErrorRoute: HttpRouteDefinition = {
  execute: async (input) => {
    const parsed = caughtErrorInput.safeParse(input);
    if (!parsed.success) {
      return Result.err(
        new InternalError('Hono error fallback missing error id')
      );
    }
    const error =
      caughtErrors.get(parsed.data.errorId) ??
      new Error('Hono error fallback missing caught error');
    return Result.err(error);
  },
  inputSource: 'query',
  method: 'GET',
  path: '/__ontrails/hono/error',
  trail: caughtErrorTrail,
  trailId: '__ontrails.hono.error',
};
const caughtErrorHandler = createRouteHandler(caughtErrorRoute);

const materializeCaughtErrorRequest = (
  request: Request,
  errorId: string
): Request => {
  const url = new URL('/__ontrails/hono/error', request.url);
  url.searchParams.set('errorId', errorId);
  return new Request(url, {
    headers: request.headers,
    method: 'GET',
    signal: request.signal,
  });
};

export const handleCaughtHonoError = async (
  error: unknown,
  request: Request
): Promise<Response> => {
  const err = error instanceof Error ? error : new Error(String(error));
  const errorId = crypto.randomUUID();
  caughtErrors.set(errorId, err);
  try {
    return await caughtErrorHandler(
      materializeCaughtErrorRequest(request, errorId)
    );
  } finally {
    caughtErrors.delete(errorId);
  }
};
