/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { InternalError, ValidationError } from '../errors';
import { executeTrail } from '../execute';
import { createTrailContext } from '../context';
import type { Layer } from '../layer';
import { Result } from '../result';
import { trail } from '../trail';
import type { TrailContext } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const echoTrail = trail('echo', {
  input: z.object({ value: z.string() }),
  output: z.object({ value: z.string() }),
  run: (input) => Result.ok({ value: input.value }),
});

const failingTrail = trail('fails', {
  input: z.object({}),
  run: () => Result.err(new ValidationError('bad input')),
});

const throwingTrail = trail('throws', {
  input: z.object({}),
  run: () => {
    throw new Error('kaboom');
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeTrail', () => {
  describe('happy path', () => {
    test('validates input and executes trail', async () => {
      const result = await executeTrail(echoTrail, { value: 'hello' });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ value: 'hello' });
    });
  });

  describe('validation', () => {
    test('returns validation error for invalid input', async () => {
      const result = await executeTrail(echoTrail, { value: 42 });

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
    });
  });

  describe('layers', () => {
    test('composes layers around execution', async () => {
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

      const result = await executeTrail(
        echoTrail,
        { value: 'x' },
        { layers: [layer] }
      );

      expect(result.isOk()).toBe(true);
      expect(log).toEqual(['before', 'after']);
    });
  });

  describe('context', () => {
    test('accepts context overrides', async () => {
      let capturedCtx: TrailContext | undefined;
      const ctxTrail = trail('ctx-test', {
        input: z.object({}),
        run: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
      });

      await executeTrail(ctxTrail, {}, { ctx: { requestId: 'override-id' } });

      expect(capturedCtx?.requestId).toBe('override-id');
    });

    test('accepts signal override', async () => {
      let capturedSignal: AbortSignal | undefined;
      const sigTrail = trail('sig-test', {
        input: z.object({}),
        run: (_input, ctx) => {
          capturedSignal = ctx.signal;
          return Result.ok(null);
        },
      });

      const signal = AbortSignal.timeout(9999);
      await executeTrail(sigTrail, {}, { signal });

      expect(capturedSignal).toBe(signal);
    });

    test('accepts context factory', async () => {
      let capturedCtx: TrailContext | undefined;
      const ctxTrail = trail('factory-test', {
        input: z.object({}),
        run: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
      });

      const customCtx: TrailContext = {
        cwd: '/custom',
        requestId: 'factory-id',
        signal: new AbortController().signal,
      };

      await executeTrail(ctxTrail, {}, { createContext: () => customCtx });

      expect(capturedCtx?.requestId).toBe('factory-id');
      expect(capturedCtx?.cwd).toBe('/custom');
    });

    test('context factory + ctx overrides merge correctly', async () => {
      let capturedCtx: TrailContext | undefined;
      const ctxTrail = trail('merge-test', {
        input: z.object({}),
        run: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
      });

      const baseCtx: TrailContext = {
        cwd: '/factory',
        requestId: 'factory-id',
        signal: new AbortController().signal,
      };

      await executeTrail(
        ctxTrail,
        {},
        {
          createContext: () => baseCtx,
          ctx: { requestId: 'overridden-id' },
        }
      );

      expect(capturedCtx?.requestId).toBe('overridden-id');
      expect(capturedCtx?.cwd).toBe('/factory');
    });

    test('deep-merges extensions from factory and overrides', async () => {
      let captured: TrailContext | undefined;
      const t = trail('ext.test', {
        input: z.object({}),
        output: z.object({}),
        run: (_input, ctx) => {
          captured = ctx;
          return Result.ok({});
        },
      });
      await executeTrail(
        t,
        {},
        {
          createContext: () =>
            createTrailContext({ extensions: { store: 'db' } }),
          ctx: { extensions: { userId: '123' } },
        }
      );
      expect(captured?.extensions).toEqual({ store: 'db', userId: '123' });
    });
  });

  describe('error handling', () => {
    test('propagates Result.err from run function', async () => {
      const result = await executeTrail(failingTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toBe('bad input');
    });

    test('catches thrown exceptions and returns InternalError', async () => {
      const result = await executeTrail(throwingTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toBe('kaboom');
    });
  });
});
