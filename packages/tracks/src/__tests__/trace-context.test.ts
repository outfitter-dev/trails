import { describe, expect, test } from 'bun:test';

import {
  TRACE_CONTEXT_KEY,
  childTraceContext,
  getTraceContext,
} from '../trace-context.js';
import type { TraceContext } from '../trace-context.js';

describe('getTraceContext', () => {
  test('returns undefined when no extensions', () => {
    const ctx = {};
    expect(getTraceContext(ctx)).toBeUndefined();
  });

  test('returns undefined when key is absent from extensions', () => {
    const ctx = { extensions: { other: 'value' } };
    expect(getTraceContext(ctx)).toBeUndefined();
  });

  test('returns context when present in extensions', () => {
    const trace: TraceContext = {
      rootId: 'span-1',
      sampled: true,
      spanId: 'span-1',
      traceId: 'trace-1',
    };
    const ctx = { extensions: { [TRACE_CONTEXT_KEY]: trace } };

    expect(getTraceContext(ctx)).toEqual(trace);
  });
});

describe('childTraceContext', () => {
  test('inherits traceId from parent', () => {
    const parent: TraceContext = {
      rootId: 'root-span',
      sampled: true,
      spanId: 'parent-span',
      traceId: 'trace-abc',
    };
    const child = childTraceContext(parent);

    expect(child.traceId).toBe('trace-abc');
  });

  test('generates a new spanId', () => {
    const parent: TraceContext = {
      rootId: 'root-span',
      sampled: true,
      spanId: 'parent-span',
      traceId: 'trace-abc',
    };
    const child = childTraceContext(parent);

    expect(child.spanId).toBeString();
    expect(child.spanId).not.toBe(parent.spanId);
  });

  test('inherits sampled flag', () => {
    const sampledParent: TraceContext = {
      rootId: 'span-1',
      sampled: true,
      spanId: 'span-1',
      traceId: 'trace-1',
    };
    const unsampledParent: TraceContext = {
      rootId: 'span-2',
      sampled: false,
      spanId: 'span-2',
      traceId: 'trace-2',
    };

    expect(childTraceContext(sampledParent).sampled).toBe(true);
    expect(childTraceContext(unsampledParent).sampled).toBe(false);
  });

  test('inherits rootId from parent (not spanId)', () => {
    const parent: TraceContext = {
      rootId: 'the-root',
      sampled: true,
      spanId: 'parent-span',
      traceId: 'trace-abc',
    };
    const child = childTraceContext(parent);

    expect(child.rootId).toBe('the-root');
    expect(child.rootId).not.toBe(child.spanId);
  });
});
