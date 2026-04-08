import { describe, expect, test } from 'bun:test';

import { createTraceRecord } from '../trace-record.js';

describe('createTraceRecord', () => {
  test('generates unique id and traceId', () => {
    const a = createTraceRecord({ trailId: 'test.trail' });
    const b = createTraceRecord({ trailId: 'test.trail' });

    expect(a.id).toBeString();
    expect(a.traceId).toBeString();
    expect(a.id).not.toBe(b.id);
    expect(a.traceId).not.toBe(b.traceId);
  });

  test('uses provided traceId when given', () => {
    const record = createTraceRecord({
      traceId: 'trace-abc',
      trailId: 'test.trail',
    });

    expect(record.traceId).toBe('trace-abc');
  });

  test('uses provided rootId when given', () => {
    const record = createTraceRecord({
      rootId: 'root-abc',
      trailId: 'test.trail',
    });

    expect(record.rootId).toBe('root-abc');
  });

  test('sets startedAt to current time', () => {
    const before = Date.now();
    const record = createTraceRecord({ trailId: 'test.trail' });
    const after = Date.now();

    expect(record.startedAt).toBeGreaterThanOrEqual(before);
    expect(record.startedAt).toBeLessThanOrEqual(after);
  });

  test('sets status to ok initially', () => {
    const record = createTraceRecord({ trailId: 'test.trail' });

    expect(record.status).toBe('ok');
  });

  test('includes trailId, intent, and trailhead when provided', () => {
    const record = createTraceRecord({
      intent: 'write',
      trailId: 'widget.create',
      trailhead: 'mcp',
    });

    expect(record.trailId).toBe('widget.create');
    expect(record.trailhead).toBe('mcp');
    expect(record.intent).toBe('write');
    expect(record.kind).toBe('trail');
    expect(record.name).toBe('widget.create');
  });
});
