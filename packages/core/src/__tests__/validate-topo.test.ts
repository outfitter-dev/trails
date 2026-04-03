import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { analyzeDraftState, isDraftId } from '../draft.js';
import { validateEstablishedTopo } from '../validate-established-topo.js';
import { provision } from '../provision.js';
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
    crosses?: readonly string[];
    examples?: readonly {
      name: string;
      input: unknown;
      expected?: unknown;
      error?: string;
    }[];
    output?: z.ZodType;
    provisions?: readonly ReturnType<typeof provision>[];
  }
) => ({
  blaze: noop,
  crosses: Object.freeze([...(overrides?.crosses ?? [])]),
  id,
  input: z.object({ name: z.string() }),
  kind: 'trail' as const,
  provisions: Object.freeze([...(overrides?.provisions ?? [])]),
  ...overrides,
});

const mockProvision = (id: string) =>
  provision(id, {
    create: () => Result.ok({ id }),
  });

const mockEvent = (id: string, from?: readonly string[]) => ({
  from,
  id,
  kind: 'signal' as const,
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
        crosses: ['entity.add'],
      }),
      updated: mockEvent('entity.updated', ['entity.add']),
    });

    const result = validateTopo(app);
    expect(result.isOk()).toBe(true);
  });

  describe('trail crossing', () => {
    test('draft crossings are allowed in the authored graph', () => {
      const app = topo('app', {
        exportTrail: mockTrail('entity.export', {
          crosses: ['_draft.entity.prepare'],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('trail crossing a non-existent trail fails', () => {
      const app = topo('app', {
        onboard: mockTrail('entity.onboard', {
          crosses: ['entity.missing'],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('cross-exists');
      expect(issues[0]?.message).toContain('entity.missing');
    });

    test('trail crossing itself fails', () => {
      const app = topo('app', {
        loop: mockTrail('entity.loop', { crosses: ['entity.loop'] }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues.some((i) => i.rule === 'no-self-cross')).toBe(true);
    });

    test('two-node cycle (a→b→a) is detected', () => {
      const app = topo('app', {
        a: mockTrail('a', { crosses: ['b'] }),
        b: mockTrail('b', { crosses: ['a'] }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      const cycleIssues = issues.filter((i) => i.rule === 'cross-cycle');
      expect(cycleIssues.length).toBeGreaterThanOrEqual(1);
      expect(cycleIssues[0]?.message).toContain('Cycle detected');
    });

    test('three-node cycle (a→b→c→a) is detected', () => {
      const app = topo('app', {
        a: mockTrail('a', { crosses: ['b'] }),
        b: mockTrail('b', { crosses: ['c'] }),
        c: mockTrail('c', { crosses: ['a'] }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      const cycleIssues = issues.filter((i) => i.rule === 'cross-cycle');
      expect(cycleIssues.length).toBeGreaterThanOrEqual(1);
      expect(cycleIssues[0]?.message).toContain('Cycle detected');
    });

    test('valid DAG with shared targets is not flagged', () => {
      const app = topo('app', {
        a: mockTrail('a', { crosses: ['c'] }),
        b: mockTrail('b', { crosses: ['c'] }),
        c: mockTrail('c'),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('provision declarations', () => {
    test('draft provision references are allowed in the authored graph', () => {
      const db = mockProvision('_draft.db.main');
      const app = topo('app', {
        show: mockTrail('entity.show', {
          provisions: [db],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('trail declaring a registered provision passes', () => {
      const db = mockProvision('db.main');
      const app = topo('app', {
        db,
        show: mockTrail('entity.show', {
          provisions: [db],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('trail declaring a missing provision fails', () => {
      const db = mockProvision('db.main');
      const app = topo('app', {
        show: mockTrail('entity.show', {
          provisions: [db],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('provision-exists');
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
      expect(issues[0]?.rule).toBe('signal-origin-exists');
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
    const db = mockProvision('db.main');
    const app = topo('app', {
      broken: mockTrail('entity.broken', { crosses: ['entity.missing'] }),
      missingService: mockTrail('entity.missing-service', {
        provisions: [db],
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

  describe('signal origins', () => {
    test('draft signal origins are allowed in the authored graph', () => {
      const app = topo('app', {
        updated: mockEvent('entity.updated', ['_draft.entity.prepare']),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });
  });
});

describe('draft state analysis', () => {
  test('detects declared draft ids', () => {
    const app = topo('app', {
      draftTrail: mockTrail('_draft.entity.prepare'),
    });

    const analysis = analyzeDraftState(app);

    expect(analysis.declaredDraftIds.has('_draft.entity.prepare')).toBe(true);
    expect(analysis.contaminatedIds.has('_draft.entity.prepare')).toBe(true);
    expect(analysis.findings.map((finding) => finding.rule)).toContain(
      'draft-id'
    );
  });

  test('propagates contamination through dependencies', () => {
    const app = topo('app', {
      exportTrail: mockTrail('entity.export', {
        crosses: ['entity.prepare'],
      }),
      prepareTrail: mockTrail('entity.prepare', {
        crosses: ['_draft.entity.store'],
      }),
    });

    const analysis = analyzeDraftState(app);
    const exportFinding = analysis.findings.find(
      (finding) => finding.id === 'entity.export'
    );

    expect(analysis.contaminatedIds.has('entity.prepare')).toBe(true);
    expect(analysis.contaminatedIds.has('entity.export')).toBe(true);
    expect(exportFinding).toBeDefined();
    expect(exportFinding?.rule).toBe('draft-contamination');
  });
});

describe('validateEstablishedTopo', () => {
  test('passes for an established topo', () => {
    const app = topo('app', {
      show: mockTrail('entity.show'),
    });

    const result = validateEstablishedTopo(app);
    expect(result.isOk()).toBe(true);
  });

  test('fails when draft declarations remain', () => {
    const app = topo('app', {
      draftTrail: mockTrail('_draft.entity.prepare'),
    });

    const result = validateEstablishedTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('draft-id');
  });

  test('fails when established trails depend on draft state', () => {
    const app = topo('app', {
      exportTrail: mockTrail('entity.export', {
        crosses: ['_draft.entity.prepare'],
      }),
    });

    const result = validateEstablishedTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('draft-contamination');
    expect(issues[0]?.message).toContain('entity.export');
  });

  test('fails when authored structural validation still fails', () => {
    const app = topo('app', {
      exportTrail: mockTrail('entity.export', {
        crosses: ['entity.missing'],
      }),
    });

    const result = validateEstablishedTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('cross-exists');
  });

  test('fails when provision declarations are not established in the topo', () => {
    const app = topo('app', {
      show: mockTrail('entity.show', {
        provisions: [mockProvision('db.main')],
      }),
    });

    const result = validateEstablishedTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('provision-exists');
  });

  test('allows authoring-only example issues outside projection checks', () => {
    const app = topo('app', {
      show: mockTrail('entity.show', {
        examples: [
          {
            expected: { ok: true },
            input: { name: 'test' },
            name: 'Has expected',
          },
        ],
      }),
    });

    const result = validateEstablishedTopo(app);
    expect(result.isOk()).toBe(true);
  });
});

describe('isDraftId', () => {
  test('recognizes the reserved draft prefix', () => {
    expect(isDraftId('_draft.entity.show')).toBe(true);
    expect(isDraftId('entity.show')).toBe(false);
  });
});
