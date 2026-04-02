/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { run } from '../run';
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
  blaze: (input) => Result.ok({ value: input.value }),
  input: z.object({ value: z.string() }),
  output: z.object({ value: z.string() }),
});

const throwingTrail = trail('throws', {
  blaze: () => {
    throw new Error('kaboom');
  },
  input: z.object({}),
});

const testTopo = topo('test', { echoTrail, throwingTrail });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('run', () => {
  describe('happy path', () => {
    test('executes by ID and returns Result.ok with expected value', async () => {
      const result = await run(testTopo, 'echo', { value: 'hello' });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ value: 'hello' });
    });

    test('passes service overrides through to executeTrail', async () => {
      const id = `run.service.${Bun.randomUUIDv7()}`;
      const db = service(id, {
        create: () => Result.ok({ source: 'factory' }),
      });
      const searchTrail = trail('search', {
        blaze: (_input, ctx) => Result.ok({ source: db.from(ctx).source }),
        input: z.object({}),
        output: z.object({ source: z.string() }),
        services: [db],
      });
      const searchTopo = topo('service-test', { searchTrail });

      const result = await run(
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
      const result = await run(testTopo, 'nonexistent', {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error.message).toContain('nonexistent');
      expect(result.error.message).toContain('test');
    });
  });

  describe('validation', () => {
    test('returns ValidationError for invalid input', async () => {
      const result = await run(testTopo, 'echo', { value: 42 });

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
    });
  });

  describe('layers', () => {
    test('layer composition works through run', async () => {
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

      const result = await run(
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
    test('context overrides work through run', async () => {
      let capturedCtx: TrailContext | undefined;
      const ctxTrail = trail('ctx-run-test', {
        blaze: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
        input: z.object({}),
      });

      const ctxTopo = topo('ctx-test', { ctxTrail });
      await run(
        ctxTopo,
        'ctx-run-test',
        {},
        { ctx: { requestId: 'override-id' } }
      );

      expect(capturedCtx?.requestId).toBe('override-id');
    });

    test('createContext factory works through run', async () => {
      let capturedCtx: TrailContext | undefined;
      const ctxTrail = trail('factory-run-test', {
        blaze: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
        input: z.object({}),
      });

      const ctxTopo = topo('factory-test', { ctxTrail });
      const customCtx: TrailContextInit = {
        abortSignal: new AbortController().signal,
        cwd: '/custom',
        requestId: 'factory-id',
      };

      await run(
        ctxTopo,
        'factory-run-test',
        {},
        { createContext: () => customCtx }
      );

      expect(capturedCtx?.requestId).toBe('factory-id');
      expect(capturedCtx?.cwd).toBe('/custom');
    });
  });

  describe('error handling', () => {
    test('never throws — exceptions become InternalError', async () => {
      const result = await run(testTopo, 'throws', {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toBe('kaboom');
    });
  });
});
