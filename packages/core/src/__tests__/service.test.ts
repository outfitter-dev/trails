import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { Result } from '../index.js';
import type { Service, ServiceContext, ServiceSpec } from '../index.js';

const serviceCtx: ServiceContext = {
  cwd: '/tmp/trails',
  env: { DATABASE_URL: 'file::memory:' },
  workspaceRoot: '/tmp',
};

let disposedValue: number | undefined;

const counterServiceSpec: ServiceSpec<number> = {
  create: () => Result.ok(3),
  description: 'Counter service',
  dispose: (service) => {
    disposedValue = service;
  },
  health: (service) => Result.ok({ healthy: service > 0 }),
  metadata: { domain: 'data' },
  mock: () => 1,
};

describe('service types', () => {
  test('ServiceContext exposes the stable process-scoped fields', () => {
    expect(serviceCtx.cwd).toBe('/tmp/trails');
    expect(serviceCtx.env?.DATABASE_URL).toBe('file::memory:');
    expect(serviceCtx.workspaceRoot).toBe('/tmp');
  });

  test('ServiceSpec stores description and metadata', () => {
    expect(counterServiceSpec.description).toBe('Counter service');
    expect(counterServiceSpec.metadata).toEqual({ domain: 'data' });
  });

  test('ServiceSpec can reserve a config schema for future composition', () => {
    const config = z.object({ url: z.string().url() });
    const spec: ServiceSpec<number> = {
      config,
      create: () => Result.ok(1),
    };

    expect(spec.config).toBe(config);
  });

  test('ServiceSpec create and health callbacks are callable', async () => {
    const result = await counterServiceSpec.create(serviceCtx);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(3);

    const health = await counterServiceSpec.health?.(result.unwrap());
    expect(health?.isOk()).toBe(true);
    expect(health?.unwrap()).toEqual({ healthy: true });
  });

  test('ServiceSpec mock and dispose callbacks are callable', async () => {
    disposedValue = undefined;
    const result = await counterServiceSpec.create(serviceCtx);
    expect(result.isOk()).toBe(true);

    const service = result.unwrap();
    expect(await counterServiceSpec.mock?.()).toBe(1);

    await counterServiceSpec.dispose?.(service);
    expect(disposedValue).toBe(3);
  });

  test('ServiceSpec create can be async', async () => {
    const spec: ServiceSpec<number> = {
      create: async () => {
        await Bun.sleep(0);
        return Result.ok(7);
      },
    };

    const result = await spec.create(serviceCtx);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(7);
  });

  test('Service carries identity alongside the shared spec fields', async () => {
    const service: Service<number> = {
      id: 'counter.main',
      kind: 'service',
      ...counterServiceSpec,
    };

    expect(service.kind).toBe('service');
    expect(service.id).toBe('counter.main');

    const created = await service.create(serviceCtx);
    expect(created.isOk()).toBe(true);
    expect(created.unwrap()).toBe(3);
    expect(await service.mock?.()).toBe(1);
  });
});
