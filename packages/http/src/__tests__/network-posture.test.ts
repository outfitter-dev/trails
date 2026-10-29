import { beforeEach, describe, expect, test } from 'bun:test';
import {
  AuthError,
  createTrailContext,
  isTrailsError,
  resource,
  Result,
  topo,
  trail,
  webhook,
} from '@ontrails/core';
import type { Logger } from '@ontrails/core';
import { z } from 'zod';

import { deriveHttpRoutes, resetSeededPermitDiagnostic } from '../build.js';
import { createApp } from '../bun.js';
import { createFetchHandler } from '../fetch.js';

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

const graph = () => topo('posture', { guarded, whoami });

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

const resolveBearer = ({
  bearerToken,
}: {
  bearerToken?: string | undefined;
}) => {
  if (bearerToken === undefined) {
    return Result.ok(null);
  }
  return bearerToken === 'verified'
    ? Result.ok({ actors: [], id: 'verified-user', scopes: ['record:write'] })
    : Result.err(new AuthError('bad token'));
};

describe('HTTP network credential posture', () => {
  let warnings: string[] = [];
  beforeEach(() => {
    warnings = [];
    resetSeededPermitDiagnostic();
  });
  const seededContext = () =>
    createTrailContext({ logger: capturingLogger(warnings), permit: seed });

  test('no credential is anonymous: public runs, protected answers 403', async () => {
    const handler = createFetchHandler(graph(), {
      resolvePermit: resolveBearer,
    });
    const open = await handler(request('/whoami'));
    expect(await open.json()).toEqual({ data: { id: null } });
    const denied = await handler(request('/record/update', { method: 'POST' }));
    expect(denied.status).toBe(403);
  });

  test('an invalid credential is the resolver error, even for a public trail', async () => {
    const handler = createFetchHandler(graph(), {
      resolvePermit: resolveBearer,
    });
    const response = await handler(
      request('/whoami', { headers: { authorization: 'Bearer nope' } })
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { category: 'auth' },
    });
  });

  test('a presented credential with no resolver is an AuthError, never absence', async () => {
    const handler = createFetchHandler(topo('open', { whoami }));
    const candidates: readonly Record<string, string>[] = [
      { authorization: 'Bearer abc' },
      { 'x-api-key': 'key' },
      { 'x-auth-token': 'tok' },
    ];
    for (const headers of candidates) {
      const response = await handler(request('/whoami', { headers }));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { category: 'auth' },
      });
    }
    const anonymous = await handler(request('/whoami'));
    expect(await anonymous.json()).toEqual({ data: { id: null } });
  });

  test('an inherited createContext permit is discarded with one diagnostic', async () => {
    const handler = createFetchHandler(graph(), {
      createContext: seededContext,
      resolvePermit: resolveBearer,
    });
    const open = await handler(request('/whoami'));
    expect(await open.json()).toEqual({ data: { id: null } });
    const denied = await handler(request('/record/update', { method: 'POST' }));
    expect(denied.status).toBe(403);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('createContext permit was discarded');

    const verified = await handler(
      request('/record/update', {
        headers: { authorization: 'Bearer verified' },
        method: 'POST',
      })
    );
    expect(await verified.json()).toEqual({ data: { ok: true } });
  });

  test('the host posture keeps the seed for in-process callers', async () => {
    const routes = deriveHttpRoutes(graph(), {
      createContext: seededContext,
    }).unwrap();
    const route = routes.find((entry) => entry.path === '/record/update');
    const result = await route?.execute({}, undefined, undefined, {});
    expect(result?.isOk()).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  test('protected trails without a verifier are refused at build time on the network posture', () => {
    const refused = deriveHttpRoutes(graph(), { credentialPosture: 'network' });
    expect(refused.isErr()).toBe(true);
    if (!refused.isErr()) {
      return;
    }
    expect(isTrailsError(refused.error) && refused.error.category).toBe(
      'validation'
    );
    expect(refused.error.message).toContain('record.update');
    expect(deriveHttpRoutes(graph()).isOk()).toBe(true);
    expect(
      deriveHttpRoutes(graph(), {
        credentialPosture: 'network',
        resolvePermit: resolveBearer,
      }).isOk()
    ).toBe(true);
    expect(() => createFetchHandler(graph())).toThrow(/record\.update/);
    expect(() => createApp(graph())).toThrow(/record\.update/);
  });

  test('the Bun app never inherits a seed', async () => {
    const app = createApp(graph(), {
      createContext: seededContext,
      resolvePermit: resolveBearer,
    });
    const update = app.routes['/record/update']?.POST;
    if (update === undefined) {
      throw new Error('expected the update route');
    }
    const denied = await update(request('/record/update', { method: 'POST' }));
    expect(denied.status).toBe(403);
    expect(warnings).toHaveLength(1);
  });

  test('protected webhook consumers count in the build-time verifier check', () => {
    const source = webhook('webhook.payment.received', {
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/payment',
    });
    const receiver = trail('payment.receive', {
      implementation: (input) => Result.ok({ paymentId: input.paymentId }),
      input: z.object({ paymentId: z.string() }),
      on: [source],
      output: z.object({ paymentId: z.string() }),
      permit: { scopes: ['payment:write'] },
    });
    const refused = deriveHttpRoutes(topo('billing', { receiver }), {
      credentialPosture: 'network',
    });
    expect(refused.isErr()).toBe(true);
    if (refused.isErr()) {
      expect(refused.error.message).toContain('payment.receive');
    }
    expect(
      deriveHttpRoutes(topo('billing', { receiver }), {
        credentialPosture: 'network',
        resolvePermit: resolveBearer,
      }).isOk()
    ).toBe(true);
  });

  test('a resource-backed webhook verifier never sees the seeded permit on the network', async () => {
    const secrets = resource('secrets', {
      create: () => Result.ok({ token: 'expected' }),
    });
    const seenPermits: (string | undefined)[] = [];
    const source = webhook('webhook.payment.received', {
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/payment',
      resources: [secrets],
      verify: (_request, ctx) => {
        seenPermits.push(ctx?.permit?.id);
        return Result.ok();
      },
    });
    const receiver = trail('payment.receive', {
      implementation: (input) => Result.ok({ paymentId: input.paymentId }),
      input: z.object({ paymentId: z.string() }),
      on: [source],
      output: z.object({ paymentId: z.string() }),
    });
    const handler = createFetchHandler(topo('billing', { receiver, secrets }), {
      createContext: seededContext,
    });
    const response = await handler(
      request('/webhooks/payment', {
        body: JSON.stringify({ paymentId: 'p1' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
    );
    expect(response.status).toBeLessThan(300);
    expect(seenPermits).toEqual([undefined]);
  });
});
