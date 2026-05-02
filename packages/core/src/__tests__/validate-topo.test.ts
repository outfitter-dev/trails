import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { deriveDraftReport, isDraftId } from '../draft.js';
import { contour } from '../contour.js';
import { validateEstablishedTopo } from '../validate-established-topo.js';
import { resource } from '../resource.js';
import { Result } from '../result.js';
import { trail } from '../trail.js';
import { topo } from '../topo.js';
import type { TopoIssue } from '../validate-topo.js';
import { validateTopo } from '../validate-topo.js';
import { webhook } from '../webhook.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// oxlint-disable-next-line require-await -- satisfies async interface
const noop = async () => Result.ok();

const mockTrail = (
  id: string,
  overrides?: {
    crosses?: readonly string[];
    contours?: readonly ReturnType<typeof contour>[];
    examples?: readonly {
      name: string;
      input: unknown;
      expected?: unknown;
      error?: string;
    }[];
    fires?: readonly string[];
    on?: readonly string[];
    output?: z.ZodType;
    resources?: readonly ReturnType<typeof resource>[];
  }
) => ({
  blaze: noop,
  contours: Object.freeze([...(overrides?.contours ?? [])]),
  crosses: Object.freeze([...(overrides?.crosses ?? [])]),
  fires: Object.freeze([...(overrides?.fires ?? [])]),
  id,
  input: z.object({ name: z.string() }),
  kind: 'trail' as const,
  on: Object.freeze([...(overrides?.on ?? [])]),
  resources: Object.freeze([...(overrides?.resources ?? [])]),
  ...overrides,
});

const mockResource = (id: string) =>
  resource<unknown>(id, {
    create: () => Result.ok({ id }),
  });

const mockSignal = (id: string, from?: readonly string[]) => ({
  from,
  id,
  kind: 'signal' as const,
  payload: z.object({ name: z.string() }),
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
      updated: mockSignal('entity.updated', ['entity.add']),
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

  describe('resource declarations', () => {
    test('draft resource references are allowed in the authored graph', () => {
      const db = mockResource('_draft.db.main');
      const app = topo('app', {
        show: mockTrail('entity.show', {
          resources: [db],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('trail declaring a registered resource passes', () => {
      const db = mockResource('db.main');
      const app = topo('app', {
        db,
        show: mockTrail('entity.show', {
          resources: [db],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('trail declaring a missing resource fails', () => {
      const db = mockResource('db.main');
      const app = topo('app', {
        show: mockTrail('entity.show', {
          resources: [db],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('resource-exists');
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

  describe('contour references', () => {
    test('contour referencing a registered contour passes', () => {
      const user = contour(
        'user',
        { id: z.string().uuid(), name: z.string() },
        { identity: 'id' }
      );
      const post = contour(
        'post',
        { authorId: user.id(), id: z.string().uuid() },
        { identity: 'id' }
      );

      const app = topo('app', { post, user });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('contour referencing a missing contour fails', () => {
      const user = contour(
        'user',
        { id: z.string().uuid(), name: z.string() },
        { identity: 'id' }
      );
      const post = contour(
        'post',
        { authorId: user.id(), id: z.string().uuid() },
        { identity: 'id' }
      );

      // Only register post, not user — the reference is dangling
      const app = topo('app', { post });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('contour-reference-exists');
      expect(issues[0]?.message).toContain('user');
    });

    test('draft contour references are allowed', () => {
      const draftUser = contour(
        '_draft.user',
        { id: z.string().uuid() },
        { identity: 'id' }
      );
      const post = contour(
        'post',
        { authorId: draftUser.id(), id: z.string().uuid() },
        { identity: 'id' }
      );

      const app = topo('app', { post });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('signal origins', () => {
    test('signal with non-existent origin fails', () => {
      const app = topo('app', {
        updated: mockSignal('entity.updated', ['entity.ghost']),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('signal-origin-exists');
      expect(issues[0]?.message).toContain('entity.ghost');
    });

    test('signal without origins is accepted', () => {
      const app = topo('app', {
        updated: mockSignal('entity.updated'),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('signal references', () => {
    test('trail firing and activating from registered signals passes', () => {
      const app = topo('app', {
        consumer: mockTrail('entity.consume', {
          on: ['entity.created'],
        }),
        created: mockSignal('entity.created'),
        producer: mockTrail('entity.produce', {
          fires: ['entity.created'],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('trail firing a missing signal fails', () => {
      const app = topo('app', {
        producer: mockTrail('entity.produce', {
          fires: ['entity.missing'],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('signal-fire-exists');
      expect(issues[0]?.message).toContain('entity.missing');
    });

    test('trail activating from a missing signal fails', () => {
      const app = topo('app', {
        consumer: mockTrail('entity.consume', {
          on: ['entity.missing'],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('signal-on-exists');
      expect(issues[0]?.message).toContain('entity.missing');
    });

    test('draft signal references are allowed in the authored graph', () => {
      const app = topo('app', {
        consumer: mockTrail('entity.consume', {
          on: ['_draft.entity.ready'],
        }),
        producer: mockTrail('entity.produce', {
          fires: ['_draft.entity.ready'],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('unsupported activation source kinds produce diagnostics', () => {
      const app = topo('app', {
        consumer: trail('entity.consume', {
          blaze: noop,
          input: z.object({}),
          on: [{ id: 'queue.entity.created', kind: 'queue' }],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.rule).toBe('activation-source-kind-known');
      expect(issues[0]?.message).toContain('queue.entity.created');
      expect(issues[0]?.message).toContain('queue');
    });

    test('duplicate source-to-trail activation entries produce diagnostics', () => {
      const app = topo('app', {
        consumer: trail('order.consume', {
          blaze: noop,
          input: z.object({ orderId: z.string() }),
          on: [
            'order.created',
            {
              source: 'order.created',
              where: () => true,
            },
          ],
        }),
        created: {
          id: 'order.created',
          kind: 'signal' as const,
          payload: z.object({ orderId: z.string() }),
        },
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issue = extractIssues(result).find(
        (entry) => entry.rule === 'activation-source-edge-unique'
      );
      expect(issue?.trailId).toBe('order.consume');
      expect(issue?.sourceId).toBe('order.created');
      expect(issue?.sourceKind).toBe('signal');
    });

    test('conflicting source declarations for the same key produce diagnostics', () => {
      const app = topo('app', {
        morning: trail('report.morning', {
          blaze: noop,
          input: z.object({ name: z.string() }),
          on: [
            {
              cron: '0 8 * * *',
              id: 'schedule.report.shared',
              input: { name: 'morning' },
              kind: 'schedule',
            },
          ],
        }),
        nightly: trail('report.nightly', {
          blaze: noop,
          input: z.object({ name: z.string() }),
          on: [
            {
              cron: '0 2 * * *',
              id: 'schedule.report.shared',
              input: { name: 'nightly' },
              kind: 'schedule',
            },
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issue = extractIssues(result).find(
        (entry) => entry.rule === 'activation-source-definition-unique'
      );
      expect(issue?.trailId).toBeDefined();
      if (issue?.trailId === undefined) {
        return;
      }
      expect(['report.morning', 'report.nightly']).toContain(issue.trailId);
      expect(issue.sourceId).toBe('schedule.report.shared');
      expect(issue.sourceKind).toBe('schedule');
    });

    test('equivalent webhook default methods share one source signature', () => {
      const parse = z.object({ paymentId: z.string() });
      const app = topo('app', {
        explicit: trail('payment.explicit', {
          blaze: noop,
          input: parse,
          on: [webhook('webhook.payment', { parse, path: '/webhooks/pay' })],
        }),
        manual: trail('payment.manual', {
          blaze: noop,
          input: parse,
          on: [
            {
              id: 'webhook.payment',
              kind: 'webhook',
              parse,
              path: '/webhooks/pay',
            },
          ],
        }),
      });

      const result = validateTopo(app);

      expect(
        extractIssues(result).some(
          (entry) => entry.rule === 'activation-source-definition-unique'
        )
      ).toBe(false);
    });

    test('shared webhook source with the same verifier reference does not conflict', () => {
      const parse = z.object({ paymentId: z.string() });
      const verify = () => Result.ok();
      const app = topo('app', {
        first: trail('payment.first', {
          blaze: noop,
          input: parse,
          on: [
            webhook('webhook.payment', {
              parse,
              path: '/webhooks/pay',
              verify,
            }),
          ],
        }),
        second: trail('payment.second', {
          blaze: noop,
          input: parse,
          on: [
            webhook('webhook.payment', {
              parse,
              path: '/webhooks/pay',
              verify,
            }),
          ],
        }),
      });

      const result = validateTopo(app);

      expect(
        extractIssues(result).some(
          (entry) => entry.rule === 'activation-source-definition-unique'
        )
      ).toBe(false);
    });

    test('shared webhook source with distinct verifier functions trips activation-source-definition-unique', () => {
      const parse = z.object({ paymentId: z.string() });
      const app = topo('app', {
        first: trail('payment.first', {
          blaze: noop,
          input: parse,
          on: [
            webhook('webhook.payment', {
              parse,
              path: '/webhooks/pay',
              verify: () => Result.ok(),
            }),
          ],
        }),
        second: trail('payment.second', {
          blaze: noop,
          input: parse,
          on: [
            webhook('webhook.payment', {
              parse,
              path: '/webhooks/pay',
              verify: () => Result.ok(),
            }),
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issue = extractIssues(result).find(
        (entry) => entry.rule === 'activation-source-definition-unique'
      );
      expect(issue?.sourceId).toBe('webhook.payment');
      expect(issue?.sourceKind).toBe('webhook');
    });
  });

  describe('activation source input compatibility', () => {
    test('compatible signal payload and trail input pass', () => {
      const app = topo('app', {
        consumer: trail('order.consume', {
          blaze: noop,
          input: z.object({ orderId: z.string() }),
          on: ['order.created'],
        }),
        created: {
          id: 'order.created',
          kind: 'signal' as const,
          payload: z.object({
            orderId: z.string(),
            status: z.enum(['pending', 'settled']),
          }),
        },
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('defaulted source payload fields satisfy required trail input fields', () => {
      const app = topo('app', {
        consumer: trail('account.consume', {
          blaze: noop,
          input: z.object({ accountId: z.string() }),
          on: ['account.created'],
        }),
        created: {
          id: 'account.created',
          kind: 'signal' as const,
          payload: z.object({
            accountId: z.string().default('acct_1'),
          }),
        },
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('literal-union source payload values satisfy wider target enums', () => {
      const app = topo('app', {
        consumer: trail('order.consume', {
          blaze: noop,
          input: z.object({
            status: z.enum(['pending', 'settled', 'failed']),
          }),
          on: ['order.created'],
        }),
        created: {
          id: 'order.created',
          kind: 'signal' as const,
          payload: z.object({
            status: z.union([z.literal('pending'), z.literal('settled')]),
          }),
        },
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('matching source and target nullable unions pass', () => {
      const app = topo('app', {
        consumer: trail('order.consume', {
          blaze: noop,
          input: z.object({
            orderId: z.string().nullable(),
          }),
          on: ['order.created'],
        }),
        created: {
          id: 'order.created',
          kind: 'signal' as const,
          payload: z.object({
            orderId: z.string().nullable(),
          }),
        },
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('incompatible signal payload and trail input produce a source diagnostic', () => {
      const app = topo('app', {
        consumer: trail('order.consume', {
          blaze: noop,
          input: z.object({ orderId: z.string() }),
          on: ['order.created'],
        }),
        created: {
          id: 'order.created',
          kind: 'signal' as const,
          payload: z.object({ orderId: z.number() }),
        },
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issue = extractIssues(result).find(
        (entry) => entry.rule === 'activation-source-input-compatible'
      );
      expect(issue).toBeDefined();
      expect(issue?.trailId).toBe('order.consume');
      expect(issue?.sourceId).toBe('order.created');
      expect(issue?.sourceKind).toBe('signal');
      expect(issue?.inputPath).toEqual(['orderId']);
      expect(issue?.schemaIssues?.[0]?.path).toEqual(['orderId']);
      expect(issue?.schemaIssues?.[0]?.code).toBe('type');
    });

    test('compatible schedule input and trail input pass', () => {
      const app = topo('app', {
        reconcile: trail('account.reconcile', {
          blaze: noop,
          input: z.object({ accountId: z.string() }),
          on: [
            {
              cron: '0 2 * * *',
              id: 'schedule.account.reconcile',
              input: { accountId: 'acct_1' },
              kind: 'schedule',
            },
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('incompatible schedule input and trail input produce a source diagnostic', () => {
      const app = topo('app', {
        reconcile: trail('account.reconcile', {
          blaze: noop,
          input: z.object({ accountId: z.string() }),
          on: [
            {
              cron: '0 2 * * *',
              id: 'schedule.account.reconcile',
              input: { accountId: 123 },
              kind: 'schedule',
            },
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issue = extractIssues(result).find(
        (entry) => entry.rule === 'activation-source-input-compatible'
      );
      expect(issue?.trailId).toBe('account.reconcile');
      expect(issue?.sourceId).toBe('schedule.account.reconcile');
      expect(issue?.sourceKind).toBe('schedule');
      expect(issue?.inputPath).toEqual(['accountId']);
      expect(issue?.schemaIssues?.[0]?.code).toBe('invalid_type');
    });

    test('omitted schedule input defaults to empty object for input compatibility', () => {
      const app = topo('app', {
        reconcile: trail('account.reconcile', {
          blaze: noop,
          input: z.object({ accountId: z.string() }),
          on: [
            {
              cron: '0 2 * * *',
              id: 'schedule.account.reconcile',
              kind: 'schedule',
            },
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issue = extractIssues(result).find(
        (entry) => entry.rule === 'activation-source-input-compatible'
      );
      expect(issue?.trailId).toBe('account.reconcile');
      expect(issue?.sourceKind).toBe('schedule');
      expect(issue?.inputPath).toEqual(['accountId']);
      expect(issue?.schemaIssues?.[0]?.code).toBe('invalid_type');
    });

    test('invalid schedule cron and timezone produce source diagnostics', () => {
      const app = topo('app', {
        reconcile: trail('account.reconcile', {
          blaze: noop,
          input: z.object({}),
          on: [
            {
              cron: '60 2 * * *',
              id: 'schedule.account.reconcile',
              kind: 'schedule',
              timezone: 'Not/A_Zone',
            },
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result).filter(
        (entry) => entry.rule === 'activation-schedule-valid'
      );
      expect(issues).toHaveLength(2);
      expect(issues.map((issue) => issue.inputPath)).toEqual([
        ['cron'],
        ['timezone'],
      ]);
      expect(issues.every((issue) => issue.sourceKind === 'schedule')).toBe(
        true
      );
    });

    test('invalid webhook path and parse shape produce source diagnostics', () => {
      const app = topo('app', {
        receive: trail('payment.receive', {
          blaze: noop,
          input: z.object({ paymentId: z.string() }),
          on: [
            {
              id: 'webhook.stripe.payment',
              kind: 'webhook',
              method: 'POST',
              path: 'webhooks/stripe/payment',
            },
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issues = extractIssues(result).filter(
        (entry) => entry.rule === 'activation-webhook-valid'
      );
      expect(issues).toHaveLength(2);
      expect(issues.map((issue) => issue.inputPath)).toEqual([
        ['path'],
        ['parse'],
      ]);
      expect(issues.every((issue) => issue.sourceKind === 'webhook')).toBe(
        true
      );
    });

    test('compatible webhook parse output and trail input pass', () => {
      const app = topo('app', {
        receive: trail('payment.receive', {
          blaze: noop,
          input: z.object({ paymentId: z.string() }),
          on: [
            webhook('webhook.stripe.payment', {
              parse: {
                output: z.object({ paymentId: z.string() }),
              },
              path: '/webhooks/stripe/payment',
            }),
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('webhook parse output takes precedence over raw payload for input compatibility', () => {
      const app = topo('app', {
        receive: trail('issue.receive', {
          blaze: noop,
          input: z.object({ issueId: z.string() }),
          on: [
            webhook('webhook.github.issue', {
              parse: {
                output: z.object({ issueId: z.string() }),
              },
              path: '/webhooks/github/issue',
              payload: z.object({
                action: z.string(),
                issue: z.object({ number: z.number() }),
              }),
            }),
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isOk()).toBe(true);
    });

    test('incompatible webhook parse output and trail input produce a source diagnostic', () => {
      const app = topo('app', {
        receive: trail('payment.receive', {
          blaze: noop,
          input: z.object({ paymentId: z.string() }),
          on: [
            webhook('webhook.stripe.payment', {
              parse: {
                output: z.object({ paymentId: z.number() }),
              },
              path: '/webhooks/stripe/payment',
            }),
          ],
        }),
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issue = extractIssues(result).find(
        (entry) => entry.rule === 'activation-source-input-compatible'
      );
      expect(issue?.trailId).toBe('payment.receive');
      expect(issue?.sourceId).toBe('webhook.stripe.payment');
      expect(issue?.sourceKind).toBe('webhook');
      expect(issue?.inputPath).toEqual(['paymentId']);
      expect(issue?.schemaIssues?.[0]?.code).toBe('type');
    });

    test('object-form where predicates do not narrow source payload schemas', () => {
      const app = topo('app', {
        consumer: trail('order.consume', {
          blaze: noop,
          input: z.object({ orderId: z.string() }),
          on: [
            {
              source: 'order.created',
              where: {
                predicate: (payload: { orderId?: string }) =>
                  payload.orderId !== undefined,
              },
            },
          ],
        }),
        created: {
          id: 'order.created',
          kind: 'signal' as const,
          payload: z.object({ orderId: z.string().optional() }),
        },
      });

      const result = validateTopo(app);
      expect(result.isErr()).toBe(true);

      const issue = extractIssues(result).find(
        (entry) => entry.rule === 'activation-source-input-compatible'
      );
      expect(issue?.sourceKind).toBe('signal');
      expect(issue?.inputPath).toEqual(['orderId']);
      expect(issue?.schemaIssues?.[0]?.code).toBe('required');
    });
  });

  test('collects multiple issues', () => {
    const db = mockResource('db.main');
    const app = topo('app', {
      broken: mockTrail('entity.broken', { crosses: ['entity.missing'] }),
      missingResource: mockTrail('entity.missing-resource', {
        resources: [db],
      }),
      show: mockTrail('entity.show', {
        examples: [{ input: { name: 123 }, name: 'Bad' }],
      }),
      updated: mockSignal('entity.updated', ['entity.ghost']),
    });

    const result = validateTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(4);
  });

  describe('signal origins', () => {
    test('draft signal origins are allowed in the authored graph', () => {
      const app = topo('app', {
        updated: mockSignal('entity.updated', ['_draft.entity.prepare']),
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

    const analysis = deriveDraftReport(app);

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

    const analysis = deriveDraftReport(app);
    const exportFinding = analysis.findings.find(
      (finding) => finding.id === 'entity.export'
    );

    expect(analysis.contaminatedIds.has('entity.prepare')).toBe(true);
    expect(analysis.contaminatedIds.has('entity.export')).toBe(true);
    expect(exportFinding).toBeDefined();
    expect(exportFinding?.rule).toBe('draft-contamination');
  });

  test('detects draft contour declarations and schema-reference contamination', () => {
    const draftUser = contour(
      '_draft.user',
      {
        id: z.string().uuid(),
      },
      { identity: 'id' }
    );
    const gist = contour(
      'gist',
      {
        id: z.string().uuid(),
        ownerId: draftUser.id(),
      },
      { identity: 'id' }
    );

    const app = topo('app', {
      draftUser,
      gist,
    });

    const analysis = deriveDraftReport(app);
    expect(analysis.declaredDraftIds.has('_draft.user')).toBe(true);
    expect(analysis.contaminatedIds.has('gist')).toBe(true);
    expect(analysis.dependencies).toContainEqual({
      fromId: 'gist',
      kind: 'schema-reference',
      toId: '_draft.user',
    });
  });

  test('propagates contamination through trail contour dependencies', () => {
    const draftUser = contour(
      '_draft.user',
      {
        id: z.string().uuid(),
      },
      { identity: 'id' }
    );

    const app = topo('app', {
      createGist: mockTrail('gist.create', {
        contours: [draftUser],
      }),
      draftUser,
    });

    const analysis = deriveDraftReport(app);
    const finding = analysis.findings.find(
      (entry) => entry.id === 'gist.create'
    );

    expect(analysis.contaminatedIds.has('gist.create')).toBe(true);
    expect(finding?.via).toBe('contour');
  });

  test('propagates contamination through draft signal edges', () => {
    const app = topo('app', {
      consume: mockTrail('entity.consume', {
        on: ['_draft.entity.ready'],
      }),
      produce: mockTrail('entity.produce', {
        fires: ['_draft.entity.ready'],
      }),
    });

    const analysis = deriveDraftReport(app);

    expect(analysis.contaminatedIds.has('entity.consume')).toBe(true);
    expect(analysis.contaminatedIds.has('entity.produce')).toBe(true);
    expect(analysis.dependencies).toContainEqual({
      fromId: 'entity.consume',
      kind: 'signal-on',
      toId: '_draft.entity.ready',
    });
    expect(analysis.dependencies).toContainEqual({
      fromId: 'entity.produce',
      kind: 'signal-fire',
      toId: '_draft.entity.ready',
    });
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

  test('fails when resource declarations are not established in the topo', () => {
    const app = topo('app', {
      show: mockTrail('entity.show', {
        resources: [mockResource('db.main')],
      }),
    });

    const result = validateEstablishedTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('resource-exists');
  });

  test('fails when signal edges are not established in the topo', () => {
    const app = topo('app', {
      producer: mockTrail('entity.produce', {
        fires: ['entity.missing'],
      }),
    });

    const result = validateEstablishedTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('signal-fire-exists');
  });

  test('allows activation source compatibility issues outside projection checks', () => {
    const app = topo('app', {
      consumer: trail('order.consume', {
        blaze: noop,
        input: z.object({ orderId: z.string() }),
        on: ['order.created'],
      }),
      created: {
        id: 'order.created',
        kind: 'signal' as const,
        payload: z.object({ orderId: z.number() }),
      },
    });

    const authored = validateTopo(app);
    expect(authored.isErr()).toBe(true);
    expect(extractIssues(authored)[0]?.rule).toBe(
      'activation-source-input-compatible'
    );

    const established = validateEstablishedTopo(app);
    expect(established.isOk()).toBe(true);
  });

  test('fails when established activation source kind is unsupported', () => {
    const app = topo('app', {
      consume: trail('queue.consume', {
        blaze: noop,
        input: z.object({}),
        on: [{ id: 'queue.work', kind: 'queue' }],
      }),
    });

    const result = validateEstablishedTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('activation-source-kind-known');
  });

  test('fails when established schedule activation source is invalid', () => {
    const app = topo('app', {
      consume: trail('schedule.consume', {
        blaze: noop,
        input: z.object({}),
        on: [
          {
            cron: '60 2 * * *',
            id: 'schedule.invalid',
            kind: 'schedule',
          },
        ],
      }),
    });

    const result = validateEstablishedTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('activation-schedule-valid');
  });

  test('fails when established trails depend on draft signal edges', () => {
    const app = topo('app', {
      consumer: mockTrail('entity.consume', {
        on: ['_draft.entity.ready'],
      }),
    });

    const result = validateEstablishedTopo(app);
    expect(result.isErr()).toBe(true);

    const issues = extractIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('draft-contamination');
    expect(issues[0]?.message).toContain('entity.consume');
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
