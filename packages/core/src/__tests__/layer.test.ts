/* oxlint-disable require-await -- layer wrappers satisfy async interfaces without awaiting */
import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { createTrailContext } from '../context';
import { composeLayers } from '../layer';
import type { Layer } from '../layer';
import { executeTrail } from '../execute';
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
  meta: { domain: 'test' },
  output: z.object({ value: z.string() }),
});

const taggingLayer: Layer = {
  name: 'tag',
  wrap(_t, impl) {
    return async (input, ctx) => {
      const r = await impl(input, ctx);
      return r.map((out) => ({
        ...(out as { value: string }),
        value: `tagged:${(out as { value: string }).value}`,
      }));
    };
  },
};

// ---------------------------------------------------------------------------
// Layer tests
// ---------------------------------------------------------------------------

describe('Layer', () => {
  test('single layer wraps implementation', async () => {
    const prefixGate: Layer = {
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

    const wrapped = composeLayers([prefixGate], echoTrail, echoTrail.blaze);
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

  test('layer can inspect trail meta', () => {
    let capturedDomain: unknown;

    const inspectGate: Layer = {
      name: 'inspect',
      wrap(t, impl) {
        capturedDomain = t.meta?.['domain'];
        return impl;
      },
    };

    composeLayers([inspectGate], echoTrail, echoTrail.blaze);

    expect(capturedDomain).toBe('test');
  });

  test('empty layers array returns implementation unchanged', () => {
    const wrapped = composeLayers([], echoTrail, echoTrail.blaze);
    expect(wrapped).toBe(echoTrail.blaze);
  });

  test('typed layer accepts optional input schema', () => {
    const dryRun: Layer = {
      input: z.object({ dryRun: z.boolean().default(false) }),
      name: 'dry-run',
      wrap(_t, impl) {
        return impl;
      },
    };

    expect(dryRun.input).toBeDefined();
    expect(dryRun.name).toBe('dry-run');
  });

  test('typed layer without input schema still works (input is optional)', () => {
    const noInput: Layer = {
      name: 'no-input',
      wrap(_t, impl) {
        return impl;
      },
    };

    expect(noInput.input).toBeUndefined();
    expect(composeLayers([noInput], echoTrail, echoTrail.blaze)).toBeDefined();
  });
});

describe('executeTrail layers option', () => {
  test('layers option wraps the implementation without a deprecation warning', async () => {
    const result = await executeTrail(
      echoTrail,
      { value: 'hello' },
      { layers: [taggingLayer] }
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ value: 'tagged:hello' });
  });

  test('layer without input schema wraps runtime-only concerns', async () => {
    const tenantGuard: Layer = {
      name: 'tenant-guard',
      wrap(_trail, impl) {
        return async (input, ctx) => {
          const expectedTenant = ctx.extensions?.['tenantId'];
          const actualTenant = (input as { tenantId?: string }).tenantId;
          if (expectedTenant !== actualTenant) {
            return Result.err(new Error('tenant mismatch'));
          }
          return await impl(input, ctx);
        };
      },
    };
    const tenantTrail = trail('tenant.echo', {
      blaze: (input) => Result.ok({ value: input.value }),
      input: z.object({ tenantId: z.string(), value: z.string() }),
      output: z.object({ value: z.string() }),
    });
    const result = await executeTrail(
      tenantTrail,
      { tenantId: 'acme', value: 'hello' },
      { ctx: { extensions: { tenantId: 'acme' } }, layers: [tenantGuard] }
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ value: 'hello' });
  });
});
