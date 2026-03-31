import { describe, expect, test } from 'bun:test';

import { createTrackRecord } from '../record.js';

describe('createTrackRecord', () => {
  test('generates unique id and traceId', () => {
    const a = createTrackRecord({ trailId: 'test.trail' });
    const b = createTrackRecord({ trailId: 'test.trail' });

    expect(a.id).toBeString();
    expect(a.traceId).toBeString();
    expect(a.id).not.toBe(b.id);
    expect(a.traceId).not.toBe(b.traceId);
  });

  test('uses provided traceId when given', () => {
    const record = createTrackRecord({
      traceId: 'trace-abc',
      trailId: 'test.trail',
    });

    expect(record.traceId).toBe('trace-abc');
  });

  test('uses provided rootId when given', () => {
    const record = createTrackRecord({
      rootId: 'root-abc',
      trailId: 'test.trail',
    });

    expect(record.rootId).toBe('root-abc');
  });

  test('sets startedAt to current time', () => {
    const before = Date.now();
    const record = createTrackRecord({ trailId: 'test.trail' });
    const after = Date.now();

    expect(record.startedAt).toBeGreaterThanOrEqual(before);
    expect(record.startedAt).toBeLessThanOrEqual(after);
  });

  test('sets status to ok initially', () => {
    const record = createTrackRecord({ trailId: 'test.trail' });

    expect(record.status).toBe('ok');
  });

  test('includes trailId, intent, and surface when provided', () => {
    const record = createTrackRecord({
      intent: 'write',
      surface: 'mcp',
      trailId: 'widget.create',
    });

    expect(record.trailId).toBe('widget.create');
    expect(record.surface).toBe('mcp');
    expect(record.intent).toBe('write');
    expect(record.kind).toBe('trail');
    expect(record.name).toBe('widget.create');
  });
});
