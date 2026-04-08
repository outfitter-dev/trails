/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { executeTrail } from '../execute.js';
import { Result } from '../result.js';
import { resource } from '../resource.js';
import { trail } from '../trail.js';
import type { ResourceContext } from '../resource.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nextId = (name: string): string =>
  `test.svc-config.${name}.${Bun.randomUUIDv7()}`;

const createSingletonConfigTrail = (id: string) => {
  const captures = { createCalls: 0 };
  const svc = resource(id, {
    config: z.object({ key: z.string() }),
    create: (ctx: ResourceContext<{ key: string }>) => {
      captures.createCalls += 1;
      return Result.ok({
        createCall: captures.createCalls,
        key: ctx.config.key,
      });
    },
  });

  return {
    captures,
    trail: trail('svc-config.singleton', {
      blaze: (_input, ctx) =>
        Result.ok({
          createCall: svc.from(ctx).createCall,
          key: svc.from(ctx).key,
        }),
      input: z.object({}),
      output: z.object({ createCall: z.number(), key: z.string() }),
      resources: [svc],
    }),
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResourceContext.config', () => {
  test('resource with config schema receives validated config in svc.config', async () => {
    const id = nextId('typed-config');
    let capturedConfig: unknown;

    const db = resource(id, {
      config: z.object({ poolSize: z.number(), url: z.string().url() }),
      create: (svc: ResourceContext<{ url: string; poolSize: number }>) => {
        capturedConfig = svc.config;
        return Result.ok({ connected: true });
      },
    });

    const dbTrail = trail('svc-config.typed', {
      blaze: (_input, ctx) => Result.ok({ connected: db.from(ctx).connected }),
      input: z.object({}),
      output: z.object({ connected: z.boolean() }),
      resources: [db],
    });

    const result = await executeTrail(
      dbTrail,
      {},
      {
        configValues: {
          [id]: { poolSize: 5, url: 'https://example.com' },
        },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(capturedConfig).toEqual({ poolSize: 5, url: 'https://example.com' });
  });

  test('resource without config still works — svc.config is undefined', async () => {
    const id = nextId('no-config');
    let capturedConfig: unknown = 'sentinel';

    const counter = resource(id, {
      create: (svc) => {
        capturedConfig = svc.config;
        return Result.ok(42);
      },
    });

    const counterTrail = trail('svc-config.no-config', {
      blaze: (_input, ctx) => Result.ok({ value: counter.from(ctx) }),
      input: z.object({}),
      resources: [counter],
    });

    const result = await executeTrail(counterTrail, {});

    expect(result.isOk()).toBe(true);
    expect(capturedConfig).toBeUndefined();
  });

  test('config validation failure returns Result.err at resource creation time', async () => {
    const id = nextId('invalid-config');

    const db = resource(id, {
      config: z.object({ url: z.string().url() }),
      create: () => Result.ok({ connected: true }),
    });

    const dbTrail = trail('svc-config.invalid', {
      blaze: () => Result.ok(null),
      input: z.object({}),
      resources: [db],
    });

    const result = await executeTrail(
      dbTrail,
      {},
      {
        configValues: {
          [id]: { url: 'not-a-url' },
        },
      }
    );

    expect(result.isErr()).toBe(true);
    expect(result.error.message).toContain(id);
  });

  test('missing configValues for a resource with config schema returns Result.err', async () => {
    const id = nextId('missing-config');

    const db = resource(id, {
      config: z.object({ url: z.string().url() }),
      create: () => Result.ok({ connected: true }),
    });

    const dbTrail = trail('svc-config.missing', {
      blaze: () => Result.ok(null),
      input: z.object({}),
      resources: [db],
    });

    const result = await executeTrail(dbTrail, {});

    expect(result.isErr()).toBe(true);
    expect(result.error.message).toContain(id);
  });

  test('resource override bypasses config validation', async () => {
    const id = nextId('override-bypass');

    const db = resource(id, {
      config: z.object({ url: z.string().url() }),
      create: () => Result.ok({ connected: true }),
    });

    const dbTrail = trail('svc-config.override', {
      blaze: (_input, ctx) => Result.ok({ value: db.from(ctx) as number }),
      input: z.object({}),
      output: z.object({ value: z.number() }),
      resources: [db],
    });

    // Provide the resource via overrides without any configValues — should NOT fail
    const result = await executeTrail(dbTrail, {}, { resources: { [id]: 42 } });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ value: 42 });
  });
  test('config values passed through ExecuteTrailOptions.configValues', async () => {
    const id = nextId('options-config');
    const captures: unknown[] = [];

    const svc = resource(id, {
      config: z.object({ key: z.string() }),
      create: (ctx: ResourceContext<{ key: string }>) => {
        captures.push(ctx.config);
        return Result.ok({ key: ctx.config.key });
      },
    });

    const svcTrail = trail('svc-config.options', {
      blaze: (_input, ctx) => Result.ok({ key: svc.from(ctx).key }),
      input: z.object({}),
      output: z.object({ key: z.string() }),
      resources: [svc],
    });

    const result = await executeTrail(
      svcTrail,
      {},
      {
        configValues: { [id]: { key: 'hello' } },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ key: 'hello' });
    expect(captures).toEqual([{ key: 'hello' }]);
  });

  test('config-aware singleton resources reuse the cached instance', async () => {
    const id = nextId('singleton-config');
    const { captures, trail: singletonTrail } = createSingletonConfigTrail(id);
    const options = {
      configValues: { [id]: { key: 'hello' } },
    };
    const first = await executeTrail(singletonTrail, {}, options);
    const second = await executeTrail(singletonTrail, {}, options);

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(first.unwrap()).toEqual({ createCall: 1, key: 'hello' });
    expect(second.unwrap()).toEqual({ createCall: 1, key: 'hello' });
    expect(captures.createCalls).toBe(1);
  });
});
