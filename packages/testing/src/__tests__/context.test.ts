import { describe, expect, test } from 'bun:test';

import { Result } from '@ontrails/core';

import { createFollowContext, createTestContext } from '../context.js';
import type { TestLogger } from '../types.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTestContext', () => {
  test('produces a valid TrailContext with no args', () => {
    const ctx = createTestContext();
    expect(ctx.requestId).toBe('test-request-001');
    expect(ctx.signal).toBeDefined();
    expect(ctx.signal.aborted).toBe(false);
    expect(ctx.logger).toBeDefined();
    expect(ctx.workspaceRoot).toBeDefined();
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

  test('overrides signal', () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = createTestContext({ signal: controller.signal });
    expect(ctx.signal.aborted).toBe(true);
  });

  test('overrides cwd', () => {
    const ctx = createTestContext({ cwd: '/tmp/test' });
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

describe('createFollowContext', () => {
  test('returns configured ok response for registered id', async () => {
    const follow = createFollowContext({
      responses: { 'entity.add': Result.ok({ id: '1', name: 'Alpha' }) },
    });
    const result = await follow('entity.add', { name: 'Alpha' });
    expect(result.unwrap()).toEqual({ id: '1', name: 'Alpha' });
  });

  test('returns configured err response for registered id', async () => {
    const err = new Error('conflict');
    const follow = createFollowContext({
      responses: { 'entity.add': Result.err(err) },
    });
    const result = await follow('entity.add', {});
    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toBe('conflict');
  });

  test('returns err with descriptive message for unregistered id', async () => {
    const follow = createFollowContext();
    const result = await follow('unknown.trail', {});
    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toContain('unknown.trail');
  });

  test('no options defaults to empty responses', async () => {
    const follow = createFollowContext();
    const result = await follow('any.id', {});
    expect(result.isErr()).toBe(true);
  });
});
