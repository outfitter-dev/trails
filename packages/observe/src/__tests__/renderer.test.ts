import { describe, expect, test } from 'bun:test';
import type { TraceRecord } from '@ontrails/observe';
import { renderTraceTree } from '../renderer.js';

interface RecordOverrides {
  readonly id: string;
  readonly parentId?: string;
  readonly kind?: TraceRecord['kind'];
  readonly name: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly status?: TraceRecord['status'];
  readonly errorCategory?: string;
  readonly attrs?: Record<string, unknown>;
  readonly trailId?: string;
}

const TRACE_ID = 'trace-1';

const makeRecord = (input: RecordOverrides): TraceRecord => {
  const record: TraceRecord = {
    attrs: input.attrs ?? {},
    endedAt: input.endedAt,
    errorCategory: input.errorCategory,
    id: input.id,
    kind: input.kind ?? 'span',
    name: input.name,
    parentId: input.parentId,
    rootId: input.id === 'root' ? input.id : 'root',
    startedAt: input.startedAt,
    status: input.status ?? 'ok',
    traceId: TRACE_ID,
    trailId: input.trailId,
  };
  return record;
};

describe('renderTraceTree', () => {
  describe('edge cases', () => {
    test('returns empty string for empty input', () => {
      expect(renderTraceTree([])).toBe('');
    });

    test('renders a single span without children', () => {
      const records = [
        makeRecord({
          endedAt: 50,
          id: 'root',
          kind: 'trail',
          name: 'solo.task',
          startedAt: 0,
        }),
      ];
      const out = renderTraceTree(records);
      expect(out).toBe(['● solo.task', '  └─ ✓ 50ms'].join('\n'));
    });
  });

  describe('basic tree shapes', () => {
    test('renders a trail with a single child crossing', () => {
      const records = [
        makeRecord({
          endedAt: 100,
          id: 'root',
          kind: 'trail',
          name: 'booking.confirm',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 45,
          id: 'a',
          kind: 'trail',
          name: 'availability.reserve',
          parentId: 'root',
          startedAt: 5,
        }),
      ];
      const out = renderTraceTree(records);
      expect(out).toContain('● booking.confirm');
      expect(out).toContain('└── availability.reserve');
      expect(out).toContain('✓ 40ms');
      expect(out).toContain('└─ ✓ 100ms');
    });

    test('renders multiple children with branch prefixes', () => {
      const records = [
        makeRecord({
          endedAt: 200,
          id: 'root',
          kind: 'trail',
          name: 'pipeline.run',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 50,
          id: 'a',
          name: 'step.one',
          parentId: 'root',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 150,
          id: 'b',
          name: 'step.two',
          parentId: 'root',
          startedAt: 60,
        }),
      ];
      const out = renderTraceTree(records);
      const lines = out.split('\n');
      const hasMidBranch = lines.some((line) => line.includes('├── step.one'));
      const hasLastBranch = lines.some((line) => line.includes('└── step.two'));
      expect(hasMidBranch).toBe(true);
      expect(hasLastBranch).toBe(true);
    });

    test('orders children by startedAt deterministically', () => {
      const records = [
        makeRecord({
          endedAt: 200,
          id: 'root',
          kind: 'trail',
          name: 'sort.test',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 60,
          id: 'late',
          name: 'started.late',
          parentId: 'root',
          startedAt: 50,
        }),
        makeRecord({
          endedAt: 20,
          id: 'early',
          name: 'started.early',
          parentId: 'root',
          startedAt: 10,
        }),
      ];
      const out = renderTraceTree(records);
      const earlyIndex = out.indexOf('started.early');
      const lateIndex = out.indexOf('started.late');
      expect(earlyIndex).toBeGreaterThan(-1);
      expect(lateIndex).toBeGreaterThan(earlyIndex);
    });
  });

  describe('status rendering', () => {
    test('renders an err child with category and glyph', () => {
      const records = [
        makeRecord({
          endedAt: 200,
          id: 'root',
          kind: 'trail',
          name: 'booking.confirm',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 90,
          errorCategory: 'ConflictError',
          id: 'fail',
          name: 'billing.charge',
          parentId: 'root',
          startedAt: 0,
          status: 'err',
        }),
      ];
      const out = renderTraceTree(records);
      expect(out).toContain('✗ ConflictError');
      expect(out).toContain('(90ms)');
    });

    test('renders cancelled status with the cancelled glyph', () => {
      const records = [
        makeRecord({
          endedAt: 50,
          id: 'root',
          kind: 'trail',
          name: 'cancel.test',
          startedAt: 0,
          status: 'cancelled',
        }),
      ];
      const out = renderTraceTree(records);
      expect(out).toContain('⊘ 50ms');
    });
  });

  describe('parallel branches', () => {
    test('detects overlapping siblings and brackets them', () => {
      const records = [
        makeRecord({
          endedAt: 200,
          id: 'root',
          kind: 'trail',
          name: 'fanout',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 150,
          id: 'a',
          name: 'notify.email',
          parentId: 'root',
          startedAt: 10,
        }),
        makeRecord({
          endedAt: 180,
          id: 'b',
          name: 'notify.sms',
          parentId: 'root',
          startedAt: 12,
        }),
        makeRecord({
          endedAt: 130,
          id: 'c',
          name: 'notify.push',
          parentId: 'root',
          startedAt: 15,
        }),
      ];
      const out = renderTraceTree(records);
      // Bracketed group uses ┌ / ├ / └ for the parallel siblings.
      expect(out).toContain('┌ notify.email');
      expect(out).toContain('├ notify.sms');
      expect(out).toContain('└ notify.push');
      // Summary line for parallel wall vs total.
      expect(out).toMatch(/parallel: \d+ms wall, \d+ms total/);
    });

    test('does not bracket non-overlapping siblings', () => {
      const records = [
        makeRecord({
          endedAt: 200,
          id: 'root',
          kind: 'trail',
          name: 'serial',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 50,
          id: 'a',
          name: 'step.one',
          parentId: 'root',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 150,
          id: 'b',
          name: 'step.two',
          parentId: 'root',
          startedAt: 60,
        }),
      ];
      const out = renderTraceTree(records);
      expect(out).not.toContain('parallel:');
      expect(out).toContain('├── step.one');
      expect(out).toContain('└── step.two');
    });

    test('keeps a parallel run open while later siblings overlap an earlier member', () => {
      const records = [
        makeRecord({
          endedAt: 200,
          id: 'root',
          kind: 'trail',
          name: 'fanout',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 150,
          id: 'long',
          name: 'notify.long',
          parentId: 'root',
          startedAt: 10,
        }),
        makeRecord({
          endedAt: 40,
          id: 'short-a',
          name: 'notify.short-a',
          parentId: 'root',
          startedAt: 20,
        }),
        makeRecord({
          endedAt: 80,
          id: 'short-b',
          name: 'notify.short-b',
          parentId: 'root',
          startedAt: 60,
        }),
      ];
      const out = renderTraceTree(records);

      expect(out).toContain('┌ notify.long');
      expect(out).toContain('├ notify.short-a');
      expect(out).toContain('└ notify.short-b');
    });

    test('renders descendants below members of a parallel group', () => {
      const records = [
        makeRecord({
          endedAt: 200,
          id: 'root',
          kind: 'trail',
          name: 'fanout',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 150,
          id: 'a',
          name: 'notify.email',
          parentId: 'root',
          startedAt: 10,
        }),
        makeRecord({
          endedAt: 180,
          id: 'b',
          name: 'notify.sms',
          parentId: 'root',
          startedAt: 12,
        }),
        makeRecord({
          endedAt: 70,
          id: 'a-child',
          name: 'email.template',
          parentId: 'a',
          startedAt: 30,
        }),
      ];
      const out = renderTraceTree(records);

      expect(out).toContain('notify.email');
      expect(out).toContain('email.template');
      expect(out).toContain('notify.sms');
    });
  });

  describe('nesting', () => {
    test('renders a 3-level deeply nested tree', () => {
      const records = [
        makeRecord({
          endedAt: 300,
          id: 'root',
          kind: 'trail',
          name: 'level0',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 250,
          id: 'l1',
          kind: 'trail',
          name: 'level1',
          parentId: 'root',
          startedAt: 10,
        }),
        makeRecord({
          endedAt: 200,
          id: 'l2',
          kind: 'trail',
          name: 'level2',
          parentId: 'l1',
          startedAt: 20,
        }),
      ];
      const out = renderTraceTree(records);
      expect(out).toContain('level0');
      expect(out).toContain('level1');
      expect(out).toContain('level2');
      // Continuation prefix for last child should preserve indent for grandchild.
      const lines = out.split('\n');
      const level2Line = lines.find((line) => line.includes('level2'));
      expect(level2Line).toBeDefined();
      // Last-child path means leading prefix uses spaces, not pipe.
      expect(level2Line).not.toMatch(/^│/);
    });
  });

  describe('multiple roots', () => {
    test('renders independent root trails as separate trees joined by a blank line', () => {
      const records = [
        makeRecord({
          endedAt: 100,
          id: 'root',
          kind: 'trail',
          name: 'first.trail',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 200,
          id: 'root2',
          kind: 'trail',
          name: 'second.trail',
          startedAt: 50,
        }),
      ];
      // root2 has no parent, but rootId points at itself.
      const adjusted = records.map((record) =>
        record.id === 'root2' ? { ...record, rootId: 'root2' } : record
      );
      const out = renderTraceTree(adjusted);
      expect(out).toContain('first.trail');
      expect(out).toContain('second.trail');
      expect(out).toContain('\n\n');
    });
  });

  describe('forward compatibility', () => {
    test('renders a span carrying a layer attr without crashing', () => {
      const records = [
        makeRecord({
          endedAt: 60,
          id: 'root',
          kind: 'trail',
          name: 'with.layer',
          startedAt: 0,
        }),
        makeRecord({
          attrs: { layer: 'audit' },
          endedAt: 30,
          id: 'layer',
          kind: 'span',
          name: 'layer.audit',
          parentId: 'root',
          startedAt: 5,
        }),
      ];
      const out = renderTraceTree(records);
      expect(out).toContain('layer.audit');
      expect(out).toContain('with.layer');
    });

    test('renders signal kind without crashing', () => {
      const records = [
        makeRecord({
          endedAt: 60,
          id: 'root',
          kind: 'trail',
          name: 'host',
          startedAt: 0,
        }),
        makeRecord({
          attrs: { emit: true },
          endedAt: 30,
          id: 'sig',
          kind: 'signal',
          name: 'booking.confirmed',
          parentId: 'root',
          startedAt: 5,
        }),
      ];
      const out = renderTraceTree(records);
      expect(out).toContain('booking.confirmed');
    });

    test('renders activation kind without crashing', () => {
      const records = [
        makeRecord({
          endedAt: 60,
          id: 'root',
          kind: 'trail',
          name: 'host',
          startedAt: 0,
        }),
        makeRecord({
          endedAt: 30,
          id: 'act',
          kind: 'activation',
          name: 'activation.scheduled',
          parentId: 'root',
          startedAt: 5,
        }),
      ];
      const out = renderTraceTree(records);
      expect(out).toContain('activation.scheduled');
    });
  });
});
