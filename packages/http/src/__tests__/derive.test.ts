import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { deriveHttpRoutes } from '../build.js';

const unwrapOk = <T>(result: Result<T, Error>): T =>
  result.match({
    err: (error) => {
      throw error;
    },
    ok: (value) => value,
  });

describe('deriveHttpRoutes', () => {
  test('aliases the HTTP projection API', () => {
    const graph = topo('testapp', {
      echo: trail('echo', {
        blaze: (input: { message: string }) =>
          Result.ok({ reply: input.message }),
        input: z.object({ message: z.string() }),
        intent: 'read',
        output: z.object({ reply: z.string() }),
      }),
    });

    const routes = unwrapOk(deriveHttpRoutes(graph));
    expect(routes[0]?.path).toBe('/echo');
  });
});
