import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  Result,
  createTrailContext,
  findDuplicateResourceId,
  isResource,
  resource,
} from '../index.js';
import type {
  Resource,
  ResourceContext,
  ResourceSpec,
  TrailContext,
} from '../index.js';

const resourceCtx: ResourceContext = {
  cwd: '/tmp/trails',
  env: { DATABASE_URL: 'file::memory:' },
  workspaceRoot: '/tmp',
};

let disposedValue: number | undefined;

const counterResourceSpec: ResourceSpec<number> = {
  create: () => Result.ok(3),
  description: 'Counter resource',
  dispose: (value) => {
    disposedValue = value;
  },
  health: (value) => Result.ok({ healthy: value > 0 }),
  meta: { domain: 'data' },
  mock: () => 1,
};

const resolvedServiceCtx = (id: string, instance: unknown): TrailContext =>
  createTrailContext({
    abortSignal: new AbortController().signal,
    extensions: { [id]: instance },
    requestId: `${id}-request`,
  });

describe('resource types', () => {
  test('ResourceContext exposes the stable process-scoped fields', () => {
    expect(resourceCtx.cwd).toBe('/tmp/trails');
    expect(resourceCtx.env?.DATABASE_URL).toBe('file::memory:');
    expect(resourceCtx.workspaceRoot).toBe('/tmp');
  });

  test('ResourceSpec stores description and meta', () => {
    expect(counterResourceSpec.description).toBe('Counter resource');
    expect(counterResourceSpec.meta).toEqual({ domain: 'data' });
  });

  test('ResourceSpec can reserve a config schema for future composition', () => {
    const config = z.object({ url: z.string().url() });
    const spec: ResourceSpec<number> = {
      config,
      create: () => Result.ok(1),
    };

    expect(spec.config).toBe(config);
  });

  test('ResourceSpec create and health callbacks are callable', async () => {
    const result = await counterResourceSpec.create(resourceCtx);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(3);

    const health = await counterResourceSpec.health?.(result.unwrap());
    expect(health?.isOk()).toBe(true);
    expect(health?.unwrap()).toEqual({ healthy: true });
  });

  test('ResourceSpec mock and dispose callbacks are callable', async () => {
    disposedValue = undefined;
    const result = await counterResourceSpec.create(resourceCtx);
    expect(result.isOk()).toBe(true);

    const instance = result.unwrap();
    expect(await counterResourceSpec.mock?.()).toBe(1);

    await counterResourceSpec.dispose?.(instance);
    expect(disposedValue).toBe(3);
  });

  test('ResourceSpec create can be async', async () => {
    const spec: ResourceSpec<number> = {
      create: async () => {
        await Bun.sleep(0);
        return Result.ok(7);
      },
    };

    const result = await spec.create(resourceCtx);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(7);
  });

  test('Resource carries identity alongside the shared spec fields', async () => {
    const counterResource: Resource<number> = {
      from(ctx) {
        return ctx.resource(this);
      },
      id: 'counter.main',
      kind: 'resource',
      ...counterResourceSpec,
    };

    expect(counterResource.kind).toBe('resource');
    expect(counterResource.id).toBe('counter.main');

    const created = await counterResource.create(resourceCtx);
    expect(created.isOk()).toBe(true);
    expect(created.unwrap()).toBe(3);
    expect(await counterResource.mock?.()).toBe(1);
  });
});

describe('resource()', () => {
  test('returns a frozen resource object with kind and id', () => {
    const counter = resource('counter.main', counterResourceSpec);

    expect(counter.kind).toBe('resource');
    expect(counter.id).toBe('counter.main');
    expect(Object.isFrozen(counter)).toBe(true);
  });

  test('infers the resource type through from(ctx)', () => {
    const db = resource('db.main', {
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

  test('from(ctx) throws when the resource is missing', () => {
    const counter = resource('counter.main', counterResourceSpec);
    const ctx = createTrailContext({
      abortSignal: new AbortController().signal,
      requestId: 'missing-resource',
    });

    expect(() => counter.from(ctx)).toThrow(
      'Resource "counter.main" not found in trail context'
    );
  });

  test('from(ctx) returns undefined when the resource key exists with an undefined value', () => {
    const optional = resource<undefined>('optional.main', {
      create: () => Result.ok<undefined>(),
    });
    const ctx = createTrailContext({
      abortSignal: new AbortController().signal,
      extensions: { [optional.id]: undefined },
      requestId: 'undefined-resource',
    });

    expect(optional.from(ctx)).toBeUndefined();
  });
});

describe('resource helpers', () => {
  test('isResource identifies resource definitions', () => {
    const counter = resource('counter.main', counterResourceSpec);

    expect(isResource(counter)).toBe(true);
    expect(isResource({ id: 'counter.main', kind: 'trail' })).toBe(false);
    expect(isResource(null)).toBe(false);
  });

  test('findDuplicateResourceId returns the first repeated ID', () => {
    const first = resource('counter.main', counterResourceSpec);
    const duplicate = resource('counter.main', counterResourceSpec);
    const other = resource('counter.secondary', counterResourceSpec);

    expect(findDuplicateResourceId([first, other])).toBeUndefined();
    expect(findDuplicateResourceId([first, other, duplicate])).toBe(
      'counter.main'
    );
  });
});
