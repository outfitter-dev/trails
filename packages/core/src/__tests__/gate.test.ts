/* oxlint-disable require-await -- gate wrappers satisfy async interfaces without awaiting */
import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { createTrailContext } from '../context';
import { composeGates } from '../gate';
import type { Gate } from '../gate';
import { Result } from '../result';
import { trail } from '../trail';
import type { TrailContext } from '../types';

const stubCtx: TrailContext = createTrailContext({
  abortSignal: AbortSignal.timeout(5000),
  requestId: 'test-gate',
});

const echoTrail = trail('echo', {
  blaze: (input) => Result.ok({ value: input.value }),
  input: z.object({ value: z.string() }),
  meta: { domain: 'test' },
  output: z.object({ value: z.string() }),
});

// ---------------------------------------------------------------------------
// Gate tests
// ---------------------------------------------------------------------------

describe('Gate', () => {
  test('single gate wraps implementation', async () => {
    const prefixGate: Gate = {
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

    const wrapped = composeGates([prefixGate], echoTrail, echoTrail.blaze);
    const result = await wrapped({ value: 'hello' }, stubCtx);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ value: 'prefixed:hello' });
  });

  test('multiple gates compose in outermost-first order', async () => {
    const log: string[] = [];

    const outer: Gate = {
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

    const inner: Gate = {
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

    const wrapped = composeGates([outer, inner], echoTrail, echoTrail.blaze);
    await wrapped({ value: 'x' }, stubCtx);

    expect(log).toEqual([
      'outer:before',
      'inner:before',
      'inner:after',
      'outer:after',
    ]);
  });

  test('gate can short-circuit without calling inner implementation', async () => {
    const shortCircuit: Gate = {
      name: 'short-circuit',
      wrap() {
        return async () => Result.err(new Error('blocked'));
      },
    };

    const wrapped = composeGates([shortCircuit], echoTrail, echoTrail.blaze);
    const result = await wrapped({ value: 'hello' }, stubCtx);

    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: Error };
    expect(err.error.message).toBe('blocked');
  });

  test('gate can inspect trail meta', () => {
    let capturedDomain: unknown;

    const inspectGate: Gate = {
      name: 'inspect',
      wrap(t, impl) {
        capturedDomain = t.meta?.['domain'];
        return impl;
      },
    };

    composeGates([inspectGate], echoTrail, echoTrail.blaze);

    expect(capturedDomain).toBe('test');
  });

  test('empty gates array returns implementation unchanged', () => {
    const wrapped = composeGates([], echoTrail, echoTrail.blaze);
    expect(wrapped).toBe(echoTrail.blaze);
  });
});
