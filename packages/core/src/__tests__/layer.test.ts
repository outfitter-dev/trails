/* oxlint-disable require-await -- layer wrappers satisfy async interfaces without awaiting */
import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { createTrailContext } from '../context';
import { composeLayers } from '../layer';
import type { Layer } from '../layer';
import { Result } from '../result';
import { trail } from '../trail';
import type { TrailContext } from '../types';

const stubCtx: TrailContext = createTrailContext({
  abortSignal: AbortSignal.timeout(5000),
  requestId: 'test-layer',
});

const echoTrail = trail('echo', {
  blaze: (input) => Result.ok({ value: input.value }),
  input: z.object({ value: z.string() }),
  metadata: { domain: 'test' },
  output: z.object({ value: z.string() }),
});

// ---------------------------------------------------------------------------
// Layer tests
// ---------------------------------------------------------------------------

describe('Layer', () => {
  test('single layer wraps implementation', async () => {
    const prefixLayer: Layer = {
      name: 'prefix',
      wrap(_trail, impl) {
        return async (input, ctx) => {
          const result = await impl(input, ctx);
          return result.map((out) => ({
            ...out,
            value: `prefixed:${(out as { value: string }).value}`,
          }));
        };
      },
    };

    const wrapped = composeLayers([prefixLayer], echoTrail, echoTrail.blaze);
    const result = await wrapped({ value: 'hello' }, stubCtx);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ value: 'prefixed:hello' });
  });

  test('multiple layers compose in outermost-first order', async () => {
    const log: string[] = [];

    const outer: Layer = {
      name: 'outer',
      wrap(_trail, impl) {
        return async (input, ctx) => {
          log.push('outer:before');
          const r = await impl(input, ctx);
          log.push('outer:after');
          return r;
        };
      },
    };

    const inner: Layer = {
      name: 'inner',
      wrap(_trail, impl) {
        return async (input, ctx) => {
          log.push('inner:before');
          const r = await impl(input, ctx);
          log.push('inner:after');
          return r;
        };
      },
    };

    const wrapped = composeLayers([outer, inner], echoTrail, echoTrail.blaze);
    await wrapped({ value: 'x' }, stubCtx);

    expect(log).toEqual([
      'outer:before',
      'inner:before',
      'inner:after',
      'outer:after',
    ]);
  });

  test('layer can short-circuit without calling inner implementation', async () => {
    const shortCircuit: Layer = {
      name: 'short-circuit',
      wrap() {
        return async () => Result.err(new Error('blocked'));
      },
    };

    const wrapped = composeLayers([shortCircuit], echoTrail, echoTrail.blaze);
    const result = await wrapped({ value: 'hello' }, stubCtx);

    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: Error };
    expect(err.error.message).toBe('blocked');
  });

  test('layer can inspect trail metadata', () => {
    let capturedDomain: unknown;

    const inspectLayer: Layer = {
      name: 'inspect',
      wrap(t, impl) {
        capturedDomain = t.metadata?.['domain'];
        return impl;
      },
    };

    composeLayers([inspectLayer], echoTrail, echoTrail.blaze);

    expect(capturedDomain).toBe('test');
  });

  test('empty layers array returns implementation unchanged', () => {
    const wrapped = composeLayers([], echoTrail, echoTrail.blaze);
    expect(wrapped).toBe(echoTrail.blaze);
  });
});
