import { describe, expect, test } from 'bun:test';

import { Result, resource, topo } from '@ontrails/core';

import {
  createCrossContext,
  createTestContext,
  mergeTestContext,
  resolveMockResources,
} from '../context.js';
import type { TestLogger } from '../types.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTestContext', () => {
  test('produces a valid TrailContext with no args', () => {
    const ctx = createTestContext();
    expect(ctx.cwd).toBe(process.cwd());
    expect(ctx.requestId).toBe('test-request-001');
    expect(ctx.abortSignal).toBeDefined();
    expect(ctx.abortSignal.aborted).toBe(false);
    expect(ctx.logger).toBeDefined();
    expect(ctx.workspaceRoot).toBe(process.cwd());
  });

  test('default logger is a TestLogger', () => {
    const ctx = createTestContext();
    const logger = ctx.logger as TestLogger;
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.clear).toBe('function');
    expect(typeof logger.find).toBe('function');
    expect(typeof logger.assertLogged).toBe('function');
    expect(logger.entries).toBeDefined();
  });

  test('default env is set to test', () => {
    const ctx = createTestContext();
    const env = ctx['env'] as Record<string, string>;
    expect(env).toEqual({ TRAILS_ENV: 'test' });
  });

  test('overrides requestId', () => {
    const ctx = createTestContext({ requestId: 'custom-id' });
    expect(ctx.requestId).toBe('custom-id');
  });

  test('overrides abortSignal', () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = createTestContext({ abortSignal: controller.signal });
    expect(ctx.abortSignal.aborted).toBe(true);
  });

  test('overrides cwd', () => {
    const ctx = createTestContext({ cwd: '/tmp/test' });
    expect(ctx.cwd).toBe('/tmp/test');
    expect(ctx.workspaceRoot).toBe('/tmp/test');
  });

  test('overrides env', () => {
    const ctx = createTestContext({
      env: { CUSTOM: '1', NODE_ENV: 'test' },
    });
    const env = ctx['env'] as Record<string, string>;
    expect(env).toEqual({ CUSTOM: '1', NODE_ENV: 'test' });
  });
});

describe('createCrossContext', () => {
  test('returns configured ok response for registered id', async () => {
    const cross = createCrossContext({
      responses: { 'entity.add': Result.ok({ id: '1', name: 'Alpha' }) },
    });
    const result = await cross('entity.add', { name: 'Alpha' });
    expect(result.unwrap()).toEqual({ id: '1', name: 'Alpha' });
  });

  test('returns configured err response for registered id', async () => {
    const err = new Error('conflict');
    const cross = createCrossContext({
      responses: { 'entity.add': Result.err(err) },
    });
    const result = await cross('entity.add', {});
    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toBe('conflict');
  });

  test('returns err with descriptive message for unregistered id', async () => {
    const cross = createCrossContext();
    const result = await cross('unknown.trail', {});
    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toContain('unknown.trail');
  });

  test('no options defaults to empty responses', async () => {
    const cross = createCrossContext();
    const result = await cross('any.id', {});
    expect(result.isErr()).toBe(true);
  });
});

describe('mergeTestContext', () => {
  test('merges resource overrides into extensions and the resource accessor', () => {
    const ctx = mergeTestContext(
      {
        extensions: { existing: true },
      },
      { 'db.main': { source: 'mock' } }
    );

    expect(ctx.extensions).toEqual({
      'db.main': { source: 'mock' },
      existing: true,
    });
    expect(ctx.resource<{ source: string }>('db.main').source).toBe('mock');
  });
});

describe('resolveMockResources', () => {
  test('creates fresh mock resources for each invocation', async () => {
    let mockCalls = 0;
    const mockable = resource(`resource.mock.${Bun.randomUUIDv7()}`, {
      create: () => Result.ok({ source: 'factory' }),
      mock: () => {
        mockCalls += 1;
        return Promise.resolve({ source: 'mock' });
      },
    });
    const app = topo('mock-app', { mockable } as Record<string, unknown>);

    const first = await resolveMockResources(app);
    const second = await resolveMockResources(app);

    expect(first).toEqual({ [mockable.id]: { source: 'mock' } });
    expect(second).toEqual(first);
    expect(second[mockable.id]).not.toBe(first[mockable.id]);
    expect(mockCalls).toBe(2);
  });

  test('skips resources without mock factories', async () => {
    const plain = resource(`resource.plain.${Bun.randomUUIDv7()}`, {
      create: () => Result.ok({ source: 'factory' }),
    });
    const app = topo('plain-app', { plain } as Record<string, unknown>);

    expect(await resolveMockResources(app)).toEqual({});
  });
});
