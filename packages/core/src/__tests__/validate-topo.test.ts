import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { Result } from '../result.js';
import { topo } from '../topo.js';
import type { TopoIssue } from '../validate-topo.js';
import { validateTopo } from '../validate-topo.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// oxlint-disable-next-line require-await -- satisfies async interface
const noop = async () => Result.ok();

const mockTrail = (
  id: string,
  overrides?: {
    examples?: readonly {
      name: string;
      input: unknown;
      expected?: unknown;
      error?: string;
    }[];
    output?: z.ZodType;
  }
) => ({
  id,
  implementation: noop,
  input: z.object({ name: z.string() }),
  kind: 'trail' as const,
  ...overrides,
});

const mockHike = (id: string, follows: readonly string[]) => ({
  follows,
  id,
  implementation: noop,
  input: z.object({ q: z.string() }),
  kind: 'hike' as const,
});

const mockEvent = (id: string, from?: readonly string[]) => ({
  from,
  id,
  kind: 'event' as const,
  payload: z.object({ data: z.string() }),
});

/** Extract issues from a failed validateTopo result. */
const extractIssues = (result: Result<void, Error>): TopoIssue[] => {
  if (result.isOk()) {
    return [];
  }
  const ctx = (result.error as { context?: { issues?: TopoIssue[] } }).context;
  return (ctx?.issues ?? []) as TopoIssue[];
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateTopo', () => {
  test('valid topo passes', () => {
    const app = topo('app', {
      add: mockTrail('entity.add'),
      onboard: mockHike('entity.onboard', ['entity.add']),
      updated: mockEvent('entity.updated', ['entity.add']),
    });

    const result = validateTopo(app);
    expect(result.isOk()).toBe(true);
  });

  describe('hike follows', () => {
    test('hike following non-existent trail fails', () => {
      const app = topo('app', {
        onboard: mockHike('entity.onboard', ['entity.missing']),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('follows-exist');
      expect(issues[0]?.message).toContain('entity.missing');
    });

    test('hike following itself fails', () => {
      const app = topo('app', {
        loop: mockHike('entity.loop', ['entity.loop']),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('no-self-follow');
    });
  });

  describe('example validation', () => {
    test('example with invalid input fails', () => {
      const app = topo('app', {
        show: mockTrail('entity.show', {
          examples: [{ input: { name: 123 }, name: 'Bad input' }],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('example-input-valid');
      expect(issues[0]?.message).toContain('Bad input');
    });

    test('example with expected output but no output schema warns', () => {
      const app = topo('app', {
        show: mockTrail('entity.show', {
          examples: [
            {
              expected: { result: 'ok' },
              input: { name: 'test' },
              name: 'Has expected',
            },
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('output-schema-present');
    });

    test('error example with invalid input is allowed', () => {
      const app = topo('app', {
        show: mockTrail('entity.show', {
          examples: [
            {
              error: 'ValidationError',
              input: { name: 123 },
              name: 'Error case',
            },
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('event origins', () => {
    test('event with non-existent origin fails', () => {
      const app = topo('app', {
        updated: mockEvent('entity.updated', ['entity.ghost']),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('event-origin-exists');
      expect(issues[0]?.message).toContain('entity.ghost');
    });

    test('event without origins is accepted', () => {
      const app = topo('app', {
        updated: mockEvent('entity.updated'),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });
  });

  test('collects multiple issues', () => {
    const app = topo('app', {
      broken: mockHike('entity.broken', ['entity.missing']),
      show: mockTrail('entity.show', {
        examples: [{ input: { name: 123 }, name: 'Bad' }],
      }),
      updated: mockEvent('entity.updated', ['entity.ghost']),
    });

    const result = validateTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(3);
  });
});
