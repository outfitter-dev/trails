import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { Result } from '../result.js';
import { service } from '../service.js';
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
    follow?: readonly string[];
    examples?: readonly {
      name: string;
      input: unknown;
      expected?: unknown;
      error?: string;
    }[];
    output?: z.ZodType;
    services?: readonly ReturnType<typeof service>[];
  }
) => ({
  follow: Object.freeze([...(overrides?.follow ?? [])]),
  id,
  input: z.object({ name: z.string() }),
  kind: 'trail' as const,
  run: noop,
  services: Object.freeze([...(overrides?.services ?? [])]),
  ...overrides,
});

const mockService = (id: string) =>
  service(id, {
    create: () => Result.ok({ id }),
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
      onboard: mockTrail('entity.onboard', {
        follow: ['entity.add'],
      }),
      updated: mockEvent('entity.updated', ['entity.add']),
    });

    const result = validateTopo(app);
    expect(result.isOk()).toBe(true);
  });

  describe('trail follow', () => {
    test('trail following non-existent trail fails', () => {
      const app = topo('app', {
        onboard: mockTrail('entity.onboard', {
          follow: ['entity.missing'],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('follow-exists');
      expect(issues[0]?.message).toContain('entity.missing');
    });

    test('trail following itself fails', () => {
      const app = topo('app', {
        loop: mockTrail('entity.loop', { follow: ['entity.loop'] }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues.some((i) => i.rule === 'no-self-follow')).toBe(true);
    });

    test('two-node cycle (a→b→a) is detected', () => {
      const app = topo('app', {
        a: mockTrail('a', { follow: ['b'] }),
        b: mockTrail('b', { follow: ['a'] }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      const cycleIssues = issues.filter((i) => i.rule === 'follow-cycle');
      expect(cycleIssues.length).toBeGreaterThanOrEqual(1);
      expect(cycleIssues[0]?.message).toContain('Cycle detected');
    });

    test('three-node cycle (a→b→c→a) is detected', () => {
      const app = topo('app', {
        a: mockTrail('a', { follow: ['b'] }),
        b: mockTrail('b', { follow: ['c'] }),
        c: mockTrail('c', { follow: ['a'] }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      const cycleIssues = issues.filter((i) => i.rule === 'follow-cycle');
      expect(cycleIssues.length).toBeGreaterThanOrEqual(1);
      expect(cycleIssues[0]?.message).toContain('Cycle detected');
    });

    test('valid DAG with shared targets is not flagged', () => {
      const app = topo('app', {
        a: mockTrail('a', { follow: ['c'] }),
        b: mockTrail('b', { follow: ['c'] }),
        c: mockTrail('c'),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('service declarations', () => {
    test('trail declaring a registered service passes', () => {
      const db = mockService('db.main');
      const app = topo('app', {
        db,
        show: mockTrail('entity.show', {
          services: [db],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('trail declaring a missing service fails', () => {
      const db = mockService('db.main');
      const app = topo('app', {
        show: mockTrail('entity.show', {
          services: [db],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('service-exists');
      expect(issues[0]?.message).toContain('db.main');
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

    test('ValidationError example with invalid input is allowed', () => {
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

    test('NotFoundError example with invalid input fails', () => {
      const app = topo('app', {
        show: mockTrail('entity.show', {
          examples: [
            {
              error: 'NotFoundError',
              input: { name: 123 },
              name: 'Not found case',
            },
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('example-input-valid');
    });

    test('NotFoundError example with valid input passes', () => {
      const app = topo('app', {
        show: mockTrail('entity.show', {
          examples: [
            {
              error: 'NotFoundError',
              input: { name: 'test' },
              name: 'Not found case',
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
    const db = mockService('db.main');
    const app = topo('app', {
      broken: mockTrail('entity.broken', { follow: ['entity.missing'] }),
      missingService: mockTrail('entity.missing-service', {
        services: [db],
      }),
      show: mockTrail('entity.show', {
        examples: [{ input: { name: 123 }, name: 'Bad' }],
      }),
      updated: mockEvent('entity.updated', ['entity.ghost']),
    });

    const result = validateTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(4);
  });
});
