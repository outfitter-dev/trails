import { describe, expect, test } from 'bun:test';

import { createTestContext } from '../context.js';
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
