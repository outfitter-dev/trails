import { describe, expect, test } from 'bun:test';

import {
  InternalError,
  NotFoundError,
  Result,
  SURFACE_KEY,
  service,
  ValidationError,
  trail,
  topo,
} from '@ontrails/core';
import type { Layer } from '@ontrails/core';
import { z } from 'zod';

import { buildHttpRoutes } from '../build.js';

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

const echoTrail = trail('echo', {
  description: 'Echo a message back',
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
  run: (input) => Result.ok({ reply: input.message }),
});

const createTrail = trail('item.create', {
  description: 'Create an item',
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
  run: (input) => Result.ok({ id: '123', name: input.name }),
});

const deleteTrail = trail('item.delete', {
  description: 'Delete an item',
  input: z.object({ id: z.string() }),
  intent: 'destroy',
  run: (_input) => Result.ok({ deleted: true }),
});

const notFoundTrail = trail('item.get', {
  description: 'Get an item that does not exist',
  input: z.object({ id: z.string() }),
  intent: 'read',
  run: (_input) => Result.err(new NotFoundError('Item not found')),
});

const internalTrail = trail('crash', {
  description: 'Always fails with internal error',
  input: z.object({}),
  run: () => Result.err(new InternalError('Something broke')),
});

const internalMetaTrail = trail('secret', {
  description: 'Internal trail that should be skipped',
  input: z.object({}),
  metadata: { internal: true },
  run: () => Result.ok({ ok: true }),
});

const dbService = service('db.main', {
  create: () =>
    Result.ok({
      source: 'factory',
    }),
});

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
      const app = topo('testapp', { echoTrail, internalMetaTrail });
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
        input: z.object({}),
        run: () => {
          throw new Error('unexpected throw');
        },
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

    test('passes requestId to context', async () => {
      let capturedRequestId: string | undefined;

      const ctxTrail = trail('ctx.check', {
        input: z.object({}),
        intent: 'read',
        run: (_input, ctx) => {
          capturedRequestId = ctx.requestId;
          return Result.ok({ ok: true });
        },
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
        input: z.object({}),
        intent: 'read',
        run: (_input, ctx) => {
          capturedRequestId = ctx.requestId;
          return Result.ok({ ok: true });
        },
      });

      const app = topo('testapp', { ctxTrail });
      const buildResult = buildHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      await route?.execute({});
      expect(capturedRequestId).toBeDefined();
      expect(capturedRequestId).not.toBe('');
    });

    test('forwards service overrides into executeTrail', async () => {
      const serviceTrail = trail('service.check', {
        input: z.object({}),
        output: z.object({ source: z.string() }),
        run: (_input, ctx) =>
          Result.ok({ source: dbService.from(ctx).source as string }),
        services: [dbService],
      });

      const app = topo('testapp', { serviceTrail });
      const buildResult = buildHttpRoutes(app, {
        services: { 'db.main': { source: 'override' } },
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

      const testLayer: Layer = {
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
      const buildResult = buildHttpRoutes(app, { layers: [testLayer] });

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({ message: 'hi' });
      expect(result?.isOk()).toBe(true);
      expect(calls).toEqual(['before', 'after']);
    });
  });

  describe('custom createContext', () => {
    test('custom createContext is used when provided', async () => {
      const contextState = { custom: false, surface: false };

      const ctxTrail = trail('ctx.custom', {
        input: z.object({}),
        intent: 'read',
        run: (_input, ctx) => {
          contextState.custom = ctx.extensions?.['custom'] === true;
          contextState.surface = ctx.extensions?.[SURFACE_KEY] === 'http';
          return Result.ok({ ok: true });
        },
      });

      const app = topo('testapp', { ctxTrail });
      const buildResult = buildHttpRoutes(app, {
        createContext: () => ({
          extensions: { custom: true },
          requestId: 'test-id',
          signal: new AbortController().signal,
        }),
      });

      expect(buildResult.isOk()).toBe(true);
      const [route] = buildResult.value;

      const result = await route?.execute({});
      expect(result?.isOk()).toBe(true);
      expect(contextState.custom).toBe(true);
      expect(contextState.surface).toBe(true);
    });
  });

  describe('collision detection', () => {
    test('returns err on duplicate (path, method) pair', () => {
      // "entity.show" derives path /entity/show (dots become slashes)
      // "entity/show" derives path /entity/show (slashes are preserved)
      // Both have intent: read -> GET, so they collide on GET /entity/show
      const dotTrail = trail('entity.show', {
        description: 'Show entity (dot notation)',
        input: z.object({}),
        intent: 'read',
        run: () => Result.ok({ dot: true }),
      });
      const slashTrail = trail('entity/show', {
        description: 'Show entity (slash notation)',
        input: z.object({}),
        intent: 'read',
        run: () => Result.ok({ slash: true }),
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
        description: 'Get item',
        input: z.object({}),
        intent: 'read',
        run: () => Result.ok({ get: true }),
      });
      const createItem = trail('item/resource', {
        description: 'Create item',
        input: z.object({ name: z.string() }),
        run: () => Result.ok({ created: true }),
      });
      const app = topo('testapp', { createItem, getItem });
      const result = buildHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      expect(result.value).toHaveLength(2);
    });

    test('collision error message identifies both trail IDs', () => {
      const dotTrail = trail('entity.show', {
        description: 'Trail one',
        input: z.object({}),
        intent: 'read',
        run: () => Result.ok({ one: true }),
      });
      const slashTrail = trail('entity/show', {
        description: 'Trail two',
        input: z.object({}),
        intent: 'read',
        run: () => Result.ok({ two: true }),
      });
      const app = topo('testapp', { dotTrail, slashTrail });
      const result = buildHttpRoutes(app);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('entity');
    });
  });
});
