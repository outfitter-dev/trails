import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  Result,
  createTrailContext,
  findDuplicateServiceId,
  isService,
  service as defineService,
} from '../index.js';
import type {
  Service,
  ServiceContext,
  ServiceSpec,
  TrailContext,
} from '../index.js';

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

const resolvedServiceCtx = (id: string, instance: unknown): TrailContext =>
  createTrailContext({
    extensions: { [id]: instance },
    requestId: `${id}-request`,
    signal: new AbortController().signal,
  });

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
      from(ctx) {
        return ctx.service(this);
      },
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

describe('service()', () => {
  test('returns a frozen service object with kind and id', () => {
    const counter = defineService('counter.main', counterServiceSpec);

    expect(counter.kind).toBe('service');
    expect(counter.id).toBe('counter.main');
    expect(Object.isFrozen(counter)).toBe(true);
  });

  test('infers the service type through from(ctx)', () => {
    const db = defineService('db.main', {
      create: () =>
        Result.ok({
          query(sql: string) {
            return sql.length;
          },
        }),
      description: 'Typed database service',
    });

    const store = {
      query(sql: string) {
        return sql.length;
      },
    };
    const ctx = resolvedServiceCtx('db.main', store);

    const resolved = db.from(ctx);
    expect(resolved.query('select 1')).toBe(8);
  });

  test('from(ctx) throws when the service is missing', () => {
    const counter = defineService('counter.main', counterServiceSpec);
    const ctx = createTrailContext({
      requestId: 'missing-service',
      signal: new AbortController().signal,
    });

    expect(() => counter.from(ctx)).toThrow(
      'Service "counter.main" not found in trail context'
    );
  });

  test('from(ctx) returns undefined when the service key exists with an undefined value', () => {
    const optional = defineService<undefined>('optional.main', {
      create: () => Result.ok<undefined>(),
    });
    const ctx = createTrailContext({
      extensions: { [optional.id]: undefined },
      requestId: 'undefined-service',
      signal: new AbortController().signal,
    });

    expect(optional.from(ctx)).toBeUndefined();
  });
});

describe('service helpers', () => {
  test('isService identifies service definitions', () => {
    const counter = defineService('counter.main', counterServiceSpec);

    expect(isService(counter)).toBe(true);
    expect(isService({ id: 'counter.main', kind: 'trail' })).toBe(false);
    expect(isService(null)).toBe(false);
  });

  test('findDuplicateServiceId returns the first repeated ID', () => {
    const first = defineService('counter.main', counterServiceSpec);
    const duplicate = defineService('counter.main', counterServiceSpec);
    const other = defineService('counter.secondary', counterServiceSpec);

    expect(findDuplicateServiceId([first, other])).toBeUndefined();
    expect(findDuplicateServiceId([first, other, duplicate])).toBe(
      'counter.main'
    );
  });
});
