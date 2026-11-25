import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createTrailContext, Result, topo, trail } from '@ontrails/core';
import type { Logger } from '@ontrails/core';
import { z } from 'zod';

import { createWorkersHandler } from '../index.js';

const seed = { actors: [], id: 'local-host', scopes: ['record:write'] };

const whoami = trail('whoami', {
  implementation: (_input, ctx) => Result.ok({ id: ctx.permit?.id ?? null }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ id: z.string().nullable() }),
});

const guarded = trail('record.update', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'write',
  output: z.object({ ok: z.boolean() }),
  permit: { scopes: ['record:write'] },
});

const capturingLogger = (sink: string[]): Logger => {
  const logger: Logger = {
    child: () => logger,
    debug: () => {},
    error: () => {},
    fatal: () => {},
    info: () => {},
    trace: () => {},
    warn: (message) => {
      sink.push(message);
    },
  };
  return logger;
};

const request = (path: string, init: RequestInit = {}): Request =>
  new Request(new URL(path, 'http://localhost').toString(), init);

describe('Workers network credential posture', () => {
  let originalConsoleError = console.error;
  beforeEach(() => {
    originalConsoleError = console.error;
    console.error = mock(() => {});
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  test('the Worker never inherits a createContext permit', async () => {
    const warnings: string[] = [];
    const worker = createWorkersHandler(topo('posture', { guarded, whoami }), {
      createContext: () =>
        createTrailContext({ logger: capturingLogger(warnings), permit: seed }),
      resolvePermit: ({ bearerToken }) =>
        bearerToken === 'verified'
          ? Result.ok({
              actors: [],
              id: 'verified-user',
              scopes: ['record:write'],
            })
          : Result.ok(null),
    });
    const open = await worker.fetch(request('/whoami'), {});
    expect(await open.json()).toEqual({ data: { id: null } });
    const denied = await worker.fetch(
      request('/record/update', { method: 'POST' }),
      {}
    );
    expect(denied.status).toBe(403);
    const allowed = await worker.fetch(
      request('/record/update', {
        headers: { authorization: 'Bearer verified' },
        method: 'POST',
      }),
      {}
    );
    expect(await allowed.json()).toEqual({ data: { ok: true } });
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });

  test('a presented credential with no resolver answers 401', async () => {
    const worker = createWorkersHandler(topo('open', { whoami }));
    const response = await worker.fetch(
      request('/whoami', { headers: { authorization: 'Bearer abc' } }),
      {}
    );
    expect(response.status).toBe(401);
  });

  test('protected trails without a resolver fail loudly at materialization', async () => {
    const worker = createWorkersHandler(topo('posture', { guarded, whoami }));
    const response = await worker.fetch(request('/whoami'), {});
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { category: 'validation' },
    });
  });
});
