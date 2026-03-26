import { describe, test, expect } from 'bun:test';

import { createTrailContext } from '../context.js';
import type { TrailContext } from '../types.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('createTrailContext', () => {
  test('generates a requestId in UUID format', () => {
    const ctx = createTrailContext();
    expect(ctx.requestId).toMatch(UUID_RE);
  });

  test('defaults cwd to process.cwd()', () => {
    const ctx = createTrailContext();
    expect(ctx.cwd).toBe(process.cwd());
  });

  test('defaults env to process.env', () => {
    const ctx = createTrailContext();
    expect(ctx.env).toBeTruthy();
    expect(ctx.env).toBe(process.env);
  });

  test('provides a non-aborted signal by default', () => {
    const ctx = createTrailContext();
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(ctx.signal.aborted).toBe(false);
  });

  test('override values take precedence', () => {
    const ac = new AbortController();
    ac.abort();

    const ctx = createTrailContext({
      cwd: '/custom/dir',
      env: { CUSTOM: 'yes' },
      requestId: 'custom-id',
      signal: ac.signal,
      workspaceRoot: '/tmp',
    });

    expect(ctx.cwd).toBe('/custom/dir');
    expect(ctx.env).toEqual({ CUSTOM: 'yes' });
    expect(ctx.requestId).toBe('custom-id');
    expect(ctx.signal.aborted).toBe(true);
    expect(ctx.workspaceRoot).toBe('/tmp');
  });

  test('TrailContext is extensible with custom fields', () => {
    const ctx: TrailContext = createTrailContext({
      customField: 42,
      nested: { key: 'value' },
    });

    expect(ctx['customField']).toBe(42);
    expect(ctx['nested']).toEqual({ key: 'value' });
  });

  test('each call generates a unique requestId', () => {
    const a = createTrailContext();
    const b = createTrailContext();
    expect(a.requestId).not.toBe(b.requestId);
  });
});
