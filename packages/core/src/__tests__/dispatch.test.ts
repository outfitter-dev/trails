/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { dispatch } from '../dispatch';
import { InternalError, NotFoundError, ValidationError } from '../errors';
import type { Layer } from '../layer';
import { Result } from '../result';
import { service } from '../service';
import { topo } from '../topo';
import { trail } from '../trail';
import type { TrailContext, TrailContextInit } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const echoTrail = trail('echo', {
  input: z.object({ value: z.string() }),
  output: z.object({ value: z.string() }),
  run: (input) => Result.ok({ value: input.value }),
});

const throwingTrail = trail('throws', {
  input: z.object({}),
  run: () => {
    throw new Error('kaboom');
  },
});

const testTopo = topo('test', { echoTrail, throwingTrail });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dispatch', () => {
  describe('happy path', () => {
    test('dispatches by ID and returns Result.ok with expected value', async () => {
      const result = await dispatch(testTopo, 'echo', { value: 'hello' });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ value: 'hello' });
    });

    test('passes service overrides through to executeTrail', async () => {
      const id = `dispatch.service.${Bun.randomUUIDv7()}`;
      const db = service(id, {
        create: () => Result.ok({ source: 'factory' }),
      });
      const searchTrail = trail('search', {
        input: z.object({}),
        output: z.object({ source: z.string() }),
        run: (_input, ctx) => Result.ok({ source: db.from(ctx).source }),
        services: [db],
      });
      const searchTopo = topo('service-test', { searchTrail });

      const result = await dispatch(
        searchTopo,
        'search',
        {},
        {
          services: { [id]: { source: 'override' } },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ source: 'override' });
    });
  });

  describe('not found', () => {
    test('returns NotFoundError for unknown trail ID', async () => {
      const result = await dispatch(testTopo, 'nonexistent', {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error.message).toContain('nonexistent');
      expect(result.error.message).toContain('test');
    });
  });

  describe('validation', () => {
    test('returns ValidationError for invalid input', async () => {
      const result = await dispatch(testTopo, 'echo', { value: 42 });

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
    });
  });

  describe('layers', () => {
    test('layer composition works through dispatch', async () => {
      const log: string[] = [];
      const layer: Layer = {
        name: 'test-layer',
        wrap(_trail, impl) {
          return async (input, ctx) => {
            log.push('before');
            const r = await impl(input, ctx);
            log.push('after');
            return r;
          };
        },
      };

      const result = await dispatch(
        testTopo,
        'echo',
        { value: 'x' },
        { layers: [layer] }
      );

      expect(result.isOk()).toBe(true);
      expect(log).toEqual(['before', 'after']);
    });
  });

  describe('context', () => {
    test('context overrides work through dispatch', async () => {
      let capturedCtx: TrailContext | undefined;
      const ctxTrail = trail('ctx-dispatch-test', {
        input: z.object({}),
        run: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
      });

      const ctxTopo = topo('ctx-test', { ctxTrail });
      await dispatch(
        ctxTopo,
        'ctx-dispatch-test',
        {},
        { ctx: { requestId: 'override-id' } }
      );

      expect(capturedCtx?.requestId).toBe('override-id');
    });

    test('createContext factory works through dispatch', async () => {
      let capturedCtx: TrailContext | undefined;
      const ctxTrail = trail('factory-dispatch-test', {
        input: z.object({}),
        run: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
      });

      const ctxTopo = topo('factory-test', { ctxTrail });
      const customCtx: TrailContextInit = {
        cwd: '/custom',
        requestId: 'factory-id',
        signal: new AbortController().signal,
      };

      await dispatch(
        ctxTopo,
        'factory-dispatch-test',
        {},
        { createContext: () => customCtx }
      );

      expect(capturedCtx?.requestId).toBe('factory-id');
      expect(capturedCtx?.cwd).toBe('/custom');
    });
  });

  describe('error handling', () => {
    test('never throws — exceptions become InternalError', async () => {
      const result = await dispatch(testTopo, 'throws', {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toBe('kaboom');
    });
  });
});
