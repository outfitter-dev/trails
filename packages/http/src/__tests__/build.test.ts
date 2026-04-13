import { describe, expect, test } from 'bun:test';

import {
  InternalError,
  NotFoundError,
  Result,
  TRAILHEAD_KEY,
  resource,
  signal,
  ValidationError,
  trail,
  topo,
} from '@ontrails/core';
import type { Layer, TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { buildHttpRoutes } from '../build.js';

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

const echoTrail = trail('echo', {
  blaze: (input) => Result.ok({ reply: input.message }),
  description: 'Echo a message back',
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
});

const createTrail = trail('item.create', {
  blaze: (input) => Result.ok({ id: '123', name: input.name }),
  description: 'Create an item',
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

const deleteTrail = trail('item.delete', {
  blaze: (_input) => Result.ok({ deleted: true }),
  description: 'Delete an item',
  input: z.object({ id: z.string() }),
  intent: 'destroy',
});

const notFoundTrail = trail('item.get', {
  blaze: (_input) => Result.err(new NotFoundError('Item not found')),
  description: 'Get an item that does not exist',
  input: z.object({ id: z.string() }),
  intent: 'read',
});

const internalTrail = trail('crash', {
  blaze: () => Result.err(new InternalError('Something broke')),
  description: 'Always fails with internal error',
  input: z.object({}),
});

const internalVisibilityTrail = trail('secret', {
  blaze: () => Result.ok({ ok: true }),
  description: 'Internal trail that should be skipped',
  input: z.object({}),
  visibility: 'internal',
});

const dbResource = resource('db.main', {
  create: () =>
    Result.ok({
      source: 'factory',
    }),
});

const orderPlaced = signal('order.placed', {
  payload: z.object({ orderId: z.string() }),
});

const requireFire = (fire: TrailContext['fire']) => {
  if (!fire) {
    throw new Error('Expected ctx.fire to be bound');
  }
  return fire;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildHttpRoutes', () => {
  describe('method derivation', () => {
    test('intent: read maps to GET', () => {
      const app = topo('testapp', { echoTrail });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.method).toBe('GET');
    });

    test('intent: destroy maps to DELETE', () => {
      const app = topo('testapp', { deleteTrail });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.method).toBe('DELETE');
    });

    test('default intent (write) maps to POST', () => {
      const app = topo('testapp', { createTrail });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.method).toBe('POST');
    });
  });

  describe('path derivation', () => {
    test('dotted ID becomes slashed path', () => {
      const app = topo('testapp', { createTrail });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      expect(result.value[0]?.path).toBe('/item/create');
    });

    test('simple ID becomes /id', () => {
      const app = topo('testapp', { echoTrail });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      expect(result.value[0]?.path).toBe('/echo');
    });

    test('basePath is prepended', () => {
      const app = topo('testapp', { echoTrail });
      const result = buildHttpRoutes(app, { basePath: '/api/v1' });

      expect(result.isOk()).toBe(true);
      expect(result.value[0]?.path).toBe('/api/v1/echo');
    });

    test('basePath trailing slash is normalized', () => {
      const app = topo('testapp', { echoTrail });
      const result = buildHttpRoutes(app, { basePath: '/api/v1/' });

      expect(result.isOk()).toBe(true);
      expect(result.value[0]?.path).toBe('/api/v1/echo');
    });
  });

  describe('input source derivation', () => {
    test('GET routes use query input source', () => {
      const app = topo('testapp', { echoTrail });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      expect(result.value[0]?.inputSource).toBe('query');
    });

    test('POST routes use body input source', () => {
      const app = topo('testapp', { createTrail });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      expect(result.value[0]?.inputSource).toBe('body');
    });

    test('DELETE routes use body input source', () => {
      const app = topo('testapp', { deleteTrail });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      expect(result.value[0]?.inputSource).toBe('body');
    });
  });

  describe('filtering', () => {
    test('internal trails are skipped', () => {
      const app = topo('testapp', { echoTrail, internalVisibilityTrail });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.trailId).toBe('echo');
    });

    test('exact include can expose an internal trail', () => {
      const app = topo('testapp', { echoTrail, internalVisibilityTrail });
      const result = buildHttpRoutes(app, { include: ['secret'] });

      expect(result.isOk()).toBe(true);
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.trailId).toBe('secret');
    });

    test('wildcard include does not expose internal trails', () => {
      const app = topo('testapp', { echoTrail, internalVisibilityTrail });
      const result = buildHttpRoutes(app, { include: ['**'] });

      expect(result.isOk()).toBe(true);
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.trailId).toBe('echo');
    });

    test('exclude patterns win before include narrowing', () => {
      const app = topo('testapp', { deleteTrail, echoTrail });
      const result = buildHttpRoutes(app, {
        exclude: ['item.**'],
        include: ['echo', 'item.delete'],
      });

      expect(result.isOk()).toBe(true);
      expect(result.value.map((route) => route.trailId)).toEqual(['echo']);
    });

    test('consumer trails (on: [...]) are skipped', () => {
      const consumerTrail = trail('notify.email', {
        blaze: (input: { orderId: string }) =>
          Result.ok({ delivered: true, orderId: input.orderId }),
        description: 'Send email on order placed',
        input: z.object({ orderId: z.string() }),
        on: ['order.placed'],
      });
      const app = topo('testapp', { consumerTrail, echoTrail, orderPlaced });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.trailId).toBe('echo');
    });
  });

  describe('route definition shape', () => {
    test('includes trail reference', () => {
      const app = topo('testapp', { echoTrail });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      expect(result.value[0]?.trail).toBe(echoTrail);
    });

    test('execute is a function', () => {
      const app = topo('testapp', { echoTrail });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      expect(typeof result.value[0]?.execute).toBe('function');
    });
  });

  describe('execute', () => {
    test('returns ok Result on valid input', async () => {
      const app = topo('testapp', { echoTrail });
      const buildResult = buildHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({ message: 'hello' });
      expect(result?.isOk()).toBe(true);
      expect(result?.value).toEqual({ reply: 'hello' });
    });

    test('returns err Result on invalid input', async () => {
      const app = topo('testapp', { echoTrail });
      const buildResult = buildHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({});
      expect(result?.isErr()).toBe(true);
    });

    test('returns err Result from trail error', async () => {
      const app = topo('testapp', { notFoundTrail });
      const buildResult = buildHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({ id: 'missing' });
      expect(result?.isErr()).toBe(true);
      expect(result?.error?.message).toBe('Item not found');
    });

    test('returns err Result from internal error', async () => {
      const app = topo('testapp', { internalTrail });
      const buildResult = buildHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({});
      expect(result?.isErr()).toBe(true);
      expect(result?.error?.message).toBe('Something broke');
    });

    test('returns err Result when run function throws', async () => {
      const throwingTrail = trail('throwing', {
        blaze: () => {
          throw new Error('unexpected throw');
        },
        input: z.object({}),
      });
      const app = topo('testapp', { throwingTrail });
      const buildResult = buildHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({});
      expect(result?.isErr()).toBe(true);
      expect(result?.error).toBeInstanceOf(InternalError);
      expect(result?.error?.message).toBe('unexpected throw');
    });

    test('returns err Result when createContext throws', async () => {
      const app = topo('testapp', { echoTrail });
      const buildResult = buildHttpRoutes(app, {
        createContext: () => {
          throw new Error('context creation failed');
        },
      });

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({ message: 'hi' });
      expect(result?.isErr()).toBe(true);
      expect(result?.error).toBeInstanceOf(InternalError);
      expect(result?.error?.message).toBe('context creation failed');
    });

    test('passes topo to executeTrail so HTTP-invoked producers can fan out', async () => {
      const captured: string[] = [];
      const consumer = trail('notify.email', {
        blaze: (input: { orderId: string }) => {
          captured.push(input.orderId);
          return Result.ok({ delivered: true });
        },
        input: z.object({ orderId: z.string() }),
        on: ['order.placed'],
      });
      const producer = trail('order.create', {
        blaze: async (input: { orderId: string }, ctx) => {
          const fired = await requireFire(ctx.fire)('order.placed', {
            orderId: input.orderId,
          });
          return fired.match({
            err: (error) => Result.err(error),
            ok: () => Result.ok({ ok: true }),
          });
        },
        fires: ['order.placed'],
        input: z.object({ orderId: z.string() }),
      });
      const app = topo('signal-http', { consumer, orderPlaced, producer });
      const buildResult = buildHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({ orderId: 'o-http' });

      expect(result?.isOk()).toBe(true);
      expect(captured).toEqual(['o-http']);
    });

    test('passes requestId to context', async () => {
      let capturedRequestId: string | undefined;

      const ctxTrail = trail('ctx.check', {
        blaze: (_input, ctx) => {
          capturedRequestId = ctx.requestId;
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        intent: 'read',
      });

      const app = topo('testapp', { ctxTrail });
      const buildResult = buildHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      await route?.execute({}, 'custom-req-123');
      expect(capturedRequestId).toBe('custom-req-123');
    });

    test('uses default requestId when none provided', async () => {
      let capturedRequestId: string | undefined;

      const ctxTrail = trail('ctx.default', {
        blaze: (_input, ctx) => {
          capturedRequestId = ctx.requestId;
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        intent: 'read',
      });

      const app = topo('testapp', { ctxTrail });
      const buildResult = buildHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      await route?.execute({});
      expect(capturedRequestId).toBeDefined();
      expect(capturedRequestId).not.toBe('');
    });

    test('forwards resource overrides into executeTrail', async () => {
      const resourceTrail = trail('resource.check', {
        blaze: (_input, ctx) =>
          Result.ok({ source: dbResource.from(ctx).source as string }),
        input: z.object({}),
        output: z.object({ source: z.string() }),
        resources: [dbResource],
      });

      const app = topo('testapp', { dbResource, resourceTrail });
      const buildResult = buildHttpRoutes(app, {
        resources: { 'db.main': { source: 'override' } },
      });

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({});
      expect(result?.isOk()).toBe(true);
      expect(result?.value).toEqual({ source: 'override' });
    });
  });

  describe('layers', () => {
    test('layers compose around trail execution', async () => {
      const calls: string[] = [];

      const testGate: Layer = {
        name: 'test-layer',
        wrap(_trail, impl) {
          return async (input, ctx) => {
            calls.push('before');
            const result = await impl(input, ctx);
            calls.push('after');
            return result;
          };
        },
      };

      const app = topo('testapp', { echoTrail });
      const buildResult = buildHttpRoutes(app, { layers: [testGate] });

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({ message: 'hi' });
      expect(result?.isOk()).toBe(true);
      expect(calls).toEqual(['before', 'after']);
    });
  });

  describe('custom createContext', () => {
    test('custom createContext is used when provided', async () => {
      const contextState = { custom: false, trailheadMarker: false };

      const ctxTrail = trail('ctx.custom', {
        blaze: (_input, ctx) => {
          contextState.custom = ctx.extensions?.['custom'] === true;
          contextState.trailheadMarker =
            ctx.extensions?.[TRAILHEAD_KEY] === 'http';
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        intent: 'read',
      });

      const app = topo('testapp', { ctxTrail });
      const buildResult = buildHttpRoutes(app, {
        createContext: () => ({
          abortSignal: new AbortController().signal,
          extensions: { custom: true },
          requestId: 'test-id',
        }),
      });

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({});
      expect(result?.isOk()).toBe(true);
      expect(contextState.custom).toBe(true);
      expect(contextState.trailheadMarker).toBe(true);
    });
  });

  describe('collision detection', () => {
    test('returns err on duplicate (path, method) pair', () => {
      // "entity.show" derives path /entity/show (dots become slashes)
      // "entity/show" derives path /entity/show (slashes are preserved)
      // Both have intent: read -> GET, so they collide on GET /entity/show
      const dotTrail = trail('entity.show', {
        blaze: () => Result.ok({ dot: true }),
        description: 'Show entity (dot notation)',
        input: z.object({}),
        intent: 'read',
      });
      const slashTrail = trail('entity/show', {
        blaze: () => Result.ok({ slash: true }),
        description: 'Show entity (slash notation)',
        input: z.object({}),
        intent: 'read',
      });
      const app = topo('testapp', { dotTrail, slashTrail });
      const result = buildHttpRoutes(app);

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error?.message).toContain('GET /entity/show');
    });

    test('same path with different methods is allowed', () => {
      // "item.resource" derives GET /item/resource (intent: read)
      // "item/resource" derives POST /item/resource (default intent: write)
      // Same path, different methods — no collision
      const getItem = trail('item.resource', {
        blaze: () => Result.ok({ get: true }),
        description: 'Get item',
        input: z.object({}),
        intent: 'read',
      });
      const createItem = trail('item/resource', {
        blaze: () => Result.ok({ created: true }),
        description: 'Create item',
        input: z.object({ name: z.string() }),
      });
      const app = topo('testapp', { createItem, getItem });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      expect(result.value).toHaveLength(2);
    });

    test('collision error message identifies both trail IDs', () => {
      const dotTrail = trail('entity.show', {
        blaze: () => Result.ok({ one: true }),
        description: 'Trail one',
        input: z.object({}),
        intent: 'read',
      });
      const slashTrail = trail('entity/show', {
        blaze: () => Result.ok({ two: true }),
        description: 'Trail two',
        input: z.object({}),
        intent: 'read',
      });
      const app = topo('testapp', { dotTrail, slashTrail });
      const result = buildHttpRoutes(app);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('entity');
    });
  });

  describe('established graph enforcement', () => {
    test('returns err when draft contamination remains', () => {
      const draftTrail = trail('entity.export', {
        blaze: () => Result.ok({ ok: true }),
        crosses: ['_draft.entity.prepare'],
        input: z.object({}),
      });

      const result = buildHttpRoutes(topo('testapp', { draftTrail }));

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toMatch(/draft/i);
    });
  });
});
