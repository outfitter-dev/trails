import { describe, expect, test } from 'bun:test';

import type { McpExtra } from '../build.js';
import { createMcpProgressCallback } from '../progress.js';

describe('createMcpProgressCallback', () => {
  test('returns undefined when no progressToken', () => {
    const extra: McpExtra = {};
    expect(createMcpProgressCallback(extra)).toBeUndefined();
  });

  test('returns undefined when no sendProgress function', () => {
    const extra: McpExtra = { progressToken: 'tok-1' };
    expect(createMcpProgressCallback(extra)).toBeUndefined();
  });

  test('sends 0/1 for start events', () => {
    const calls: [number, number][] = [];
    const extra: McpExtra = {
      progressToken: 'tok-1',
      sendProgress: (current, total) => {
        calls.push([current, total]);
        return Promise.resolve();
      },
    };

    const cb = createMcpProgressCallback(extra);
    expect(cb).toBeDefined();

    const callback = cb as NonNullable<typeof cb>;
    // oxlint-disable-next-line prefer-await-to-callbacks -- not a node callback
    callback({
      ts: new Date().toISOString(),
      type: 'start',
    });

    expect(calls).toEqual([[0, 1]]);
  });

  test('sends progress notification for progress events', () => {
    const calls: [number, number][] = [];
    const extra: McpExtra = {
      progressToken: 'tok-1',
      sendProgress: (current, total) => {
        calls.push([current, total]);
        return Promise.resolve();
      },
    };

    const cb = createMcpProgressCallback(extra);
    expect(cb).toBeDefined();
    const callback = cb as NonNullable<typeof cb>;

    // oxlint-disable-next-line prefer-await-to-callbacks -- not a node callback
    callback({
      current: 5,
      total: 10,
      ts: new Date().toISOString(),
      type: 'progress',
    });

    expect(calls).toEqual([[5, 10]]);
  });

  test('sends 1/1 for complete events', () => {
    const calls: [number, number][] = [];
    const extra: McpExtra = {
      progressToken: 'tok-1',
      sendProgress: (current, total) => {
        calls.push([current, total]);
        return Promise.resolve();
      },
    };

    const cb = createMcpProgressCallback(extra);
    expect(cb).toBeDefined();
    const callback = cb as NonNullable<typeof cb>;

    // oxlint-disable-next-line prefer-await-to-callbacks -- not a node callback
    callback({
      ts: new Date().toISOString(),
      type: 'complete',
    });

    expect(calls).toEqual([[1, 1]]);
  });

  test('does not send for error events', () => {
    const calls: [number, number][] = [];
    const extra: McpExtra = {
      progressToken: 'tok-1',
      sendProgress: (current, total) => {
        calls.push([current, total]);
        return Promise.resolve();
      },
    };

    const cb = createMcpProgressCallback(extra);
    expect(cb).toBeDefined();
    const callback = cb as NonNullable<typeof cb>;

    // oxlint-disable-next-line prefer-await-to-callbacks -- not a node callback
    callback({
      message: 'something broke',
      ts: new Date().toISOString(),
      type: 'error',
    });

    expect(calls).toEqual([]);
  });

  test('handles missing total gracefully', () => {
    const calls: [number, number][] = [];
    const extra: McpExtra = {
      progressToken: 'tok-1',
      sendProgress: (current, total) => {
        calls.push([current, total]);
        return Promise.resolve();
      },
    };

    const cb = createMcpProgressCallback(extra);
    expect(cb).toBeDefined();
    const callback = cb as NonNullable<typeof cb>;

    // oxlint-disable-next-line prefer-await-to-callbacks -- not a node callback
    callback({
      current: 3,
      ts: new Date().toISOString(),
      type: 'progress',
    });

    // Sends current with 0 as indeterminate total
    expect(calls).toEqual([[3, 0]]);
  });
});
