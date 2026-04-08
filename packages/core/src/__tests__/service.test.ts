import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  Result,
  createTrailContext,
  findDuplicateResourceId,
  isResource,
  resource as defineProvision,
} from '../index.js';
import type {
  Resource,
  ResourceContext,
  ResourceSpec,
  TrailContext,
} from '../index.js';

const provisionCtx: ResourceContext = {
  cwd: '/tmp/trails',
  env: { DATABASE_URL: 'file::memory:' },
  workspaceRoot: '/tmp',
};

let disposedValue: number | undefined;

const counterProvisionSpec: ResourceSpec<number> = {
  create: () => Result.ok(3),
  description: 'Counter resource',
  dispose: (resource) => {
    disposedValue = resource;
  },
  health: (resource) => Result.ok({ healthy: resource > 0 }),
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
    expect(provisionCtx.cwd).toBe('/tmp/trails');
    expect(provisionCtx.env?.DATABASE_URL).toBe('file::memory:');
    expect(provisionCtx.workspaceRoot).toBe('/tmp');
  });

  test('ResourceSpec stores description and meta', () => {
    expect(counterProvisionSpec.description).toBe('Counter resource');
    expect(counterProvisionSpec.meta).toEqual({ domain: 'data' });
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
    const result = await counterProvisionSpec.create(provisionCtx);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(3);

    const health = await counterProvisionSpec.health?.(result.unwrap());
    expect(health?.isOk()).toBe(true);
    expect(health?.unwrap()).toEqual({ healthy: true });
  });

  test('ResourceSpec mock and dispose callbacks are callable', async () => {
    disposedValue = undefined;
    const result = await counterProvisionSpec.create(provisionCtx);
    expect(result.isOk()).toBe(true);

    const resource = result.unwrap();
    expect(await counterProvisionSpec.mock?.()).toBe(1);

    await counterProvisionSpec.dispose?.(resource);
    expect(disposedValue).toBe(3);
  });

  test('ResourceSpec create can be async', async () => {
    const spec: ResourceSpec<number> = {
      create: async () => {
        await Bun.sleep(0);
        return Result.ok(7);
      },
    };

    const result = await spec.create(provisionCtx);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(7);
  });

  test('Resource carries identity alongside the shared spec fields', async () => {
    const counterProvision: Resource<number> = {
      from(ctx) {
        return ctx.resource(this);
      },
      id: 'counter.main',
      kind: 'resource',
      ...counterProvisionSpec,
    };

    expect(counterProvision.kind).toBe('resource');
    expect(counterProvision.id).toBe('counter.main');

    const created = await counterProvision.create(provisionCtx);
    expect(created.isOk()).toBe(true);
    expect(created.unwrap()).toBe(3);
    expect(await counterProvision.mock?.()).toBe(1);
  });
});

describe('resource()', () => {
  test('returns a frozen resource object with kind and id', () => {
    const counter = defineProvision('counter.main', counterProvisionSpec);

    expect(counter.kind).toBe('resource');
    expect(counter.id).toBe('counter.main');
    expect(Object.isFrozen(counter)).toBe(true);
  });

  test('infers the resource type through from(ctx)', () => {
    const db = defineProvision('db.main', {
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
    const counter = defineProvision('counter.main', counterProvisionSpec);
    const ctx = createTrailContext({
      abortSignal: new AbortController().signal,
      requestId: 'missing-resource',
    });

    expect(() => counter.from(ctx)).toThrow(
      'Resource "counter.main" not found in trail context'
    );
  });

  test('from(ctx) returns undefined when the resource key exists with an undefined value', () => {
    const optional = defineProvision<undefined>('optional.main', {
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
    const counter = defineProvision('counter.main', counterProvisionSpec);

    expect(isResource(counter)).toBe(true);
    expect(isResource({ id: 'counter.main', kind: 'trail' })).toBe(false);
    expect(isResource(null)).toBe(false);
  });

  test('findDuplicateResourceId returns the first repeated ID', () => {
    const first = defineProvision('counter.main', counterProvisionSpec);
    const duplicate = defineProvision('counter.main', counterProvisionSpec);
    const other = defineProvision('counter.secondary', counterProvisionSpec);

    expect(findDuplicateResourceId([first, other])).toBeUndefined();
    expect(findDuplicateResourceId([first, other, duplicate])).toBe(
      'counter.main'
    );
  });
});
